# Demo pública sin registro: operación

La demo permite a cualquiera generar una API simulada con IA **sin crear cuenta**. Gasta dinero real (cada generación llama a un modelo), así que está pensada para que el gasto máximo sea conocido y acotado, y para que apagarla sea inmediato. Este documento es la guía del titular: variables, cómo activarla y apagarla, cómo calibrarla y qué vigilar.

Un test (`packages/backend/src/tests/demo.docs.test.ts`) ata este documento al código: las variables `DEMO_*` que se citan aquí son exactamente las que lee `getDemoConfig` y las de los dos `.env.example`, y los valores por defecto de la tabla son los reales. Si cambias una variable, actualiza este documento (el test fallará si no lo haces).

## Qué hace la demo (resumen de límites)

| Concepto | Valor | Dónde se aplica |
|---|---|---|
| Entrada | texto pegado de hasta 6 000 caracteres, o una de 3 plantillas; nunca una URL de GitHub | servidor |
| Generaciones por visitante y día UTC | `DEMO_PER_IP_GENERATIONS` | contador en MongoDB, exacto con varias instancias |
| Generaciones de toda la demo por día UTC | `DEMO_DAILY_GENERATIONS` | contador global en MongoDB, exacto con varias instancias |
| Prueba de trabajo (hashcash SHA-256) | `DEMO_POW_BITS` bits | el navegador la resuelve; el servidor la verifica y la gasta una sola vez |
| Generaciones simultáneas | `DEMO_MAX_CONCURRENT` en total y 1 por visitante | **por proceso** (ver "Varias instancias") |
| Salida | como máximo 5 endpoints, respuestas de hasta 8 KB, 2 000 tokens de salida | servidor |
| Plazo de la generación | `AI_DEMO_TIMEOUT_MS` (45 s por defecto) | servidor |
| Vida de la API simulada | `DEMO_MOCK_TTL_MINUTES` minutos | índice TTL de MongoDB (puede tardar hasta ~1 minuto más en borrar) |
| Peticiones que sirve cada API simulada | 150, y 300 por visitante y día | MongoDB |

Lo que **no** hay en la demo: claves de API, exportación, visibilidad privada, retardos simulados largos. Para conservar una API hay que registrarse.

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
| `DEMO_MAX_CONCURRENT` | `4` | Generaciones que pueden ejecutarse a la vez en un proceso. |
| `DEMO_POW_BITS` | `18` | Ceros iniciales exigidos al hash de la prueba de trabajo (1 a 24). Cada bit duplica el trabajo medio. |
| `DEMO_MOCK_TTL_MINUTES` | `30` | Minutos que vive una API simulada de la demo. **Los textos legales prometen 30 minutos**: si lo cambias, actualiza Privacidad y Términos en los tres idiomas. |

Variables de IA de la demo (no son `DEMO_*`: viven en `config/ai.ts` y se leen aparte):

| Variable | Defecto | Qué hace |
|---|---|---|
| `AI_DEMO_PROVIDERS` | vacío (= `AI_PROVIDERS`) | Lista de proveedores solo para la demo, con la misma sintaxis que `AI_PROVIDERS` (`local`, `openrouter`). Permite apuntar la demo a un modelo más barato o propio mientras los usuarios registrados conservan el suyo. La demo tiene siempre su propia cadena y su propio cortacircuitos: una demo que falla nunca corta la IA de los usuarios. |
| `AI_DEMO_TIMEOUT_MS` | `45000` | Plazo total de una generación de la demo. Una petición que ya salió hacia el proveedor cuenta como gastada aunque venza el plazo. |

## Estado del despliegue (pendiente de la tarea B7)

Estado de cada fichero (una línea por fichero; el test las comprueba por separado y solo cuenta variables reales, no comentarios):

- `render.yaml`: **NO reenvía** ninguna variable `DEMO_*` ni `AI_DEMO_*` al backend.
- `docker-compose.prod.yml`: **NO reenvía** ninguna variable `DEMO_*` ni `AI_DEMO_*` al backend.

Mientras no lo hagan, la demo no se puede activar en esos despliegues (solo con un `.env` en local). La tarea B7 las añade; cuando lo haga, **hay que editar la línea del fichero afectado** (el test `demo.docs.test.ts` falla a propósito en ese momento hasta que esa línea diga que sí reenvía; un reenvío parcial solo obliga a corregir el fichero que cambió).

## Activar la demo

Hazlo en este orden; no actives nada hasta el paso 5.

1. **Genera el secreto**: `openssl rand -hex 32` (64 caracteres; el mínimo son 32 caracteres). Guárdalo como secreto del servicio, nunca en el repositorio. Rotarlo con la demo en marcha invalida los retos pendientes y además **reinicia los cupos del día** (cambia todos los seudónimos de IP), así que no lo rotes como rutina.
2. **Mide la tasa de truncado del prompt de la demo con el modelo real, antes de activarla.** La demo pide como máximo 2 000 tokens de salida y, si el modelo se queda corto (`finish_reason: length`), no hay reparación y el intento del visitante queda gastado. Ejecuta `npm run eval -w @mockia/backend -- --provider=openrouter --max-tokens=2000` (o `--provider=local`; ver `packages/backend/evals/README.md`) con el mismo modelo que usará la demo (`OPENROUTER_MODEL`, o el de `AI_DEMO_PROVIDERS`). Ojo: el banco usa el prompt estándar (5 a 10 endpoints), más largo que el de la demo (3 a 5 endpoints pequeños), así que el truncado que mida es una **cota pesimista**. Si es alto, sube el modelo o no actives la demo.
3. **Calibra `DEMO_POW_BITS`** (siguiente apartado).
4. **Comprueba `TRUST_PROXY`** (apartado "Comprobación de TRUST_PROXY"): sin identificar bien la IP los cupos por visitante no valen nada.
5. **Revisa los textos legales** (`/privacy`, `/terms`, `/cookies`): son un borrador pendiente de revisión jurídica y llevan marcadores `[[REVISAR: ...]]` que el titular o su abogado deben resolver. Haz `grep -rn "REVISAR" packages/frontend/src/pages/Legal/legalContent` y no actives la demo mientras quede alguno sin resolver (hoy: `[[REVISAR: retención de logs del hosting]]`, en Privacidad, en los tres idiomas).
6. Configura `DEMO_HMAC_SECRET`, `DEMO_ENABLED=true` y, si quieres, los límites y `AI_DEMO_*`, y reinicia. Comprueba `GET /api/demo/status` (debe decir que está disponible) y haz una generación real desde un navegador.

## Apagar la demo

Pon `DEMO_ENABLED=false` y reinicia o redesplega el backend. Efecto inmediato: `generate` y `challenge` de `/api/demo/*` y todo `/api/demo-mock/*` (incluidas las API simuladas que aún no habían caducado) responden 503, y `GET /api/demo/status` responde 200 con `available: false` (la página lo usa para avisar); los usuarios registrados, su IA y sus cuotas no se ven afectados (la demo tiene su propio presupuesto y su propia cadena de IA). No hace falta el secreto para apagarla. Los datos de la demo se borran solos (ver "Qué se guarda").

Es el primer recurso ante abuso o gasto inesperado: apagar es barato, reactivar es una variable.

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

Con los valores por defecto, 75 visitantes con 2 generaciones cada uno (`DEMO_DAILY_GENERATIONS` ÷ `DEMO_PER_IP_GENERATIONS`) bastan para **agotar el presupuesto global del día**; con IP distintas (una red móvil, una botnet pequeña) es algo que un grupo reducido puede hacer a propósito. Es una decisión consciente: el tope global es lo que acota el gasto, y el precio es que la demo puede quedarse sin cupo ese día para el resto. La prueba de trabajo sube el coste de hacerlo, no lo impide. Si te preocupa: sube `DEMO_POW_BITS`, baja `DEMO_PER_IP_GENERATIONS` a 1, baja `DEMO_DAILY_GENERATIONS`, o apaga la demo.

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

1. Haz una petición a `GET /api/demo/status` desde dos redes distintas y mira en los logs del backend la primera columna (la IP): deben salir dos IP públicas distintas.
2. Repite con `curl -H "X-Forwarded-For: 203.0.113.7" https://<backend>/api/demo/status`. En el log no debe aparecer `203.0.113.7` como IP del cliente.
3. Ojo con la topología: `render.yaml` fija `TRUST_PROXY=2` porque el navegador llega a la API a través de la reescritura `/api/*` del frontend más el balanceador de Render (dos saltos). Una llamada **directa** al backend atraviesa un solo salto, así que con ese valor un cliente que llame directamente a la URL pública del backend podría falsificar su IP. Si el paso 2 la deja pasar contra el backend directo, los cupos por visitante se pueden esquivar rotando esa cabecera: en ese caso la defensa que queda es el tope global diario, y conviene restringir el acceso directo al backend o acotar la demo con valores más estrictos.

## Qué se guarda (y cuánto)

Resumen operativo de lo que los textos legales declaran; si algo de esto cambia, cambian los textos.

| Dato | Dónde | Plazo |
|---|---|---|
| Texto pegado por el visitante | en ningún sitio (solo se envía al proveedor de IA) | no se guarda |
| IP del visitante | solo como HMAC-SHA256 con sal que cambia cada día UTC (IPv6 por /64), nunca en claro en la base de datos. El seudónimo por sí solo no permite seguir a un visitante de un día a otro, pero quien tenga el secreto puede recalcular el de una IP conocida, y los logs de acceso (última fila) sí contienen la IP en claro y enlazan días | ver contadores |
| Contadores diarios (visitante y global) | colección `demobudgets` | caducan por TTL: 48 h después de acabar el día que cuentan, más hasta ~1 min de retraso de MongoDB |
| API simulada y su contenido | colección `demomocks` (guarda también el seudónimo de la IP) | `DEMO_MOCK_TTL_MINUTES` minutos (30), más hasta ~1 min de retraso de MongoDB |
| Retos de prueba de trabajo ya usados | colección `demospentchallenges` (id aleatorio) | 10 minutos |
| Límites de ráfaga | memoria del proceso | se pierden al reiniciar |
| **Logs de acceso del servidor (morgan)** | salida estándar del backend; la plataforma de alojamiento los retiene | **no verificable desde el código**: `[[REVISAR: retención de logs del hosting]]` |

**Los logs de acceso guardan la IP en claro y la URL completa** (formato `combined` de morgan; también del proxy inverso o de la plataforma). Incluyen el identificador aleatorio de cada API simulada, pero no el texto del visitante ni la respuesta del modelo. La Política de Privacidad lo declara y deja la retención como pendiente: averigua cuánto conserva tu proveedor (en Render depende del plan; con `docker-compose.prod.yml` son los logs de Docker y de nginx, que no rotan por defecto) y sustituye el marcador por el dato real, o reduce la retención si es excesiva.

## Qué mirar si hay abuso

- **Síntomas**: la demo se queda sin cupo antes de lo previsto (503 con el mensaje de "sin cupo"), muchos 429, picos de generaciones, el proveedor de IA factura más de lo calculado.
- **Contadores**: en MongoDB, `db.demobudgets.find({ day: "AAAA-MM-DD", scope: "global" })` da las generaciones gastadas hoy frente a `DEMO_DAILY_GENERATIONS`; `scope: "ip"` lista los seudónimos con su cuenta (no se pueden asociar a una IP real sin el secreto y el día).
- **Logs de acceso**: patrones de peticiones a `/api/demo/generate` y `/api/demo-mock/*` por IP en claro, el mismo `User-Agent`, rangos de red concretos.
- **Acciones, de menos a más drásticas**: subir `DEMO_POW_BITS`; bajar `DEMO_PER_IP_GENERATIONS` y `DEMO_DAILY_GENERATIONS`; bloquear rangos en el proxy o la plataforma; apagar con `DEMO_ENABLED=false`.
- **Comprueba `TRUST_PROXY`** de nuevo: un `X-Forwarded-For` falsificado que se acepta explica cupos "infinitos" por visitante.

## Resultado de las pruebas de abuso

Pendiente (tarea B7): `demo.abuse.test.ts` y la lista de comprobaciones manuales que no se pueden hacer en local (IP real tras el proxy de Render, varias instancias, dificultad de la prueba de trabajo en móviles reales).
