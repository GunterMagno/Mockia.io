# IA propia: servicio LLM autoalojado en Docker

Guía para el titular de Mockia.io. Explica cuándo merece la pena ejecutar un modelo de código abierto en tu propio servidor, cómo levantarlo, cómo medirlo y cómo activarlo o apagarlo sin tocar código.

> **Estado de las mediciones.** Esta guía y los ficheros de compose se han verificado de forma estática (`docker compose config`, tests de YAML y del script). **No se ha arrancado ningún contenedor, no se ha descargado ningún modelo y no se ha medido nada**: no había daemon de Docker, GPU ni acceso a modelos en el entorno donde se escribió. Todas las cifras de hardware son **estimaciones a medir** y la tabla de resultados está vacía a propósito. Hasta que se rellene, el sistema sigue usando OpenRouter.

## 1. Cuándo y por qué

Usa un modelo propio si te interesa alguna de estas ventajas:

- **Privacidad**: cuando responde el modelo local, el contenido del repositorio del usuario (README, tipos, rutas) **no sale de tu servidor**. Con OpenRouter sí viaja a terceros.
- **Coste marginal predecible**: pagas la máquina, no cada token. Solo compensa a partir de cierto volumen: mídelo antes (apartado 3).
- **Independencia**: sin límites de cuota ni cambios de modelo ajenos.

No lo uses si el volumen es bajo (una máquina encendida 24 h cuesta más que unas pocas llamadas a OpenRouter) o si el modelo no alcanza la calidad mínima (apartado 6). **Incluir los ficheros de compose de IA no activa nada**: el backend sigue con `AI_PROVIDERS=openrouter` hasta que tú lo cambies.

## 2. Arquitectura

```
Navegador ─ nginx ─ /api/ai/ ─▶ backend ──(1) local ─▶ llm (Ollama o vLLM, red interna llm-net)
                                    └──────(2) reserva ─▶ OpenRouter
```

- Con `AI_PROVIDERS=local,openrouter` el backend prueba primero el modelo local y, si falla (parado, lento, 4xx/5xx, sobre de respuesta inválido, contenido vacío, respuesta cortada por `max_tokens` = `finish_reason: "length"`), cae a OpenRouter. Detalle en `docs/08_despliegue.md` (sección "IA: modelo propio con reserva automática").
- **Respuesta inválida (JSON roto o que no cumple el esquema)**: la cadena valida el texto con el mismo análisis y validación que aplica después la ruta. Si no vale, pide **una sola reparación al mismo proveedor** (un mensaje extra con el motivo, sin citar la respuesta) dentro del mismo plazo total; si la reparación tampoco vale, cuenta como fallo (también para el cortacircuitos) y pasa al siguiente proveedor. Solo si falla el último el usuario recibe un error (`502` "la IA devolvió una respuesta no válida"). Con la configuración por defecto (`AI_PROVIDERS=openrouter`) esto significa: una reparación y, si tampoco vale, `502`.
- Un `400`/`413`/`422` del modelo local depende de la petición (tamaño, parámetros), no de la salud del servidor: se pasa a la reserva pero **no** cuenta para el cortacircuitos. El cliente ya no elige temperatura ni `max_tokens` (los fija el servidor: `AI_SPEC_TEMPERATURE`, 0,85 por defecto, y 5000 tokens) y la descripción que escribe el usuario está limitada a 4000 caracteres.
- **Cortacircuitos**: tras 3 fallos seguidos el proveedor local se salta durante 60 s y luego se deja pasar una sola petición de prueba; un modelo parado no retrasa cada petición.
- **Plazos**: el modelo local tiene su timeout (`AI_LOCAL_TIMEOUT_MS`, 120 s por defecto, para la carga en frío) y toda la petición tiene un presupuesto total (`AI_TOTAL_TIMEOUT_MS`, 240 s) por debajo del `proxy_read_timeout` de nginx para `/api/ai/` (300 s).
- El servicio `llm` vive **solo** en la red interna de Docker. No tiene puertos publicados y nginx no sabe que existe.

### Qué ficheros hay

| Fichero | Para qué |
|---|---|
| `docker-compose.ai.yml` | Servicio `llm` con **Ollama**, volumen de modelos y variables del backend. Funciona sobre el compose de producción y el de desarrollo. |
| `docker-compose.ai.gpu.yml` | Añade la reserva de GPU NVIDIA a `llm`. En un servidor solo con CPU **no se incluye**. |
| `docker-compose.ai.vllm.yml` | Alternativa **vLLM** (más caudal, exige GPU NVIDIA). Sustituye a `docker-compose.ai.yml`; nunca se combinan. |
| `docker-compose.ai.eval.yml` | Opcional y **temporal**: publica el puerto del modelo solo en `127.0.0.1` para ejecutar el banco de evaluación. Se quita al terminar. |
| `scripts/pull-model.sh` | Descarga un modelo en Ollama y lo calienta. |

Las redes: el override crea una red propia (`llm-net`) y conecta a ella `llm` y `backend`; compose **suma** las redes del backend, así que no importa que el compose de desarrollo use `mockia-network` y el de producción `mockia-network-prod`.

## 3. Hardware: orientación (ESTIMACIONES, hay que medirlas)

Las cifras de abajo son órdenes de magnitud de la práctica habitual con modelos cuantizados a 4 bits (q4). **No están medidas en Mockia**; dependen de la longitud del contexto, del número de peticiones simultáneas y de la versión del servidor. El banco de evaluación (apartado 6) te da la latencia real de tu máquina.

| Modelo (ejemplo) | Memoria orientativa (ESTIMACIÓN) | Notas |
|---|---|---|
| 7B q4 | unos 5-6 GB de VRAM, o 8 GB de RAM en CPU | Punto de partida razonable. |
| 14B q4 | unos 9-11 GB de VRAM | Mejor calidad, más latencia. |
| 32B q4 | 20 GB de VRAM o más | Requiere una GPU grande. |

- **Solo CPU**: funciona, pero la generación de un JSON de varios endpoints puede tardar mucho más que el límite de 60 s de la regla de decisión. **Medir con el banco** antes de fiarse; puede ser válido solo para pruebas o poco tráfico.
- Cada petición simultánea (`OLLAMA_NUM_PARALLEL`) reserva su propio contexto: más memoria. Empieza en 1.
- El disco guarda los modelos en el volumen `ollama_models` (varios GB por modelo; ver apartado 8).
- `LLM_MEM_LIMIT` (por defecto `8g` en Ollama y `16g` en vLLM) limita la RAM del contenedor; súbelo si el modelo elegido no cabe.

### Tamaño del contexto (prerrequisito de cualquier medición)

Una petición real de generación de endpoints necesita, en tokens, aproximadamente: **presupuesto de contexto del repositorio (6000, `contextBudget` en `prompt.service.ts`) + prompt de sistema + `max_tokens` de salida (5000)**. Eso supera los 8192 tokens, así que el servidor debe arrancar con **al menos 16384** de contexto. Los ficheros de compose ya lo hacen por defecto; no lo bajes.

- **Ollama**: `OLLAMA_CONTEXT_LENGTH` (16384 por defecto en `docker-compose.ai.yml`). Si el contexto es pequeño, Ollama **trunca en silencio los tokens más antiguos, es decir, el prompt de sistema**, y el modelo responde a otra cosa sin ningún error: las métricas del banco quedarían falsamente bajas. Esa variable exige una versión de Ollama que la lea: **verifícalo contra la etiqueta fijada** (`OLLAMA_IMAGE`; ver las notas de versión de Ollama). Si tu versión no la lee, fija el contexto en el modelo con un Modelfile y usa ese nombre como `AI_LOCAL_MODEL`:
  ```bash
  docker compose <ficheros> exec -T llm sh -c 'printf "%s\n" "FROM qwen2.5-coder:7b-instruct" "PARAMETER num_ctx 16384" > /tmp/Modelfile && ollama create qwen2.5-coder-16k -f /tmp/Modelfile'
  # y en el .env: AI_LOCAL_MODEL=qwen2.5-coder-16k
  ```
- **vLLM**: `VLLM_MAX_MODEL_LEN` (16384 por defecto). Con menos, vLLM rechaza con **400** toda petición cuyo prompt + `max_tokens` no quepa, y el backend cae a OpenRouter cada vez (parecería "el local falla" cuando es un ajuste).
- **Coste en memoria**: el contexto se paga en **caché KV**, que crece con los tokens de contexto y con cada petición simultánea (`OLLAMA_NUM_PARALLEL`). Para un 7B suele ser del orden de 1 GB a 16384 tokens (**ESTIMACIÓN**, medir); duplicar el contexto o la concurrencia lo multiplica. Si no cabe, sube `LLM_MEM_LIMIT`/VRAM o elige un modelo menor; no reduzcas el contexto por debajo de 16384.

### Opciones de coste (sin precios: consulta los vigentes)

1. **Tu propia máquina o servidor**: coste de adquisición y electricidad; ideal para evaluar sin compromiso.
2. **GPU alquilada por horas**: sirve para medir un modelo grande y decidir antes de comprometerte; se apaga al terminar.
3. **VPS pequeño solo con CPU**: el más barato de mantener, pero probablemente demasiado lento para modelos de 7B o más (medir).
4. **Quedarte con OpenRouter**: sin infraestructura; es el comportamiento por defecto.

## 4. Puesta en marcha paso a paso

Prerrequisitos: Docker con Compose v2, el `.env` de producción rellenado (ver `.env.example`) y, si hay GPU, driver NVIDIA + NVIDIA Container Toolkit (`docker run --rm --gpus all ubuntu nvidia-smi` debe funcionar).

1. **Elige los ficheros de compose.**
   - Producción con CPU: `docker-compose.prod.yml` + `docker-compose.ai.yml`.
   - Producción con GPU NVIDIA: añade `docker-compose.ai.gpu.yml`.
   - Producción con vLLM (solo GPU): `docker-compose.prod.yml` + `docker-compose.ai.vllm.yml`.
   - Desarrollo: `docker-compose.yml` + `docker-compose.ai.yml`.
2. **Revisa la etiqueta de la imagen.** Las imágenes están fijadas por versión (`OLLAMA_IMAGE`, `VLLM_IMAGE`). **Comprueba que la etiqueta existe** en Docker Hub (`ollama/ollama`, `vllm/vllm-openai`) y, si no, pon otra en el `.env`. Nunca `latest`.
3. **Levanta el servicio**:
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml up -d llm
   docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml ps     # llm debe pasar a "healthy"
   ```
4. **Descarga el modelo** (solo Ollama; vLLM lo descarga al arrancar a la caché `hf_cache`):
   ```bash
   scripts/pull-model.sh qwen2.5-coder:7b-instruct
   # Desarrollo:  COMPOSE_FILES="docker-compose.yml docker-compose.ai.yml" scripts/pull-model.sh qwen2.5-coder:7b-instruct
   # Con GPU:     COMPOSE_FILES="docker-compose.prod.yml docker-compose.ai.yml docker-compose.ai.gpu.yml" scripts/pull-model.sh ...
   ```
   El script valida el nombre del modelo, descarga con `ollama pull` y hace una generación mínima para que el modelo quede cargado (`OLLAMA_KEEP_ALIVE=24h` lo mantiene). `SKIP_WARMUP=1` omite el calentamiento.
5. **Mide el modelo antes de activarlo** (apartado 6).
6. **Actívalo** en el `.env` y recrea el backend:
   ```
   AI_PROVIDERS=local,openrouter
   AI_LOCAL_BASE_URL=            # vacío con compose: usa http://llm:11434 (Ollama) o http://llm:8000 (vLLM)
   AI_LOCAL_MODEL=qwen2.5-coder:7b-instruct
   ```
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml up -d backend
   docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml logs backend | grep "\[AI\]"
   ```
   Con `local` en la cadena, el backend en producción exige `AI_LOCAL_BASE_URL` válida: los ficheros de compose ya la rellenan. Si la apuntas a otro sitio en el `.env`, **compose la usará tal cual**.

## 5. Variables

| Variable | Dónde | Efecto |
|---|---|---|
| `AI_PROVIDERS` | backend | `openrouter` (defecto) o `local,openrouter`. |
| `AI_LOCAL_BASE_URL` | backend | Raíz del servidor **sin `/v1`**. Con compose, vacía = `http://llm:11434` (Ollama). En el override de vLLM está fija en `http://llm:8000`. |
| `AI_LOCAL_MODEL` | backend | Nombre del modelo (Ollama: `qwen2.5-coder:7b-instruct`). Con vLLM se toma de `VLLM_MODEL`. |
| `AI_LOCAL_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`, `AI_LOCAL_API_KEY` | backend | Plazos y clave opcional (ver `docs/08_despliegue.md`). |
| `OLLAMA_IMAGE`, `OLLAMA_NUM_PARALLEL`, `OLLAMA_CONTEXT_LENGTH`, `LLM_MEM_LIMIT` | compose | Imagen fijada, concurrencia, contexto (16384 por defecto, ver apartado 3) y tope de RAM. |
| `VLLM_IMAGE`, `VLLM_MODEL`, `VLLM_MAX_MODEL_LEN`, `VLLM_GPU_MEMORY_UTILIZATION`, `VLLM_SHM_SIZE`, `HF_TOKEN` | compose | Parámetros de vLLM. |
| `COMPOSE_FILES`, `COMPOSE_ENV_FILE`, `SKIP_WARMUP` | `scripts/pull-model.sh` | Qué ficheros usa el script, `.env` alternativo y omitir el calentamiento. |

## 6. Evaluación y regla de decisión

> **Windows.** Los comandos `VAR=valor comando` y los scripts `.sh` de esta guía son de bash: ejecútalos en Linux, macOS o **Git Bash** (o WSL). En PowerShell fija antes cada variable (`$env:AI_LOCAL_BASE_URL = 'http://127.0.0.1:11434'`) y escribe el comando en una sola línea, sin la `\` final; `scripts/pull-model.sh` necesita Git Bash o WSL.

El banco (`packages/backend/evals/`, ver su `README.md`) ejecuta 36 casos con el prompt y el validador reales de producción y devuelve `schemaValid`, F1 de método+ruta, cobertura de campos y latencias.

1. **Línea base de OpenRouter (paso manual del titular, una vez, con tu clave).** Todavía **no existe** `evals/baseline.json`. **Fija `OPENROUTER_MODEL` al modelo que usa producción** (sin ella se mide el modelo por defecto del código, que puede estar retirado y no es el de producción):
   ```bash
   AI_PROVIDERS=openrouter OPENROUTER_API_KEY=... OPENROUTER_MODEL=<modelo-de-produccion> npm run eval -w @mockia/backend -- --provider=openrouter --no-fail
   cp packages/backend/evals/results/<fichero-generado>.json packages/backend/evals/baseline.json
   ```
2. **Haz accesible el modelo local desde donde ejecutas el banco.** El servicio no publica puertos; para medir, añade temporalmente `docker-compose.ai.eval.yml` (publica solo en `127.0.0.1`) o usa un túnel SSH:
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml -f docker-compose.ai.eval.yml up -d llm
   ```
3. **Mide cada candidato** (7B, 14B, otra cuantización...), descargado antes con `scripts/pull-model.sh`:
   ```bash
   AI_LOCAL_BASE_URL=http://127.0.0.1:11434 \
     npm run eval -w @mockia/backend -- --provider=local --model=qwen2.5-coder:7b-instruct --no-fail \
     --compare=evals/baseline.json
   ```
   Lanza una petición de calentamiento antes o descarta la primera fila: la primera llamada incluye la carga del modelo. Mide con `--concurrency=1` si quieres latencias comparables.
4. **Quita `docker-compose.ai.eval.yml`** (vuelve a levantar sin él) al terminar.

> **Prerrequisito para una medición justa:** el servidor debe tener un contexto de **al menos 16384 tokens** (apartado 3, "Tamaño del contexto"). Con un contexto menor Ollama trunca el prompt de sistema o vLLM rechaza las peticiones con 400, y el resultado no representa al modelo. Comprueba `OLLAMA_CONTEXT_LENGTH` / `VLLM_MAX_MODEL_LEN` antes de ejecutar el banco, y que la fila de resultados no esté dominada por errores `http_400`.

### Regla de decisión (del plan)

Un modelo puede sustituir a OpenRouter **solo si cumple las tres**: `schemaValid` ≥ **95 %**, F1 medio ≥ **0.85** y latencia p95 ≤ **60 s**. El informe termina en `PASS` o `FAIL`.

- **Si cumple**: activa `AI_PROVIDERS=local,openrouter` (apartado 4, paso 6) y anota el resultado abajo.
- **Si no cumple** con prompt + esquema restringido: **no lo actives**; pasa a la **Tarea 15** (recoger datos propios y afinar con LoRA, ver [`docs/ia-entrenamiento.md`](ia-entrenamiento.md)) o prueba otro modelo/cuantización.

### Resultados (a rellenar por el titular)

Cada fila se completa a mano con el resumen que imprime el banco. Fecha y hardware incluidos, porque las latencias solo valen para esa máquina.

| Modelo | Hardware | schemaValid % | F1 medio | fieldCoverage | p95 (s) | Veredicto |
|---|---|---|---|---|---|---|
| OpenRouter (línea base) | n/a | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular |
| Qwen2.5-Coder 7B instruct (q4) | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular |
| Qwen2.5-Coder 14B instruct (q4) | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular |
| Otra cuantización o modelo | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular | pendiente de medir por el titular |

## 7. Seguridad

- **Ningún puerto publicado.** La API de Ollama/vLLM no tiene autenticación: quien la alcance puede gastar tu GPU y descargar o borrar modelos. Por eso `llm` no tiene `ports:` y hay tests que lo comprueban.
- **No hagas proxy del modelo.** `nginx.conf` no debe tener ningún `location` ni `upstream` hacia `llm` (lo vigila `deploy.aiCompose.test.ts`).
- **Cortafuegos del servidor**: solo 80/443 (y SSH restringido). Si necesitas medir desde otra máquina, usa un túnel SSH y no abras el puerto.
- `docker-compose.ai.eval.yml` publica solo en `127.0.0.1`; quítalo tras medir.
- Si alguna vez expones vLLM fuera de la red interna, arráncalo con `--api-key` y configura `AI_LOCAL_API_KEY`.
- Los registros del backend no contienen prompts ni respuestas del modelo, solo el proveedor y la clase de fallo.
- El contenedor tiene salida a Internet para descargar modelos. Si quieres cerrarla una vez descargado el modelo, hazlo con las reglas de cortafuegos del anfitrión (el volumen conserva los modelos).

## 8. Operación

- **Logs**: `docker compose <ficheros> logs -f llm` y, para ver qué proveedor responde, `logs backend | grep "\[AI\]"` (líneas `Provider "local" failed (...)`; `provider=... model=...` en cada generación).
- **Estado**: `docker compose <ficheros> ps` (la columna de salud usa `ollama list`, o `/health` en vLLM). `restart: unless-stopped` lo reinicia solo.
- **Actualizar el servidor**: cambia `OLLAMA_IMAGE` (o `VLLM_IMAGE`) a una etiqueta concreta que exista, `docker compose <ficheros> pull llm && docker compose <ficheros> up -d llm`, y **vuelve a pasar el banco**: una versión nueva puede cambiar el comportamiento.
- **Actualizar o cambiar de modelo**: `scripts/pull-model.sh <modelo>`, ajusta `AI_LOCAL_MODEL`, recrea el backend y vuelve a medir. Para quitar uno: `docker compose <ficheros> exec llm ollama rm <modelo>`.
- **Disco**: los modelos viven en el volumen `ollama_models` (o `hf_cache` en vLLM); mira su tamaño con `docker system df -v` y borra los que no uses.
- **Copias de seguridad**: no hacen falta, los modelos se pueden volver a descargar. No hay datos de usuario en el contenedor `llm`.
- **Memoria**: si el contenedor muere por falta de memoria (OOM), sube `LLM_MEM_LIMIT`, baja `OLLAMA_NUM_PARALLEL` o elige un modelo más pequeño.

## 9. Cómo apagarlo

Sin tocar código: pon `AI_PROVIDERS=openrouter` en el `.env` y recrea el backend (`docker compose <ficheros> up -d backend`). Desde ese momento ninguna petición llega al modelo local. Para liberar recursos, `docker compose <ficheros> stop llm` (o levanta de nuevo sin los ficheros de IA). Los modelos descargados siguen en el volumen; `docker volume rm` los elimina.

## 10. Simulacro de caída (checklist manual, pendiente de ejecutar)

Comprueba una vez, con el modelo activado, que la caída del modelo no se nota para el usuario. Hay dos fallos distintos y dan clases distintas en el log (`classifyFailure`):

**A. Contenedor parado (fallo rápido).** Al parar el contenedor su nombre `llm` deja de resolverse en la red de compose, así que la clase esperada es `dns_error`. `connection_refused` solo aparece si el contenedor sigue en marcha pero el servidor no escucha (p. ej. proceso del modelo caído o aún arrancando).

- [ ] `AI_PROVIDERS=local,openrouter` y `OPENROUTER_API_KEY` válida; el backend arrancó y `logs backend` muestra la cadena configurada.
- [ ] Lanza una generación desde la aplicación: funciona y el log indica `provider=local`.
- [ ] Para el modelo: `docker compose <ficheros> stop llm`.
- [ ] Lanza otra generación: **el usuario recibe la respuesta sin error**.
- [ ] `docker compose <ficheros> logs backend | grep "\[AI\]"` muestra `Provider "local" failed (dns_error); falling back to "openrouter"` (o `connection_refused` si el contenedor seguía en marcha) y la generación con `provider=openrouter`.
- [ ] Repite 3 veces: a partir de la tercera caída seguida el log deja de intentar el local durante ~60 s (cortacircuitos abierto).
- [ ] Arranca de nuevo (`start llm`), espera más de 60 s, genera otra vez: vuelve a `provider=local`.

**B. Modelo colgado o lento (fallo caro).** `docker compose <ficheros> pause llm` congela el contenedor: sigue resolviéndose y acepta conexiones, pero no responde. La clase esperada es `timeout`.

- [ ] `docker compose <ficheros> pause llm` y lanza una generación.
- [ ] La petición **tarda hasta `AI_LOCAL_TIMEOUT_MS`** (120 s por defecto) antes de caer a OpenRouter, y como máximo hasta el plazo total `AI_TOTAL_TIMEOUT_MS` (240 s); el usuario recibe la respuesta de OpenRouter si queda presupuesto, o un 504 si se agotó. No es un fallo del simulacro: es el coste de un modelo colgado.
- [ ] El log muestra `Provider "local" failed (timeout); falling back to "openrouter"`.
- [ ] Repite hasta 3 fallos seguidos: este es el caso en que el **cortacircuitos** importa, porque a partir de ahí las peticiones dejan de esperar el timeout y van directas a OpenRouter durante ~60 s.
- [ ] `docker compose <ficheros> unpause llm`; pasado el minuto vuelve a `provider=local`.
- [ ] Anota fecha y resultado aquí o en el registro de operaciones.

## 11. Límites conocidos

- **Licencias de los modelos.** Antes de usar un modelo en un servicio comercial, **lee la licencia de su ficha**. Para la familia Qwen2.5-Coder, según lo que se sabía al escribir esta guía, varias tallas son Apache-2.0 (7B, 14B, 32B) pero la de 3B usa una licencia de investigación distinta. **Verifícalo en la ficha oficial del modelo** (Hugging Face / Ollama) antes de apoyarte en ello; no lo des por bueno por esta nota.
- La calidad de la salida estructurada depende de que el servidor respete el `json_schema` estricto; vLLM y Ollama lo hacen, pero no está verificado en Mockia (ver el banco). Si el servidor lo rechaza con un 400, el backend cae a OpenRouter, y una configuración errónea persistente se ve como avisos en los logs, no como errores al usuario.
- La latencia en frío (primera carga) puede ser de decenas de segundos; `OLLAMA_KEEP_ALIVE` y el calentamiento del script la evitan mientras el contenedor no se reinicie.
- Las etiquetas de imagen del repositorio (`ollama/ollama:0.6.5`, `vllm/vllm-openai:v0.8.5`) son puntos de partida: confirma que existen y actualízalas conscientemente.
- **Privacidad**: el beneficio solo aplica cuando responde el modelo local. Si cae a OpenRouter, el contenido del repositorio viaja a ese tercero (ver la Política de Privacidad). Si necesitas garantía total, no incluyas `openrouter` en `AI_PROVIDERS` (a costa de que un fallo del modelo se vea como error).
