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
