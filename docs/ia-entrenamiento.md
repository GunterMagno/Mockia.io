# IA propia: datos con consentimiento y ajuste fino (LoRA) opcional

Guía para el titular de Mockia.io. Explica cómo se recogen, solo con consentimiento explícito, ejemplos reales para evaluar y, si hace falta, **ajustar un modelo propio**; cómo se exportan sin identificadores; y el procedimiento para entrenar un adaptador LoRA y decidir si se promociona.

> **Estado.** Lo que hay **implementado y probado**: el consentimiento, el guardado de generaciones y valoraciones, el borrado al retirar el consentimiento o la cuenta, la exportación al RGPD, el exportador de dataset con redacción de secretos, y la conversión del conjunto reservado en casos del banco de evaluación. Lo que **no se ha ejecutado** y **no se puede ejecutar sin que lo hagas tú**: el entrenamiento (necesita una GPU alquilada) y la reevaluación del modelo ajustado (necesita el modelo y las mediciones de `docs/ia-local.md`). Esta guía es un **runbook**: no contiene ningún resultado, precio ni cifra de rendimiento medidos. Los valores de hiperparámetros son **puntos de partida a ajustar**, no recetas validadas.

## 1. Cuándo merece la pena ajustar un modelo

Ajustar (fine-tuning) es el **último** recurso, no el primero. Hazlo solo si se cumplen **las dos** condiciones:

1. **La evaluación local de la Tarea 14 falla.** Mediste el modelo local con el banco (`docs/ia-local.md`, apartado 6) usando el prompt de producción y el esquema JSON restringido, y no cumple la regla de decisión (`schemaValid` ≥ 95 %, F1 medio ≥ 0,85, latencia p95 ≤ 60 s). Antes de ajustar, prueba lo barato: otro modelo, otra cuantización, un modelo mayor, mejorar el prompt.
2. **Tienes al menos ~500 ejemplos buenos** tras exportar (el contador del exportador, apartado 4). Es el umbral del plan, un mínimo práctico orientativo: con menos, el riesgo de sobreajustar y de aprender los errores del modelo actual supera el posible beneficio. Que haya 500 no garantiza que baste; mide.

Coste/beneficio: las guías sobre este tema suelen situar el cruce en que ajustar y servir un modelo propio sale más barato que pagar por token en **volúmenes altos**; no hay una cifra universal, depende de tu tráfico, de tu GPU y de lo que cobre el proveedor de IA en ese momento. **Calcúlalo con tus números** antes de alquilar nada. Si el tráfico es bajo, seguir con OpenRouter es lo razonable.

## 2. Flujo de datos

```
usuario activa el consentimiento (perfil → "Mis datos", opcional, apagado por defecto)
        │  PUT /users/me/ai-consent {granted:true}      → User.aiTrainingConsent {granted, at, grantedAt, withdrawnAt}
        ▼
genera endpoints con IA (generate-mock-api-spec / generate-and-save)
        │  la respuesta lleva siempre `generationId` (UUID aleatorio)
        │  SOLO con consentimiento vigente se guarda AiGeneration:
        │  {generationId, userId, messages (prompts tal cual se enviaron), output, parsedOk, provider, model, createdAt}
        │  TTL: 180 días (AI_GENERATION_RETENTION_DAYS)
        ▼
el usuario vota 👍/👎 (POST /ai/feedback)
        │  sin consentimiento: NO se guarda nada (ni el voto); la respuesta es la misma 204 (ruling R14)
        │  con consentimiento y generación propia guardada: AiFeedback enlazada (+ correctedOutput validado, solo vía API)
        │  con consentimiento y generación no guardada (anterior al consentimiento): solo {userId, generationId, verdict}
        ▼
npm run ai:export-dataset -- --confirm-consent-checked        (decisión humana, apartado 4)
        │  1. solo usuarios con consentimiento VIGENTE en este momento
        │  2. solo feedback 'good' o con corrección
        │  3. redacción de secretos y emails en cada mensaje y en el objetivo
        │  4. deduplicado exacto
        │  5. reparto determinista train/val por hash del generationId
        ▼
train.jsonl + val.jsonl (sin email, userId ni generationId)  →  entrenamiento (apartado 6)  →  evaluación (apartado 8)
```

Dónde vive cada cosa:

| Dato | Colección | Se borra | En la exportación RGPD |
|---|---|---|---|
| Consentimiento y sus fechas (`grantedAt` se conserva al retirarlo y se añade `withdrawnAt`; `at` = última elección, por compatibilidad) | `users.aiTrainingConsent` | con la cuenta | sí (`account.aiTrainingConsent`) |
| Prompts, respuesta, proveedor, modelo | `aigenerations` | al retirar el consentimiento, al borrar la cuenta, a los 180 días | sí (`aiGenerations`) |
| Voto, corrección (solo usuarios que consintieron) | `aifeedbacks` | igual (los votos sin contenido también) | sí (`aiFeedback`) |

Los prompts pueden incluir **fragmentos del README y de los tipos del repositorio del usuario**: es dato personal potencial y se trata como tal. Nunca se escribe en registros (los `console.*` solo llevan clases de error y recuentos).

## 3. Operación de la recogida

- **Variable**: `AI_GENERATION_RETENTION_DAYS` (por defecto 180; solo entero positivo, tope 3650). Se aplica al guardar: cambiarla no acorta lo ya guardado.
- **Sin consentimiento no se persiste nada: ni el contenido ni el voto** (ruling R14). El `generationId` se devuelve igualmente y `POST /ai/feedback` responde 204 como siempre, de modo que la interfaz no cambia; la petición se valida y una generación ajena sigue dando 404.
- **Borrar la cuenta** retira primero el consentimiento y después borra las colecciones del usuario, de modo que una generación que un token ya obsoleto termine justo entonces se retira sola (comprobación posterior a la escritura) y no queda ninguna fila huérfana.
- **Retirar el consentimiento** (`PUT /users/me/ai-consent {granted:false}` → 204) marca el flag **antes** de borrar y luego borra todas las generaciones y valoraciones del usuario; una generación que se estuviera guardando en ese instante se retira sola (se comprueba el consentimiento antes y después de escribir).
- **Un usuario solo puede valorar sus propias generaciones**: una ajena responde 404 sin guardar nada. (El `generationId` es un UUID aleatorio de 122 bits y la ruta tiene límite por usuario, de modo que descubrir un id ajeno por fuerza bruta no es realista.)
- **Copias de seguridad de la base de datos**: el borrado no alcanza a las copias del proveedor hasta que rotan; es el mismo límite que el resto de datos de la cuenta (`docs/08_despliegue.md`).

## 4. Exportar el dataset

```bash
npm run ai:export-dataset -w @mockia/backend -- --confirm-consent-checked
# otra carpeta o proporción de validación:
npm run ai:export-dataset -w @mockia/backend -- --confirm-consent-checked --out ./ai-datasets --val-ratio 0.1
# alternativa a la bandera (para scripts): AI_EXPORT_CONFIRM=1
```

- **Se niega a ejecutarse** sin `--confirm-consent-checked` o `AI_EXPORT_CONFIRM=1` (cualquier otro valor no vale), y no llega a abrir la base de datos. La bandera existe para que la exportación sea un acto deliberado.
- **Imprime solo recuentos** (incluidos, train/val, duplicados, excluidos por motivo). Nunca contenido.
- **Salida** en `--out` (por defecto `./ai-datasets`, ya en `.gitignore` junto con `*.jsonl`): `train.jsonl` y `val.jsonl`, con modo **0600** (carpeta 0700 si la crea él). Un ejemplo por línea:
  ```json
  {"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"{\"apiVersion\":...}"}]}
  ```
- **Qué entra**: usuarios cuyo consentimiento está concedido **ahora** (se vuelve a comprobar en la exportación, de modo que quien lo retiró desde la última vez queda fuera aunque su valoración existiera); generaciones no caducadas con valoración `good` o con corrección. **Objetivo** del ejemplo: la corrección del usuario si la hay; si no, la respuesta del modelo cuando el voto es `good` y se parsea y valida con el validador de producción (se guarda el JSON limpio, sin vallas de markdown ni prosa). Un `bad` sin corrección, una corrección que ya no valida, una respuesta que no parsea o una generación sin voto **no entran**.
- **Redacción de los prompts** (`modules/ai/redact.ts`, función pura e idempotente; estricta, porque llevan contenido real del usuario), con marcadores estables `[REDACTED_KEY]` y `[REDACTED_EMAIL]`: claves de Stripe (`sk_live_…`, `sk_test_…`, `pk_…`), `sk-…` (OpenAI/OpenRouter/Anthropic), GitHub (`ghp_`, `gho_`, `github_pat_`…), AWS (`AKIA…`), Google (`AIza…`), Slack (`xox[baprs]-…`), JWT, `Bearer <token>`, bloques PEM de clave (también truncados), URLs con credenciales (`mongodb(+srv)://usuario:clave@…`), asignaciones `password|secret|token|api_key = valor` y direcciones de correo. No toca tipos ni lectura de entorno (`password: string`, `process.env.JWT_SECRET`) para no estropear los ejemplos.
- **Identificadores del repositorio y del proyecto** (`modules/ai/anonymize.ts`, función pura e idempotente, probada con el prompt real de `buildPromptFromInput`): en cada mensaje se sustituyen por `[REDACTED_REPO]`, `[REDACTED_OWNER]`, `[REDACTED_BRANCH]`, `[REDACTED_PROJECT]` y `[REDACTED_DESCRIPTION]` el bloque `## Repository / URL / Owner / Branch`, el nombre y la descripción del proyecto (con y sin repositorio) y cualquier URL `github.com`, `gitlab.com`, `bitbucket.org` o `codeberg.org` (también `git@host:propietario/repo`).
- **Asimetría deliberada: el objetivo se redacta de forma más suave.** La respuesta del asistente es una especificación con datos de ejemplo sintéticos (`john.doe@example.com`, `"password": "Secret123!"`, `"token": "abc123"`) que es justo lo que el modelo debe aprender; sustituirlos por marcadores le enseñaría a devolver `[REDACTED_KEY]` como dato de ejemplo. En el objetivo solo se eliminan las cadenas con forma de secreto real (claves de proveedor, bloques PEM, JWT con cabecera y carga decodificables y firma de longitud real; la clave de documentación de AWS y el JWT de ejemplo de jwt.io se consideran datos de ejemplo) y los emails de dominios no reservados (se respetan `example.com/.org/.net`, `.test`, `.invalid`, `.localhost`, `.example` y dominios obviamente falsos como `domain.com` o `test.com`). Nunca se redacta un valor solo por el nombre de su clave.
- **Qué NO es anónimo**: el fichero no contiene email, `userId` ni `generationId`, y se retiran las claves, los emails y los identificadores del repositorio y del proyecto de arriba. **No se detectan** nombres de personas, empresas o productos, teléfonos, direcciones IP ni otros datos personales escritos dentro del texto del README o de las instrucciones del usuario, ni el nombre del repositorio cuando solo se menciona en texto libre. El conjunto está **seudonimizado de forma heurística, no anonimizado de forma garantizada**: trátalo como dato personal (apartado 5). El deduplicado (hash de mensajes + objetivo, tras redactar) conserva una sola copia, la del `generationId` menor, así que no depende del orden de la base de datos.
- **Reparto train/val**: determinista por hash del `generationId` (90/10 por defecto). El mismo conjunto de datos da siempre el mismo reparto. El orden de las líneas es por hash de contenido (no agrupa los ejemplos de un autor).

### Límites de la redacción (léelos)

- Son **heurísticas**, no una garantía. No detectan nombres propios, teléfonos, direcciones IP, direcciones postales ni secretos sin forma reconocible (una clave inventada por una empresa, una contraseña en prosa). La política de privacidad pide a los usuarios no incluir datos personales de terceros ni secretos, pero no puedes confiar solo en eso.
- Antes de **subir** el dataset a ninguna máquina, pásale un detector de secretos (por ejemplo `gitleaks` o `trufflehog` sobre la carpeta; instala y **verifica** su uso actual) y revisa **una muestra pequeña** a mano, con el cuidado que merece un dato personal.
- El deduplicado es **exacto**: dos ejemplos casi idénticos pueden caer uno en train y otro en val (fuga). El efecto es optimista, no peligroso, pero hay que saberlo al interpretar la evaluación.
- Votar 👍 sin corregir convierte la **respuesta del modelo actual** en objetivo: aprende también los errores que el usuario no vio. Las correcciones (mejor señal) hoy solo pueden llegar por la API (`correctedOutput`): **la interfaz no ofrece editar el resultado**, así que espera pocas.

## 5. Seguridad de los ficheros del dataset

- Trátalos como datos personales: modo 0600 (no los cambies), carpeta gitignorada, **nunca** en un repositorio, en un bucket público ni en un chat.
- Cifra el disco donde los dejes (BitLocker, LUKS) y no los copies a servicios de sincronización personales.
- Transfiérelos a la máquina de entrenamiento por un canal cifrado (`scp`/`ssh`) y **bórralos de allí** (y destruye la instancia y su disco) al terminar. No los subas a un hub de datasets, ni siquiera privado, salvo decisión consciente.
- Conserva solo lo necesario y solo el tiempo necesario: tras entrenar, borra `train.jsonl`/`val.jsonl` locales y apunta únicamente **qué se exportó** (fecha, recuentos, hash del fichero, versión del adaptador entrenado). Ese registro no contiene contenido y permite el procedimiento del apartado 9.
- Acceso mínimo: quien exporta es quien entrena. No automatices la exportación en un cron.

## 6. Runbook: QLoRA con Unsloth en una GPU alquilada (no ejecutado)

> Todo lo siguiente es un procedimiento **sin ejecutar** en este entorno. La API de Unsloth y de TRL cambia entre versiones: **sigue sus cuadernos oficiales vigentes** y trata el código de abajo como esqueleto.

1. **Modelo base**: el que ganó en la Tarea 14 (por ejemplo `Qwen2.5-Coder-7B-Instruct`). **Comprueba la licencia** en su ficha antes de entrenar: si permite uso comercial, si permite obras derivadas y adaptadores, y si exige atribución o impone condiciones al servirlo. Las licencias varían entre tamaños de la misma familia. Guarda copia de la licencia y de la versión exacta (revisión) del modelo.
2. **Alquila una GPU por horas** en el proveedor que prefieras (consulta precios y disponibilidad vigentes; aquí no se dan). Pide Linux con driver NVIDIA reciente y Python. Según la documentación de Unsloth, ~6,5 GB de VRAM bastan para un modelo de ~7-9B en 4 bit (**verifícalo en su documentación actual**). Ese cálculo es para contextos cortos: tus ejemplos pueden llegar a varios miles de tokens de prompt más la respuesta (el servicio de inferencia usa 16 384 de contexto, `docs/ia-local.md`), así que **mide el consumo real** con tu `max_seq_length` y deja margen.
3. **Prepara el entorno** siguiendo la instalación oficial de Unsloth para esa imagen, y sube `train.jsonl` por `scp`. **No subas `val.jsonl`**: no hace falta para entrenar y mantenerlo fuera evita contaminarlo.
4. **Reserva una porción de `train.jsonl` para parar el entrenamiento** (por ejemplo el 5 % por hash): sirve para vigilar la pérdida y decidir cuándo parar. **No uses `val.jsonl` para eso** (apartado 8).
5. **Esqueleto de entrenamiento** (orientativo):
   ```python
   from unsloth import FastLanguageModel
   from trl import SFTTrainer, SFTConfig
   from datasets import load_dataset

   MAX_SEQ = 8192          # PUNTO DE PARTIDA: cubre prompt (~6000) + respuesta; ajusta a tus ejemplos y a tu VRAM
   model, tokenizer = FastLanguageModel.from_pretrained(
       model_name="Qwen/Qwen2.5-Coder-7B-Instruct",   # el ganador de la Tarea 14
       max_seq_length=MAX_SEQ,
       load_in_4bit=True,                              # QLoRA
   )
   model = FastLanguageModel.get_peft_model(
       model,
       r=16,                    # PUNTO DE PARTIDA (rango del adaptador)
       lora_alpha=16,           # PUNTO DE PARTIDA
       lora_dropout=0,
       target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
       use_gradient_checkpointing="unsloth",
       random_state=3407,
   )
   data = load_dataset("json", data_files={"train": "train.jsonl"})["train"]
   data = data.map(lambda ex: {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False)})
   # Aísla un trozo para vigilar la pérdida (NO val.jsonl):
   split = data.train_test_split(test_size=0.05, seed=3407)
   trainer = SFTTrainer(
       model=model, tokenizer=tokenizer,
       train_dataset=split["train"], eval_dataset=split["test"],
       args=SFTConfig(
           dataset_text_field="text", max_seq_length=MAX_SEQ,
           per_device_train_batch_size=2, gradient_accumulation_steps=8,   # PUNTO DE PARTIDA (lote efectivo 16)
           learning_rate=2e-4,        # PUNTO DE PARTIDA habitual en QLoRA; bájala si la pérdida oscila
           num_train_epochs=2,        # PUNTO DE PARTIDA: 1-3; mira la pérdida de la porción reservada
           warmup_steps=10, lr_scheduler_type="linear", weight_decay=0.01,
           optim="adamw_8bit", eval_strategy="steps", eval_steps=20, logging_steps=5,
           output_dir="outputs", seed=3407,
       ),
   )
   # Recomendado en Unsloth: entrenar solo sobre la respuesta del asistente (train_on_responses_only); consulta su cuaderno.
   trainer.train()
   model.save_pretrained("adapter")      # solo el adaptador LoRA
   tokenizer.save_pretrained("adapter")
   ```
   Hiperparámetros marcados como **punto de partida**: rango/alfa del adaptador, tasa de aprendizaje, épocas, lote efectivo y longitud máxima se ajustan mirando la pérdida de la porción reservada. Para parar: si esa pérdida sube mientras la de entrenamiento baja, estás sobreajustando; usa menos épocas o menos rango.
6. **Trae el adaptador** (`adapter/`, unos pocos cientos de MB como mucho) y **destruye la instancia con su disco**. Anota la revisión del modelo base, la versión de Unsloth/TRL y el hash del dataset.

## 7. Servir el adaptador

El modelo base y el adaptador deben ser **exactamente los mismos** con los que se entrenó. Si el modelo base de producción es una cuantización distinta de la del entrenamiento, mide el efecto: un adaptador entrenado sobre una base y servido sobre otra puede rendir distinto.

### Ollama (`Modelfile` con `ADAPTER`)

```
FROM qwen2.5-coder:7b-instruct
ADAPTER /ruta/al/adapter
```
```bash
docker compose -f docker-compose.prod.yml -f docker-compose.ai.yml exec -T llm ollama create mockia-spec -f /ruta/Modelfile
```
Y en el `.env`: `AI_LOCAL_MODEL=mockia-spec`. **Verifica en la documentación vigente de Ollama** que la arquitectura de tu modelo admite adaptadores en `safetensors` y que `FROM` apunta a la misma base. Si no, fusiona el adaptador con el modelo y exporta a GGUF (Unsloth ofrece guardado a GGUF; consulta su documentación) y crea el modelo con `FROM ./modelo.gguf`. Monta el directorio del adaptador en el contenedor `llm` (un volumen de solo lectura).

### vLLM (`--enable-lora`)

vLLM sirve el modelo base y el adaptador a la vez. Los argumentos van en el `command` del servicio `llm` de `docker-compose.ai.vllm.yml`, que **no** los trae: añádelos con un fichero de compose propio (ejemplo **sin probar**; `command` se sustituye entero, así que repite los argumentos del original):

```yaml
# docker-compose.lora.yml  (ejemplo; ajusta rutas y valores)
services:
  llm:
    command:
      - --model
      - ${VLLM_MODEL:-Qwen/Qwen2.5-Coder-7B-Instruct}
      - --max-model-len
      - ${VLLM_MAX_MODEL_LEN:-16384}
      - --gpu-memory-utilization
      - ${VLLM_GPU_MEMORY_UTILIZATION:-0.90}
      - --host
      - 0.0.0.0
      - --port
      - '8000'
      - --enable-lora
      - --lora-modules
      - mockia-spec=/adapters/mockia-spec
      - --max-lora-rank
      - '16'        # igual o mayor que el rango (r) del entrenamiento
    volumes:
      - ./adapters:/adapters:ro
```
Después `AI_LOCAL_MODEL=mockia-spec` (el nombre del módulo). **Comprueba los nombres de las opciones en la versión de vLLM fijada** (`VLLM_IMAGE`).

En ambos casos el modelo ajustado es una opción más del proveedor `local`: la reserva a OpenRouter, el cortacircuitos y el plazo total no cambian, y desactivarlo es volver a poner el modelo base en `AI_LOCAL_MODEL` o `AI_PROVIDERS=openrouter`.

## 8. Regla del conjunto reservado y de promoción

**Ningún dato de evaluación se usa nunca para entrenar ni para tomar decisiones de entrenamiento.**

- Conjunto de evaluación para promover = **los 36 casos de la Tarea 13** (escritos a mano, en `packages/backend/evals/cases/`, no proceden de usuarios) **+ `val.jsonl`** (la parte reservada del exportador).
- `val.jsonl` no se sube a la máquina de entrenamiento y **no se usa para parar el entrenamiento ni para elegir hiperparámetros** (para eso está la porción reservada de `train.jsonl`, apartado 6.4). Si decides con `val.jsonl`, deja de ser un conjunto de evaluación limpio.
- Antes de entrenar, comprueba que ningún ejemplo de `train.jsonl` coincide con el prompt de un caso de la Tarea 13 (los casos son sintéticos, así que no debería, pero compruébalo; elimina las coincidencias del entrenamiento).
- El `val.jsonl` cambia entre exportaciones (entran ejemplos nuevos y salen los de quien retiró el consentimiento): **compara siempre los modelos sobre el mismo fichero**, no uno antiguo contra otro nuevo, y guarda el que uses para decidir.

Cómo medir con el banco existente:

```bash
# 1. Casos de la Tarea 13 (36), modelo base y modelo ajustado, mismo hardware y mismos parámetros
AI_LOCAL_BASE_URL=http://... npm run eval -w @mockia/backend -- --provider=local --model=<base>        --no-fail
AI_LOCAL_BASE_URL=http://... npm run eval -w @mockia/backend -- --provider=local --model=mockia-spec  --no-fail --compare=<resultado-base.json>
# 2. Conjunto reservado: convertir val.jsonl en casos y repetir
npm run ai:val-to-cases -w @mockia/backend -- ./ai-datasets/val.jsonl ./ai-datasets/val-cases
npm run eval -w @mockia/backend -- --provider=local --model=<base>       --cases=./ai-datasets/val-cases --no-fail
npm run eval -w @mockia/backend -- --provider=local --model=mockia-spec --cases=./ai-datasets/val-cases --no-fail --compare=<resultado-base-val.json>
```
(`docs/ia-local.md` apartado 6 y `packages/backend/evals/README.md` detallan las variables y las columnas.)

**Se promociona solo si** el modelo ajustado, en **ambos** conjuntos: (a) **supera a la línea base** en `schemaValid` y en F1 medio, (b) **no empeora la latencia p95** respecto a la base (un adaptador añade poco, pero mídelo), y (c) cumple igualmente la regla de decisión absoluta de la Tarea 14 (`schemaValid` ≥ 95 %, F1 ≥ 0,85, p95 ≤ 60 s). La línea base es el **mismo modelo sin adaptador** en el mismo hardware y, si existe, también `evals/baseline.json` (OpenRouter; sigue pendiente de generar, ver `docs/ia-local.md`).

Con pocos casos, **diferencias de uno o dos casos son ruido**: repite cada medición varias veces (la generación es estocástica, temperatura 0,85 como en producción) y desconfía de mejoras pequeñas. Si no mejora con claridad, **no se promociona**: se mantiene el modelo base o OpenRouter.

## 9. Retirada del consentimiento después de exportar (límite honesto)

Cuando un usuario retira el consentimiento, el servidor borra sus generaciones y valoraciones **de la base de datos** al instante. Pero un dataset exportado antes **ya no contiene el email, el id de usuario ni el id de la generación** (a propósito; sí puede contener texto personal que se escribió dentro del README o de las instrucciones, apartado 4): **no puedes localizar ni borrar los ejemplos de una persona concreta dentro de un `train.jsonl` ya generado**, ni quitar su influencia de un adaptador ya entrenado. Esto no tiene arreglo técnico completo; lo que sí se puede es limitar el daño:

1. **Exporta siempre desde los datos vigentes**: el exportador vuelve a comprobar el consentimiento, así que cada exportación nueva ya excluye a quien se retiró.
2. **Reentrena periódicamente desde una exportación nueva** y retira los adaptadores antiguos, en vez de acumular entrenamientos sobre ficheros viejos. Fija un plazo (decisión tuya, por ejemplo semestral) y anótalo en tu registro de tratamientos. Desde el momento de la retirada, los datos de esa persona **no se usan en entrenamientos futuros**; es exactamente lo que dice la política de privacidad, que reconoce que un modelo ya entrenado no se puede «desentrenar».
3. **Borra los ficheros de dataset en cuanto termines de entrenar** (apartado 5). Cuanto menos tiempo existan, menos ejemplos de usuarios que se retiraron quedan fuera de tu control.
4. **No promociones ni conserves** datasets o adaptadores sin registro de procedencia (fecha de exportación, recuentos, hash).
5. Si la normativa o un asesor te exigen más (por ejemplo, demostrar que ningún dato de quien retiró está en un modelo en producción), la única vía segura es reentrenar sin esos datos y sustituir el modelo. Consúltalo con tu asesor jurídico: los textos legales de la web siguen siendo un **borrador pendiente de revisión**.

## 10. Listas de comprobación

**Antes de exportar**
- [ ] Hay una razón (la Tarea 14 falló y hay ≥ ~500 ejemplos esperables).
- [ ] La carpeta de destino está cifrada y fuera de cualquier repositorio.
- [ ] Anotas fecha y recuentos que imprime el exportador.

**Antes de subir a la GPU**
- [ ] Pasaste un detector de secretos y revisaste una muestra.
- [ ] Solo subes `train.jsonl` (no `val.jsonl`).
- [ ] Comprobaste que ningún ejemplo coincide con los casos de la Tarea 13.
- [ ] Revisaste la licencia del modelo base.

**Al terminar**
- [ ] Adaptador descargado; instancia y disco destruidos; ficheros de dataset borrados de la GPU y locales.
- [ ] Registro: dataset (fecha, recuentos, hash), base (revisión), librerías, hiperparámetros, adaptador.
- [ ] Evaluación en los dos conjuntos reservados, comparada con la base; decisión por escrito.

## 11. Límites conocidos

- Nada de esto se ha ejecutado de extremo a extremo con un modelo real: faltaban GPU, modelo y datos reales. La pieza más incierta es el rendimiento real del ajuste; solo la evaluación del apartado 8 lo dirá.
- La interfaz solo ofrece 👍/👎. No hay editor de correcciones (la API ya lo admite).
- La redacción es heurística (apartado 4). El deduplicado es exacto, no semántico.
- Sin consentimiento no se guarda ni el voto (ruling R14): la calidad del servicio solo se mide con los votos de quien aceptó.
- La política de privacidad (es/en/zh) describe este tratamiento como **borrador** para revisión de un abogado.
