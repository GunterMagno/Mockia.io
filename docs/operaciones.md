# Operaciones

Guía para el titular de Mockia.io: copias de seguridad cifradas y cómo recuperarlas. Este documento crece con cada tarea operativa del plan (vigilancia, panel de métricas); aquí está lo que ya existe.

## Copias de seguridad

### Cómo funcionan

- `.github/workflows/backup.yml` se ejecuta cada día a las **03:17 UTC** (y a mano desde la pestaña Actions) y hace `mongodump` de la base de producción.
- El volcado se **cifra al vuelo con [age](https://age-encryption.org)** hacia tu clave **pública**: `mongodump | age -r <clave pública>`. El volcado en claro nunca existe en el disco del runner.
- El fichero resultante, `mockia-AAAAMMDD-HHMM.archive.gz.age`, se guarda como **artefacto del workflow durante 14 días** y, si configuras `BACKUP_S3_*`, también en un almacenamiento compatible con S3.
- La clave **privada** nunca está en GitHub: sin ella nadie, ni GitHub ni quien acceda al repositorio o a los artefactos, puede leer una copia. Es también la razón por la que **si la pierdes, las copias son inservibles**.
- Si faltan los secretos obligatorios, el workflow termina en verde con un aviso (`::notice::`) y no hace nada.
- Un **simulacro** (`scripts/ci/backup-drill.sh`) demuestra que el mecanismo funciona: crea una pareja de claves temporal, siembra una base, hace la copia, comprueba que el fichero no contiene texto en claro y que con otra clave no se descifra, restaura en otra base y compara documentos, hash por colección e índices. Se ejecuta en cada cambio (trabajo `backup-drill` de `ci.yml`) y **cada lunes a las 04:23 UTC** (`backup-drill.yml`). Un fallo te llega por correo como cualquier workflow fallido de GitHub.

### Puesta en marcha (una sola vez)

**1. Genera tu pareja de claves `age`** en tu equipo (no en un servidor ni en CI):

```bash
age-keygen -o mockia-backup.key
# Public key: age1...        <- la clave PÚBLICA, se imprime por pantalla
```

- Guarda el **contenido de `mockia-backup.key`** (la línea `AGE-SECRET-KEY-...`) en tu gestor de contraseñas **y** en una segunda ubicación sin conexión (por ejemplo, un USB guardado aparte). Solo en esos dos sitios.
- No la subas a GitHub, no la envíes por correo ni la pegues en un chat.
- Anota la clave pública (empieza por `age1`): se puede ver sin riesgo. Si la perdieras pero conservas el fichero: `age-keygen -y mockia-backup.key`.
- Instalación: `apt install age` (Debian/Ubuntu), `brew install age` (macOS), `winget install FiloSottile.age` o el binario de https://github.com/FiloSottile/age/releases (Windows). Para restaurar también necesitas las [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) (`mongorestore`).

**2. Crea un usuario de solo lectura en Atlas** (Database Access, Add New Database User): rol `read` sobre la base de producción (o el rol integrado «Only read any database»). Con él, un secreto filtrado no permite modificar ni borrar datos. Si la IP de los runners de GitHub no está permitida, hay que añadir una regla en Network Access; los runners no tienen IP fija, así que la opción práctica es `0.0.0.0/0` apoyada en el usuario de solo lectura y una contraseña larga (decisión tuya).

**3. Añade los secretos del repositorio** (Settings, Secrets and variables, Actions):

| Secreto                                                  | Obligatorio | Contenido                                                                                |
| -------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `MONGODB_URI_BACKUP`                                     | sí          | URI del usuario de solo lectura, **con el nombre de la base** (`mongodb+srv://…/mockia`) |
| `BACKUP_AGE_RECIPIENT`                                   | sí          | La clave **pública** `age1…`                                                             |
| `BACKUP_S3_BUCKET`                                       | no          | Nombre del bucket                                                                        |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | no          | Credenciales con permiso solo de **escritura** (`PutObject`) en el bucket                |
| `BACKUP_S3_ENDPOINT`                                     | no          | Solo para almacenamientos que no son AWS (Cloudflare R2, Backblaze B2, MinIO…)           |
| `BACKUP_S3_REGION`                                       | no          | Región (`auto` por defecto, válido para R2)                                              |
| `BACKUP_S3_PREFIX`                                       | no          | Carpeta dentro del bucket (`mockia` por defecto)                                         |

El S3 solo se usa si están `BACKUP_S3_BUCKET` y las dos credenciales. Sin ellos la copia vive solo 14 días como artefacto.

**4. Lanza una copia a mano** (Actions, Backup, Run workflow) y comprueba que aparece el artefacto `mockia-backup-<id>`. Haz una restauración de prueba (siguiente apartado) **antes de fiarte** de las copias.

### Restaurar paso a paso

Restaura siempre primero en **una base nueva** y compara; sustituir producción es el último paso.

1. **Obtén la copia.** En GitHub: Actions, Backup, la ejecución, artefacto (un zip con un único `.age`), o con `gh run download <id> -n mockia-backup-<id>`. Desde S3: `aws s3 cp s3://<bucket>/<prefijo>/mockia-….archive.gz.age .`
2. **Ten a mano la clave privada** (`mockia-backup.key`, del gestor de contraseñas) en tu equipo.
3. **Restaura en una base nueva** del servidor que elijas (la URI **sin** nombre de base y con un usuario con permiso de escritura):

   ```bash
   NS_INCLUDE='mockia.*' NS_FROM='mockia.*' NS_TO='mockia_restaurada.*' \
     bash scripts/ci/restore.sh mockia-20261012-0317.archive.gz.age mockia-backup.key 'mongodb+srv://usuario:clave@cluster.mongodb.net/'
   ```

   `restore.sh` descifra con una tubería directa (el volcado descifrado no se escribe en disco), no imprime la URI y **no pisa nada** por defecto. Si la base de la copia no se llama `mockia`, cambia los tres patrones (el nombre es el de la base de la URI de la copia).

4. **Comprueba** con `mongosh`: número de documentos por colección (`db.users.countDocuments()`…), usuarios y proyectos recientes, índices (`db.users.getIndexes()`).
5. **Pasa a producción**, según el caso:
   - Faltan o están corruptos algunos datos: restaura solo esas colecciones directamente en producción (`NS_INCLUDE='mockia.projects'`), sin `RESTORE_DROP`, o cópialas desde la base restaurada.
   - Hay que volver por completo al estado de la copia: para la aplicación, restaura con `RESTORE_DROP=1 NS_INCLUDE='mockia.*'` (borra cada colección antes de restaurarla; **destructivo**, pensado solo para este caso) y arranca de nuevo.
6. Anota qué ocurrió y cuánto tardó: es el dato real de tu tiempo de recuperación.

Para inspeccionar una copia sin restaurarla, `age -d -i mockia-backup.key fichero.age > volcado.archive` deja el volcado **sin cifrar** en disco: bórralo al terminar y no lo hagas en un equipo compartido.

### Qué cubre cada copia y qué NO

| Qué                                                                                                        | Cubierto                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base de datos MongoDB de la URI (usuarios, proyectos, uso, eventos de métricas, ajustes de la plataforma…) | **Sí**, cada día, cifrada                                                                                                                                                                                                         |
| Índices y colecciones vacías                                                                               | Sí (van en el volcado)                                                                                                                                                                                                            |
| **Stripe** (clientes, suscripciones, facturas, precios)                                                    | **No.** Vive en Stripe. Los identificadores guardados en Mongo se restauran, pero la fuente de verdad es Stripe: no hay nada que restaurar desde aquí.                                                                            |
| **Correo** (SMTP y buzones)                                                                                | **No.** Mockia no guarda correo; el proveedor es responsable de sus buzones.                                                                                                                                                      |
| Copias **propias de Atlas** (snapshots, copia continua)                                                    | **No las gestiona este proceso.** Dependen del nivel del clúster (el nivel gratuito M0 no incluye copias). Compruébalo en Atlas, Backup. Estas copias cifradas son un complemento independiente de tu proveedor, no un sustituto. |
| Variables de entorno y secretos (`JWT_*`, `BYOK_KEYS`, claves de Stripe…)                                  | **No.** Guárdalos en tu gestor de contraseñas. Sin el llavero `BYOK_KEYS` las credenciales de IA propias de los usuarios no se pueden descifrar aunque restaures la base.                                                         |
| Código, modelos de IA locales y sus volúmenes                                                              | No: el código está en Git y los modelos se vuelven a descargar.                                                                                                                                                                   |

### Calendario de retención

| Dónde                       | Frecuencia | Retención                                                                | Quién borra                                                       |
| --------------------------- | ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Artefacto de GitHub Actions | diaria     | **14 días** (unas 14 copias)                                             | GitHub, automáticamente                                           |
| Bucket S3 (opcional)        | diaria     | La que configures; **recomendado** una regla de ciclo de vida de 35 días | El propio bucket (la credencial del workflow solo puede escribir) |
| Simulacro de restauración   | semanal    | No guarda nada                                                           | -                                                                 |
| Restauración de prueba real | trimestral | Una vez cada tres meses, con el apartado anterior; anota el tiempo       | Tú                                                                |

Las copias contienen datos personales de usuarios: **un usuario que borra su cuenta sigue existiendo en las copias hasta que estas caducan** (14 días en GitHub, lo que fijes en S3). Tenlo en cuenta al redactar la política de privacidad (el texto legal es un borrador pendiente de revisión por un abogado). Si restauras una copia antigua, vuelve a aplicar las bajas y supresiones solicitadas después de su fecha.

### Si algo falla

- **Copia en rojo**: abre la ejecución; los mensajes no incluyen la URI. Causas habituales: contraseña caducada o IP no permitida en Atlas (`server selection error`), URI sin nombre de base («la copia está vacía o es demasiado pequeña») o clave pública mal copiada.
- **Simulacro en rojo**: lo más probable es un cambio en las herramientas (`age`, `mongodb-database-tools`) o en Mongo; el mensaje `drill FALLA: …` dice qué comprobación no pasó. Hasta que vuelva a verde, no te fíes de las copias nuevas.
- **Rotación de clave**: genera una pareja nueva, cambia `BACKUP_AGE_RECIPIENT` y **conserva la clave privada antigua** mientras queden copias cifradas con ella (hasta 14 días en GitHub, más en S3).

## Panel de métricas

El titular tiene una API de métricas, `GET /api/admin/metrics?days=7|30|90` (por defecto 30; cualquier otro valor es un 400). La pantalla `/admin` que la muestra llega en la tarea siguiente; mientras tanto se puede consultar con `curl` y el token de acceso de tu sesión.

### Quién puede verla

Solo los correos de `ADMIN_EMAILS` (lista separada por comas, sin distinguir mayúsculas) **y con el correo verificado en la cuenta**. No hay ningún rol en la base de datos: ninguna escritura en un usuario da acceso. Quien no es administrador recibe un 403 idéntico tanto si su correo no está en la lista como si no está verificado; sin sesión, un 401. Vacía (por defecto) = nadie.

### Qué contiene

Solo agregados, sin correos, ids de usuario, IPs ni contenido. Los días van en UTC y la ventana trae siempre los `days` días completos, hoy incluido, con los días sin actividad a 0.

| Bloque    | Qué cuenta                                                                                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`   | Total y verificados (todas las cuentas); `byPlan` por el plan que **se aplica hoy** (un `past_due` fuera de gracia o un cancelado cuentan como `free`; un `past_due` dentro de los 7 días de gracia mantiene su plan); `newPerDay` altas por día de la ventana.                               |
| `funnel`  | Cohorte registrada **dentro de la ventana**: registrados, verificados, con proyecto y con al menos una generación de IA (`Usage.aiGenerations > 0` en alguno de sus meses). Cada paso exige haber cumplido el anterior: «con proyecto» son los verificados con proyecto, y así sucesivamente. |
| `billing` | `paying`: cuentas de pago con `billingStatus` **activa**, por plan. `mrrUsdEstimate`: ingreso mensual recurrente estimado.                                                                                                                                                                    |
| `ai`      | Llamadas y errores por día y ámbito (`users`, `demo`, `byok`), tokens de entrada y salida, `errorRatio` (todo desenlace distinto de `ok` cuenta como error), `estimatedCostUsd` y `unpriced`.                                                                                                 |
| `demo`    | `generationsPerDay`: generaciones de la demo pública por día (llamadas de IA con ámbito `demo`).                                                                                                                                                                                              |

### El MRR es una estimación, no facturación

Se calcula desde el catálogo de precios de `@mockia/shared` (`PLAN_PRICE_USD`), no desde Stripe: ignora impuestos, descuentos, cupones, reembolsos y el cambio de divisa. Reglas:

- Cuentan solo las cuentas con `billingStatus` activa. Las `past_due` (aún sin cobrar) y las canceladas **no** cuentan.
- Intervalo anual: el precio anual dividido entre 12 (el de Pro, 290 USD al año, aporta 24,17 al mes). Intervalo mensual: el precio mensual.
- **Si el intervalo de una cuenta no se conoce** (cuentas anteriores a que se guardara el intervalo, o cuyo precio de Stripe no se reconoció) se cuenta como **mensual**. Si tienes suscripciones anuales así, el MRR estará algo sobrestimado hasta que su próximo evento de Stripe rellene el intervalo.

La cifra que manda es la de Stripe; úsala para contrastar, no para contabilidad.

### Coste estimado de la IA: `AI_PRICES_JSON`

El servidor **no trae precios**: los pones tú, en USD por millón de tokens, tal como los publica cada proveedor.

```bash
AI_PRICES_JSON='{"openrouter/anthropic/claude-3.5-sonnet":{"inputPerMTok":3,"outputPerMTok":15}}'
```

- La clave es `<proveedor>/<modelo>` exactamente como aparece en las métricas (el modelo puede contener barras). Los nombres que ves en la API vienen de las propias llamadas registradas; mira `ai.unpriced` para saber cuáles te faltan.
- Vacía o sin definir (por defecto) = **sin estimación**: `estimatedCostUsd` es `null` y `unpriced` va vacía; los tokens se siguen sumando.
- Un JSON inválido (o con una forma distinta, un precio negativo, una clave sin `/`) se **ignora entero** con un aviso en el log (`AI_PRICES_JSON is not valid`, sin repetir el valor) y el coste queda en `null`. En producción además impide arrancar (`assertProdConfig`, que tampoco reproduce el valor): una tabla a medias daría un coste equivocado sin avisar.
- Un modelo sin precio suma sus tokens pero no coste, y se lista en `ai.unpriced`. Las llamadas fallidas se registran con modelo `unknown` y sin tokens, así que aparecerán como `<proveedor>/unknown` sin precio: es normal.
- **Las llamadas con la clave propia del usuario (`byok`) nunca cuentan como coste**: las paga el usuario. Sí suman a los tokens y a las llamadas.
- El coste solo refleja lo que tiene tokens guardados (`ok` con uso informado); no es la factura del proveedor.

### Caché y rendimiento

Cada ventana (7, 30 y 90) se calcula como mucho una vez cada 60 segundos y se guarda en la memoria del proceso: dos pestañas o recargas seguidas no repiten las agregaciones (con varias instancias cada una tiene la suya). Las consultas usan los índices `User.createdAt`, `AiCall.at`, `Project.ownerId` y `Usage.ownerId`. Un fallo no se cachea.
