# Demo pública sin registro: operación

La demo permite a cualquiera generar una API simulada con IA **sin crear cuenta**. Gasta dinero real (cada generación llama a un modelo), así que está pensada para que el gasto máximo sea conocido y acotado, y para que apagarla sea inmediato. Este documento es la guía del titular: variables, cómo activarla y apagarla, cómo calibrarla y qué vigilar.

Un test (`packages/backend/src/tests/demo.docs.test.ts`) ata este documento al código: las variables `DEMO_*` que se citan aquí son exactamente las que lee `getDemoConfig` y las de los dos `.env.example`, y los valores por defecto de la tabla son los reales. Si cambias una variable, actualiza este documento (el test fallará si no lo haces).

## Qué hace la demo (resumen de límites)

| Concepto | Valor | Dónde se aplica |
|---|---|---|
| Entrada | texto pegado de hasta 6 000 caracteres, o una de 3 plantillas; nunca una URL de GitHub | servidor |
| Generaciones por visitante y día UTC | `DEMO_PER_IP_GENERATIONS` | contador en MongoDB, exacto con varias instancias |
| Generaciones por red IPv6 /48 y día UTC | `DEMO_PER_NET_GENERATIONS` | segundo contador en MongoDB, solo IPv6 |
| Generaciones de toda la demo por día UTC | `DEMO_DAILY_GENERATIONS` | contador global en MongoDB, exacto con varias instancias |
| Prueba de trabajo (hashcash SHA-256) | `DEMO_POW_BITS` bits | el navegador la resuelve; el servidor la verifica y la gasta una sola vez |
| Generaciones simultáneas | `DEMO_MAX_CONCURRENT` en total y 1 por visitante | **por proceso** (ver "Varias instancias") |
| Salida | como máximo 5 endpoints, respuestas de hasta 8 KB, 2 000 tokens de salida | servidor |
| Plazo de la generación | `AI_DEMO_TIMEOUT_MS` (45 s por defecto) | servidor |
| Vida de la API simulada | `DEMO_MOCK_TTL_MINUTES` minutos | índice TTL de MongoDB (puede tardar hasta ~1 minuto más en borrar) |
| Peticiones que sirve cada API simulada | 150, y 300 por visitante y día | MongoDB |

Lo que **no** hay en la demo: claves de API, exportación, visibilidad privada, retardos simulados largos. Para conservar una API hay que registrarse (ver la sección siguiente).

## Conservar la demo al registrarse: `POST /api/demo/:demoId/claim`

El visitante que pulsa el botón de guardar el proyecto, se registra (o inicia sesión) y llega al panel, ve su demo convertida en un proyecto real. Cómo funciona y qué hay que saber al operarlo:

- **Quién puede reclamar**: una cuenta con sesión y el correo verificado (si `REQUIRE_EMAIL_VERIFICATION` lo exige, por defecto en producción), con un límite de 10 intentos cada 15 minutos por cuenta. El `demoId` son 128 bits aleatorios: quien lo tiene puede reclamar, y no existe ningún listado de demos.
- **Qué hace**: copia los endpoints del mock (método, ruta, estado, cuerpo y las cabeceras permitidas) a un proyecto nuevo de la cuenta (`Demo - <primer recurso>`, público y sin clave, como cualquier proyecto nuevo) y borra la demo. **No consume cuota de IA ni presupuesto de la demo**, y funciona aunque `DEMO_ENABLED` esté en `false` (copiar algo que ya existe no cuesta nada ni abre la demo a nadie).
- **Es atómico**: la demo se toma con un único `findOneAndDelete`, así que dos reclamos simultáneos producen como máximo un proyecto. `404` es la respuesta única para «no existe», «venció» y «ya reclamada».
- **Si la cuenta ya está en su límite de proyectos** responde `402 PLAN_LIMIT_REACHED` y la demo **sigue disponible** (se comprueba antes de tomarla). Si la copia falla a medias se borra el proyecto a medias y la demo se restaura con su caducidad original; solo un corte del proceso entre tomar la demo y terminar la copia la perdería (el visitante genera otra).
- **En el navegador**: el id se guarda en `sessionStorage` (`mockia_demo_pending`) únicamente cuando el visitante pulsa el botón de guardar (nunca al generar), nunca va en la URL, y se borra al reclamar, al comprobar que ya no existe y al cerrar la pestaña. Los textos legales (Privacidad y Cookies, sección «demo») lo declaran; un test (`demo.docs.test.ts`) ata esa declaración al código.
- **Pruebas e2e**: con el buzón de pruebas montado (`E2E_EXPOSE_MAIL_OUTBOX=true`, nunca en producción) existe `POST /api/__test__/demo-mock`, que crea una demo real sin pasar por la IA.

## Qué pregunta el resto del sitio: `GET /api/demo/availability`

La cabecera y la portada preguntan en cada carga de página (a todo el mundo) si merece la pena anunciar la demo. Para eso existe `GET /api/demo/availability`: devuelve solo `{ available }` (verdadero si la demo está activada y queda presupuesto global), es **anónimo** (no usa la IP del visitante ni escribe nada) y **cacheable**: el servidor lo recuerda 30 segundos en memoria de cada proceso y la respuesta lleva `Cache-Control: public, max-age=60`. Está **fuera de los limitadores** de ráfaga (para que un NAT compartido no gaste el cupo de quien de verdad usa la demo). Consecuencia operativa: tras activar, apagar o agotar la demo, la portada puede tardar hasta unos 90 segundos en reflejarlo (caché del servidor más la del navegador o de un CDN); `generate` y `status` no pasan por esa caché. Como el resto de la API, la petición aparece en los logs de acceso con la IP en claro.

## Variables

Todas se leen del entorno en cada petición (no hace falta recompilar para cambiar un límite; sí reiniciar o redesplegar el servicio para que el proceso vea la variable nueva).

| Variable | Defecto | Qué hace |
|---|---|---|
| `DEMO_ENABLED` | `false` | Interruptor general. Acepta `true`, `1`, `yes` u `on`. Apagada, `generate`, `challenge` y las API simuladas ya creadas responden 503; `GET /api/demo/status` responde 200 con `available: false`. |
| `DEMO_HMAC_SECRET` | (sin valor) | Secreto raíz: firma los retos de prueba de trabajo y pseudonimiza las IP. Obligatorio, de al menos 32 caracteres, si la demo está activada en producción: el backend **no arranca** sin él. |
| `DEMO_DAILY_GENERATIONS` | `150` | Generaciones de toda la demo por día UTC. Es el techo de gasto (ver "Coste"). |
| `DEMO_PER_IP_GENERATIONS` | `2` | Generaciones por visitante (IP pseudonimizada, IPv6 agrupada por /64) y día UTC. |
| `DEMO_PER_NET_GENERATIONS` | `20` | Generaciones por día UTC de toda una red IPv6 /48 (un túnel IPv6 gratuito da a una sola persona 65 536 /64, cada uno con su cupo por visitante). Segundo contador, solo para IPv6 (IPv4 no cambia): el orden es /64, /48, global, y si uno rechaza se devuelven las unidades de los anteriores. El rechazo es el mismo 429 de cupo diario agotado que el cupo por visitante. Con 0 se rechaza todo IPv6. Una organización con un /48 compartido queda limitada a este número al día. |
| `DEMO_MAX_CONCURRENT` | `4` | Generaciones que pueden ejecutarse a la vez en un proceso. |
| `DEMO_POW_BITS` | `18` | Ceros iniciales exigidos al hash de la prueba de trabajo (1 a 24). Cada bit duplica el trabajo medio. |
| `DEMO_MOCK_TTL_MINUTES` | `30` | Minutos que vive una API simulada de la demo. **Los textos legales prometen 30 minutos**: si lo cambias, actualiza Privacidad y Términos en los tres idiomas. |

Variables de IA de la demo (no son `DEMO_*`: viven en `config/ai.ts` y se leen aparte):

| Variable | Defecto | Qué hace |
|---|---|---|
| `AI_DEMO_PROVIDERS` | vacío (= `AI_PROVIDERS`) | Lista de proveedores solo para la demo, con la misma sintaxis que `AI_PROVIDERS` (`local`, `openrouter`). Permite apuntar la demo a un modelo más barato o propio mientras los usuarios registrados conservan el suyo. La demo tiene siempre su propia cadena y su propio cortacircuitos: una demo que falla nunca corta la IA de los usuarios. |
| `AI_DEMO_TIMEOUT_MS` | `45000` | Plazo total de una generación de la demo. Una petición que ya salió hacia el proveedor cuenta como gastada aunque venza el plazo. |

## Estado del despliegue

Estado de cada fichero (una línea por fichero; el test `demo.docs.test.ts` las comprueba por separado y solo cuenta variables reales, no comentarios):

- `render.yaml`: **SÍ reenvía** las ocho `DEMO_*` y las dos `AI_DEMO_*` al backend, todas apagadas o vacías por defecto. `DEMO_ENABLED` es `sync: false` y no tiene valor en el fichero: lo decide el panel de Render y un push de `render.yaml` nunca la enciende (ni la vuelve a encender tras un apagado de emergencia). `DEMO_HMAC_SECRET` es `generateValue: true`: Render genera un secreto aleatorio de 256 bits y no está en el repositorio. El resto son `sync: false` (vacío = el valor por defecto del código).
- `docker-compose.prod.yml`: **SÍ reenvía** las mismas diez variables al contenedor del backend: `DEMO_ENABLED: ${DEMO_ENABLED:-false}` y las demás como `${VAR:-}` (vacío = el valor por defecto del código). También reenvía `TRUST_PROXY` (por defecto `1`, el nginx del compose). Ninguna es obligatoria: un despliegue sin demo arranca igual que antes. Se rellenan en el `.env` (ver `.env.example`).

Qué fija `deploy.demo.test.ts` (lee ambos ficheros como YAML y las variables que de verdad lee el código, así que una variable nueva que se olvide aquí lo rompe): que todas se reenvían y solo al backend; que la demo viene apagada; que el secreto no tiene valor en el repositorio; que el valor vacío (lo que `docker compose` pasa para una variable sin definir) conserva todos los defectos; y que en producción `DEMO_ENABLED=true` sin un secreto de al menos 32 caracteres impide arrancar al backend (sin repetir el valor). `docker compose -f docker-compose.prod.yml config` lo valida también el CI (job `compose-ai-config`) y aquí se comprobó a mano que resuelve las diez variables.

La IP del visitante sale de `TRUST_PROXY` (los saltos de proxy delante del backend): `render.yaml` lo fija a 2 y `docker-compose.prod.yml` lo reenvía con 1 por defecto (el nginx del compose). Si pones delante un proxy TLS (el bloque de `docs/08_despliegue.md`, 8.4) son dos saltos: `TRUST_PROXY=2` en el `.env` y el proxy debe enviar `X-Forwarded-For`. Lee "Comprobación de `TRUST_PROXY`" antes de activar la demo, sea cual sea la topología.

## Activar la demo

Hazlo en este orden; no actives nada hasta el paso 5.

1. **Genera el secreto**: `openssl rand -hex 32` (64 caracteres; el mínimo son 32 caracteres). Guárdalo como secreto del servicio, nunca en el repositorio. Rotarlo con la demo en marcha invalida los retos pendientes y además **reinicia los cupos del día** (cambia todos los seudónimos de IP), así que no lo rotes como rutina.
2. **Mide la tasa de truncado del prompt de la demo con el modelo real, antes de activarla.** La demo pide como máximo 2 000 tokens de salida y, si el modelo se queda corto (`finish_reason: length`), no hay reparación y el intento del visitante queda gastado. Ejecuta `npm run eval -w @mockia/backend -- --provider=openrouter --max-tokens=2000` (o `--provider=local`; ver `packages/backend/evals/README.md`) con el mismo modelo que usará la demo (`OPENROUTER_MODEL`, o el de `AI_DEMO_PROVIDERS`). Ojo: el banco usa el prompt estándar (5 a 10 endpoints), más largo que el de la demo (3 a 5 endpoints pequeños), así que el truncado que mida es una **cota pesimista**. Si es alto, sube el modelo o no actives la demo.
3. **Calibra `DEMO_POW_BITS`** (siguiente apartado).
4. **Comprueba `TRUST_PROXY`** (apartado "Comprobación de TRUST_PROXY"): sin identificar bien la IP los cupos por visitante no valen nada.
5. **Revisa los textos legales** (`/privacy`, `/terms`, `/cookies`): son un borrador pendiente de revisión jurídica y llevan marcadores `[[REVISAR: ...]]` que el titular o su abogado deben resolver. Haz `grep -rn "REVISAR" packages/frontend/src/pages/Legal/legalContent` y no actives la demo mientras quede alguno sin resolver (hoy: `[[REVISAR: retención de logs del hosting]]`, en Privacidad, en los tres idiomas).
6. Configura `DEMO_HMAC_SECRET`, `DEMO_ENABLED=true` y, si quieres, los límites y `AI_DEMO_*`, y reinicia. Comprueba `GET /api/demo/status` (debe decir que está disponible) y haz una generación real desde un navegador.

## Apagar la demo

Pon `DEMO_ENABLED=false` y reinicia o redesplega el backend. Efecto: `generate` y `challenge` de `/api/demo/*` y todo `/api/demo-mock/*` (incluidas las API simuladas que aún no habían caducado) responden 503, y `GET /api/demo/status` responde 200 con `available: false` (la página lo usa para avisar); los usuarios registrados, su IA y sus cuotas no se ven afectados (la demo tiene su propio presupuesto y su propia cadena de IA). No hace falta el secreto para apagarla. Los datos de la demo se borran solos (ver "Qué se guarda").

Es el primer recurso ante abuso o gasto inesperado: apagar es barato, reactivar es una variable.

### Apagado de emergencia

No existe un interruptor en caliente: las variables se leen del entorno **del proceso**, así que el cambio se ve cuando el backend se reinicia. Por orden, de lo más fino a lo más drástico:

1. **Apagar la demo** (no toca a los usuarios registrados):
   - Render: panel de Render, servicio `mockia-backend`, *Environment*, `DEMO_ENABLED=false` (o bórrala), *Save*. Render redespliega solo; cuenta con varios minutos (en el plan gratuito el servicio además tarda en arrancar). Como `DEMO_ENABLED` es `sync: false` en `render.yaml`, un push posterior **no** la vuelve a encender.
   - Docker Compose: `DEMO_ENABLED=false` en el `.env` y `docker compose -f docker-compose.prod.yml up -d backend` (recrea solo el backend; segundos).
   - Comprueba que ha surtido efecto: `curl -s https://<frontend>/api/demo/status` debe decir `"available":false` y `curl -s -X POST -H 'Content-Type: application/json' -d '{}' https://<frontend>/api/demo/challenge` debe responder 503. La cabecera y la portada tardan hasta unos 90 segundos en dejar de anunciarla (caché de `availability`).
2. **Cortar el gasto sin esperar al redespliegue**: baja a cero el límite de crédito de la clave de IA en el panel del proveedor (o revócala). Es un corte bruto: **también para la IA de los usuarios registrados** hasta que la repongas. Con un modelo propio, `docker compose ... stop llm`. Por eso el límite de gasto del proveedor debe estar fijado de antemano (ver la lista de comprobaciones): es el tope que no depende de este código.
3. **Cerrar el acceso en el borde**: bloquear `/api/demo` y `/api/demo-mock` en el proxy (nginx del compose o reglas de la plataforma) responde antes de llegar al backend.
4. **Estrechar sin apagar**: `DEMO_DAILY_GENERATIONS=0` y `DEMO_PER_IP_GENERATIONS=0` (ver "Apagado suave"); también requiere reinicio.

Tras una emergencia, mira el contador global del día (sección "Qué mirar si hay abuso") para saber cuánto se gastó antes del corte.

## Calibrar `DEMO_POW_BITS`

La prueba de trabajo es una barrera de coste para scripts, no la defensa principal (esa son los cupos por visitante y el tope global). El navegador busca un número cuyo hash SHA-256, junto con el reto, empiece por `DEMO_POW_BITS` bits a cero: de media hacen falta `2^DEMO_POW_BITS` intentos (con 18, unos 262 000; con 24, unos 16,7 millones).

- **Más bits = más coste para los bots, pero también más espera para todos los visitantes**, que la pagan en su móvil o portátil.
- Calibra con un **móvil de gama baja** (no con tu ordenador): abre `/demo` y mide cuánto tarda en estar lista la prueba antes de poder generar. Un valor razonable es el mayor con el que ese móvil sigue esperando unos pocos segundos; si tarda más, baja los bits.
- Cambiar el valor solo afecta a los retos nuevos (la dificultad va firmada dentro de cada reto).
- Nunca pongas un valor alto "por si acaso": por encima de 24 se ignora y el valor por defecto vuelve a aplicarse.

## Coste

El gasto máximo diario de la demo es:

```
coste máximo diario = DEMO_DAILY_GENERATIONS × coste por generación
```

No hay cifras de coste en este repositorio. Mide el **coste por generación** con tu proveedor siguiendo "Cómo medir el coste por generación" de `docs/economia-planes.md` y usa el percentil alto, no la media. Dos matices para que la fórmula sea honesta:

- Una unidad de cupo **no se devuelve** una vez que la petición ha salido hacia un proveedor de IA: cuenta aunque el modelo falle, devuelva basura o venza el plazo, porque el proveedor puede facturar igualmente. Solo se devuelve si nunca llegó a salir ninguna petición (prueba de trabajo inválida, sin hueco de concurrencia, cadena imposible de construir, circuito abierto).
- Una unidad puede producir más de una llamada al modelo (un intento y una reparación por cada proveedor de la cadena, más los reintentos internos de OpenRouter). Cada llamada está acotada por los 2 000 tokens de salida y por `AI_DEMO_TIMEOUT_MS`, pero el "coste por generación" que uses debe incluir ese peor caso.

### La demo es barata de agotar (decisión de producto conocida)

Con IPv4 y los valores por defecto, 75 visitantes con 2 generaciones cada uno (`DEMO_DAILY_GENERATIONS` ÷ `DEMO_PER_IP_GENERATIONS`) bastan para **agotar el presupuesto global del día**; con IP distintas (una red móvil, una botnet pequeña) es algo que un grupo reducido puede hacer a propósito. Es una decisión consciente: el tope global es lo que acota el gasto, y el precio es que la demo puede quedarse sin cupo ese día para el resto. La prueba de trabajo sube el coste de hacerlo, no lo impide. Con IPv6 un solo prefijo /48 (65 536 /64) no basta para hacerlo, porque `DEMO_PER_NET_GENERATIONS` (20 por /48 y día) lo acota; hacen falta unos ocho /48 distintos. Si te preocupa: sube `DEMO_POW_BITS`, baja `DEMO_PER_NET_GENERATIONS`, baja `DEMO_PER_IP_GENERATIONS` a 1, baja `DEMO_DAILY_GENERATIONS`, o apaga la demo.

## Apagado suave: límites a 0

Los dos límites diarios aceptan 0 (el mínimo válido). Sirve para cerrar la demo sin apagarla, pero los mensajes difieren:

- `DEMO_DAILY_GENERATIONS=0`: ningún visitante puede generar. `generate` responde 503 ("sin cupo hoy") y `GET /api/demo/status` responde 200 con `available: false`. Es el equivalente a "presupuesto agotado".
- `DEMO_PER_IP_GENERATIONS=0`: el límite por visitante está ya agotado para todos. `generate` responde 429 con "vuelve mañana" aunque el presupuesto global esté intacto, y `status` sigue diciendo `available: true` con 0 generaciones restantes para el visitante. Puede confundir a quien lo pruebe: para cerrar la demo de verdad usa `DEMO_ENABLED=false` o `DEMO_DAILY_GENERATIONS=0`.

## Varias instancias

Los contadores diarios (por visitante y global) y los cupos de cada API simulada viven en MongoDB y son exactos con cualquier número de instancias. **Lo que está en memoria es por proceso**, así que con N instancias el límite efectivo es hasta N veces el configurado:

- el tope de generaciones simultáneas (`DEMO_MAX_CONCURRENT`) y el de 1 por visitante;
- el limitador de ráfagas de `/api/demo/*` (60 peticiones por minuto y visitante);
- el limitador de retos (`/api/demo/challenge`, 30 por hora y visitante);
- el limitador de ráfagas de `/api/demo-mock/*` (120 peticiones por minuto y visitante).

El gasto en IA sigue acotado por el contador global en MongoDB; lo que se pierde con varias instancias es la protección de pico instantáneo.

## Comprobación de `TRUST_PROXY`

Los cupos por visitante dependen de que `req.ip` sea la IP real. Con un número de saltos equivocado pasa una de dos cosas: todos los visitantes comparten una sola IP (y se reparten 2 generaciones al día entre todos), o un visitante puede inventarse su IP con una cabecera `X-Forwarded-For` falsificada y **anular los cupos por visitante**. Haz el procedimiento de `docs/08_despliegue.md` (apartado 8.2, "Comprobación tras el despliegue") y **repítelo contra la URL pública del backend** (`https://<backend>/api/...`), no solo contra el frontend:

Hazla en **cualquier topología** (Render, el compose solo o el compose con un proxy TLS delante): ninguna se libra de contar bien los saltos.

1. Haz una petición a `GET /api/demo/status` desde dos redes distintas y mira en los logs del backend la primera columna (la IP): deben salir dos IP públicas distintas.
2. Repite con `curl -H "X-Forwarded-For: 203.0.113.7" https://<backend>/api/demo/status`. En el log no debe aparecer `203.0.113.7` como IP del cliente.
3. Ojo con la topología: `render.yaml` fija `TRUST_PROXY=2` porque el navegador llega a la API a través de la reescritura `/api/*` del frontend más el balanceador de Render (dos saltos). Una llamada **directa** a la URL pública del backend atraviesa un salto menos de los que `TRUST_PROXY=2` da por supuestos: la cabecera que llega es `<lo que escribió el cliente>, <su IP real>` y la entrada de la izquierda, que el cliente elige, pasa a ser `req.ip`. Si el paso 2 la deja pasar contra el backend directo, el cliente puede cambiar de "visitante" en cada petición.

   **Qué se anula** (todo lo que se indexa por IP): el cupo diario por visitante (`DEMO_PER_IP_GENERATIONS`), el límite de una generación a la vez por visitante, el límite de 30 retos por hora, los limitadores de ráfaga de `/api/demo` (60 por minuto) y de `/api/demo-mock` (120 por minuto), el tope de 300 peticiones por día y visitante a las API simuladas, y también el limitador global de la API (1 000 cada 15 minutos por IP). **Qué sigue acotando** (nada de eso depende de la IP): el tope global diario `DEMO_DAILY_GENERATIONS` (contador exacto en MongoDB: con IP inventadas, 20 intentos contra un tope de 5 dieron exactamente 5 llamadas al modelo), el tope de generaciones simultáneas del proceso `DEMO_MAX_CONCURRENT`, el coste de la prueba de trabajo (`2^DEMO_POW_BITS` hashes por generación, y un reto no se reutiliza), las 150 peticiones de cada API simulada, que lo que ya salió hacia el proveedor no se devuelve, y los límites de tamaño. El gasto máximo diario sigue siendo `DEMO_DAILY_GENERATIONS × coste por generación`.

   **Qué se puede hacer con ello**: agotar el presupuesto global del día con unas decenas o cientos de peticiones y unos segundos de CPU (cada generación cuesta resolver la prueba de trabajo), es decir, negar la demo al resto ese día. Lo que **no** puede es gastar más de lo configurado, ni llenar la base (con pruebas falsas o con el tope agotado no se escribe nada: ver "Resultado de las pruebas de abuso"), ni alcanzar datos de usuarios. En `docker-compose.prod.yml` el backend no publica puertos y todo pasa por nginx, así que no se puede llamar al backend directamente; pero la cuenta de saltos sigue importando: con el nginx del compose a solas son 1 (`TRUST_PROXY` por defecto), y con un proxy TLS delante (el bloque de `docs/08_despliegue.md`, 8.4) son 2, es decir `TRUST_PROXY=2` en el `.env` y `X-Forwarded-For` enviado por ese proxy. Con `TRUST_PROXY=1` detrás de un proxy TLS todos los visitantes compartirían una sola IP: el segundo visitante del día recibiría el 429 de cupo agotado, el reto 31 de cualquiera en una hora también y los limitadores de ráfaga serían comunes a todo el sitio.

   Si la comprobación confirma que en Render el acceso directo funciona, las opciones son: aceptar el riesgo con un `DEMO_DAILY_GENERATIONS` pequeño y el límite de gasto del proveedor; subir `DEMO_POW_BITS`; o cambiar la topología para que el backend no sea accesible directamente (no hay forma de lograrlo con la reescritura del sitio estático de Render y el plan gratuito; exigiría un proxy propio delante, p. ej. el nginx del compose, con el backend sin URL pública).

## Qué se guarda (y cuánto)

Resumen operativo de lo que los textos legales declaran; si algo de esto cambia, cambian los textos.

| Dato | Dónde | Plazo |
|---|---|---|
| Texto pegado por el visitante | en ningún sitio (solo se envía al proveedor de IA) | no se guarda |
| IP del visitante | solo como HMAC-SHA256 con sal que cambia cada día UTC (IPv6 por /64), nunca en claro en la base de datos. El seudónimo por sí solo no permite seguir a un visitante de un día a otro, pero quien tenga el secreto puede recalcular el de una IP conocida, y los logs de acceso (última fila) sí contienen la IP en claro y enlazan días | ver contadores |
| Contadores diarios (visitante, red IPv6 /48 y global) | colección `demobudgets` (el de red guarda solo un seudónimo del prefijo /48, con el mismo HMAC y sal diaria) | caducan por TTL: 48 h después de acabar el día que cuentan, más hasta ~1 min de retraso de MongoDB |
| API simulada y su contenido | colección `demomocks` (guarda también el seudónimo de la IP) | `DEMO_MOCK_TTL_MINUTES` minutos (30), más hasta ~1 min de retraso de MongoDB |
| Retos de prueba de trabajo ya usados | colección `demospentchallenges` (id aleatorio) | 10 minutos |
| Límites de ráfaga | memoria del proceso | se pierden al reiniciar |
| Id de la demo que el visitante quiere conservar | `sessionStorage` de su pestaña (`mockia_demo_pending`), **solo** si pulsa el botón de guardar el proyecto | hasta que la reclama, se comprueba que ya no existe o cierra la pestaña |
| **Logs de acceso del servidor (morgan)** | salida estándar del backend; la plataforma de alojamiento los retiene | **no verificable desde el código**: `[[REVISAR: retención de logs del hosting]]` |

**Los logs de acceso guardan la IP en claro y la URL completa** (formato `combined` de morgan; también del proxy inverso o de la plataforma). Incluyen el identificador aleatorio de cada API simulada, pero no el texto del visitante ni la respuesta del modelo. La Política de Privacidad lo declara y deja la retención como pendiente: averigua cuánto conserva tu proveedor (en Render depende del plan; con `docker-compose.prod.yml` son los logs de Docker y de nginx, que no rotan por defecto) y sustituye el marcador por el dato real, o reduce la retención si es excesiva.

## Qué mirar si hay abuso

- **Síntomas**: la demo se queda sin cupo antes de lo previsto (503 con el mensaje de "sin cupo"), muchos 429, picos de generaciones, el proveedor de IA factura más de lo calculado.
- **Contadores**: en MongoDB, `db.demobudgets.find({ day: "AAAA-MM-DD", scope: "global" })` da las generaciones gastadas hoy frente a `DEMO_DAILY_GENERATIONS`; `scope: "ip"` lista los seudónimos con su cuenta (no se pueden asociar a una IP real sin el secreto y el día).
- **Logs de acceso**: patrones de peticiones a `/api/demo/generate` y `/api/demo-mock/*` por IP en claro, el mismo `User-Agent`, rangos de red concretos.
- **Acciones, de menos a más drásticas**: subir `DEMO_POW_BITS`; bajar `DEMO_PER_IP_GENERATIONS` y `DEMO_DAILY_GENERATIONS`; bloquear rangos en el proxy o la plataforma; apagar con `DEMO_ENABLED=false`.
- **Comprueba `TRUST_PROXY`** de nuevo: un `X-Forwarded-For` falsificado que se acepta explica cupos "infinitos" por visitante.

## Resultado de las pruebas de abuso

Tarea B7. `packages/backend/src/tests/demo.abuse.test.ts` ataca la aplicación real (Express, MongoDB real y un servidor HTTP falso en lugar del modelo) y `deploy.demo.test.ts` fija el despliegue. Para repetirlas: `MONGODB_URI=mongodb://localhost:27017/mockia-test-b7 npx jest demo.abuse deploy.demo --runInBand --forceExit`.

### Qué se probó, y qué pasó

| Escenario | Resultado |
|---|---|
| 200 direcciones IPv6 dentro de un mismo /64 (el atacante coge los retos desde otras redes) | un solo cupo: 2 generaciones, 198 respuestas 429, 2 llamadas al modelo y un solo seudónimo en la base; el /64 de al lado sí es otro visitante |
| Rotar `User-Agent`, cookies, `Authorization` y `X-Forwarded-For` falsos con `TRUST_PROXY=2` por el camino normal (frontend + balanceador), con `TRUST_PROXY=1` detrás de nginx y con `TRUST_PROXY=0` | la IP efectiva no cambia: un cupo de 2; las cabeceras absurdas (vacía, basura, 7 000 caracteres, IPv4 inválida) nunca dan 500 |
| Un atacante con un /48 entero (65 536 /64): 200 /64 distintos dentro de un mismo /48 | como mucho 20 generaciones (`DEMO_PER_NET_GENERATIONS`) con el mismo 429 de cupo diario agotado que el cupo por visitante, 20 llamadas al modelo; otro /48 no se ve afectado; IPv4 intacto (tres direcciones de la misma /24 reciben dos cada una); `/status` muestra lo que de verdad queda |
| Llamada directa al backend con `TRUST_PROXY=2` (limitación conocida, ver "Comprobación de `TRUST_PROXY`") | el cupo por visitante se anula; el tope global lo acota: con tope 5, 20 intentos, exactamente 5 llamadas al modelo |
| 1 000 retos sin resolver | desde una IP: 30 y el resto 429 con `Retry-After`; desde 1 000 IP inventadas: 1 000 retos y **cero** documentos en ninguna colección (el reto no se guarda; caduca a los 5 minutos y el índice TTL de los gastados existe) |
| Un reto resuelto enviado 20 veces en paralelo (desde 20 direcciones y desde una) | una sola generación y una sola llamada al modelo; las demás 400 de reto inválido y el presupuesto vuelve |
| Cuerpos de 2 MB (con `Content-Length` y en *chunked*), de 10 000 claves y anidados 20 000 niveles | 413 o 400 por tamaño antes de procesar: sin presupuesto, sin reto gastado, sin llamada al modelo; el POST de 2 MB a una API simulada no se lee |
| 500 intentos mezclados (retos válidos desde direcciones nuevas, firma falsa, reutilización, nonce erróneo, mismo /64, basura, claves de más, texto que intenta tomar el control del prompt, cuerpos grandes y una ráfaga de 50 a la vez) con `DEMO_DAILY_GENERATIONS=10` | con un modelo que contesta bien: exactamente 10 llamadas al modelo y 10 unidades gastadas, ningún 500. Con un modelo que falla, devuelve basura, se queda cortado o no contesta: cada unidad gastada envió al menos una petición (lo que sale hacia el proveedor no se devuelve), ninguna envió más de dos (intento y reparación) y el cortacircuitos de la demo se abre y deja de llamar al modelo |
| Alcance a datos de usuarios y proyectos | el catálogo de rutas de `/api/demo` es el esperado y solo el reclamo pide sesión; un recorrido anónimo completo solo toca `demomocks`, `demobudgets` y `demospentchallenges`; 14 rutas de escape contra una API simulada (`..%2f`, `%2e%2e`, rutas de la API real y de los mocks reales, mayúsculas, id truncado) dan 404 sin ningún dato de nadie; una salida del modelo con rutas hacia la API real no crea nada fuera de la demo |
| `GET /api/demo/availability` bajo ráfagas | 300 llamadas simultáneas desde 300 direcciones: todas 200, cacheables y **una** lectura de la base; 900 seguidas desde una IP: nunca 429 y sin gastar el cupo de `/status` de esa IP; con `/status` inundado (429), `availability` sigue respondiendo; apagada la demo no toca la base |
| Despliegue (`deploy.demo.test.ts`) | las 10 variables se reenvían solo al backend en ambos ficheros; apagada por defecto; sin secreto en el repositorio; un valor vacío conserva los defectos; en producción `DEMO_ENABLED=true` sin secreto de 32 caracteres impide arrancar |

### Hallazgos de la revisión y su arreglo

Tres hallazgos, todos con rojo antes de tocar el código (`demo.abuse.test.ts`) y verde después, más pruebas unitarias en `demo.primitives.test.ts`. Los tres se aprovechan sobre todo cuando se puede inventar la IP (llamada directa con `TRUST_PROXY=2`), pero ninguno lo necesita:

1. **Una prueba de trabajo falsa, vencida o repetida escribía 4 veces en MongoDB y retenía una unidad del presupuesto global** (el presupuesto se consumía antes de verificar la prueba), sin coste para el atacante y sin que ningún cupo por IP lo frenase si inventaba la dirección. Ahora la comprobación pura de la prueba (`checkProof`: forma, firma, vencimiento y el trabajo en sí, sin E/S) y una lectura de los retos gastados van antes del presupuesto; el gasto atómico del reto va después, de modo que un rechazo por presupuesto sigue sin quemar un reto resuelto. Escribir una sola fila cuesta trabajo real (`2^DEMO_POW_BITS` hashes). (Deriva del *minor* 2 de la revisión de B3.)
2. **Con el tope global agotado, cada IP inventada creaba una fila de contador** (se creaba, no pasaba el tope global y se devolvía, pero la fila quedaba). Ahora una lectura responde antes de escribir; quien ya estaba por encima de su cupo sigue recibiendo el 429 de siempre, no el 503.
3. **`GET /api/demo/availability` hacía una lectura por petición concurrente con la caché fría** (300 simultáneas, 300 lecturas). Ahora comparten una sola.

Y de la revisión final de la rama, para la demo: **(I2) el cupo por visitante solo agrupaba IPv6 por /64**, y un túnel IPv6 gratuito da un /48 (65 536 /64): una sola persona agotaba `DEMO_DAILY_GENERATIONS` en un minuto cada día. Ahora hay un segundo contador por /48 (`DEMO_PER_NET_GENERATIONS`, 20 por día; ver la tabla de variables). **(I3) la documentación decía que la comprobación de `TRUST_PROXY` se podía saltar con el compose**, pero el bloque TLS de `docs/08_despliegue.md` añade un salto: corregido arriba y en esa guía. (La regla de devolución de la cuota de IA de los usuarios registrados, I1, está en `docs/economia-planes.md`.)

### Límites conocidos y aceptados

- Llamada directa al backend de Render con `TRUST_PROXY=2` (arriba): se anula el cupo por visitante y queda el tope global.
- La demo es barata de agotar (sección "Coste"); con IP inventadas, todavía más. Una organización que comparta un /48 IPv6 queda limitada a `DEMO_PER_NET_GENERATIONS` generaciones al día entre todos sus miembros.
- Una unidad puede producir hasta 2 llamadas al modelo por proveedor de la cadena (intento y reparación); el coste por generación debe incluirlo. No se salta al siguiente proveedor tras una salida inválida (pendiente de decidir si merece la pena).
- Dentro del presupuesto, la demo se puede usar como un modelo de lenguaje gratuito de uso general (el contenido arbitrario cabe en cuerpos JSON de hasta 8 KB por endpoint). El presupuesto y el límite de gasto del proveedor lo acotan; es un riesgo residual aceptado.
- Los limitadores en memoria son por proceso (ver "Varias instancias").
- Los registros de acceso del servidor guardan la IP en claro (ver "Qué se guarda").
- El texto de los avisos legales sigue siendo un borrador con marcadores `[[REVISAR]]` pendientes del titular y de su abogado; el build no se bloquea por ello (decisión del plan, ruling B7-R1: un fallo de build lo escondería detrás de otro problema; por eso está en la lista de abajo).

### Qué NO se pudo probar aquí: comprobaciones manuales del titular

Nada de lo siguiente es verificable en local (no hay Render, ni móviles reales, ni modelo real, ni varias instancias). Hazlo en este orden y marca cada punto; no actives la demo para el público hasta completar el bloque "Antes de activar".

**Antes de activar** (con `DEMO_ENABLED` aún sin definir):

- [ ] **Límite de gasto fijado en el proveedor de IA** (crédito máximo o presupuesto mensual de la clave): es el tope que no depende de este código y el que corta de verdad si algo falla. Apunta aquí el valor: ______.
- [ ] **Coste real por generación medido** con tu modelo, siguiendo "Cómo medir el coste por generación" de `docs/economia-planes.md` (percentil alto, con reparación y los reintentos). Fija `DEMO_DAILY_GENERATIONS` para que `DEMO_DAILY_GENERATIONS × coste por generación` sea un gasto diario que aceptas. Valor elegido: ______.
- [ ] **Truncado del prompt de la demo con el modelo real**: `npm run eval -w @mockia/backend -- --provider=openrouter --max-tokens=2000` (o `--provider=local`), con el mismo modelo que usará la demo. El banco usa el prompt estándar (5 a 10 endpoints), más largo que el de la demo, así que es una cota pesimista. Si el truncado es alto, cambia de modelo o no actives la demo. Resultado: ______.
- [ ] **IP real tras el proxy de Render**: el procedimiento de "Comprobación de `TRUST_PROXY`" contra el frontend (dos redes distintas dan dos IP distintas en el log; un `X-Forwarded-For: 203.0.113.7` falso **no** aparece como IP del cliente) **y** contra la URL pública del backend. Anota si el acceso directo permite elegir la IP: ______. Si lo permite, decide con "Si la comprobación confirma..." (arriba).
- [ ] **Dificultad de la prueba de trabajo en móviles reales**: abre `/demo` en un móvil de gama baja con datos móviles y en uno actual; mide cuánto tarda en estar lista la prueba con `DEMO_POW_BITS=18` (por defecto). Objetivo: unos pocos segundos en el peor móvil; si tarda más, baja los bits; si un portátil la resuelve al instante, el bot también. Comprueba también un navegador sin `crypto.subtle` (página servida por `http`), que debe mostrar el aviso y no quedarse girando. Tiempos: ______.
- [ ] **Varias instancias** (solo si vas a escalar a más de una): confirma que el tope global diario sigue exacto (contador en MongoDB) y asume que el tope de simultáneas y los limitadores de ráfaga se multiplican por el número de instancias.
- [ ] **Textos legales**: resuelve los `[[REVISAR: ...]]` (`grep -rn "REVISAR" packages/frontend/src/pages/Legal/legalContent`), en particular la retención de los registros del hosting, y haz que un abogado revise los textos de la demo (interés legítimo, art. 11 del RGPD, oposición).
- [ ] **Arranque en Render**: tras el despliegue con `DEMO_ENABLED` sin definir, el backend arranca, `GET /api/demo/status` responde 200 con `available: false` y `DEMO_HMAC_SECRET` aparece generado (no lo copies a ningún sitio).

**Al activar y los primeros días**:

- [ ] Pon `DEMO_ENABLED=true` y comprueba `GET /api/demo/status` (disponible). Haz una generación real desde un móvil y comprueba que el mock responde y caduca.
- [ ] **Ensaya el apagado de emergencia**: ponla en `false`, cronometra cuánto tarda en responder 503 y en desaparecer el enlace de la cabecera (cuenta con unos 90 s de caché), y vuelve a encenderla. Tiempo hasta el 503: ______.
- [ ] Revisa el contador global (`db.demobudgets.find({ day: "AAAA-MM-DD", scope: "global" })`) a mitad del primer día y al final: ¿se agota pronto?, ¿encaja con el gasto del proveedor? Si no encaja, apaga y revisa.
- [ ] Primera semana: busca en los logs de acceso rangos de red o `User-Agent` repetidos contra `/api/demo/generate` y valora subir `DEMO_POW_BITS` o bajar `DEMO_PER_IP_GENERATIONS`.
