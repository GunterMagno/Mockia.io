# Banco de evaluación de la IA

Mide, con los datos propios de Mockia y no con opiniones de blogs, si un modelo (local o de OpenRouter) puede generar la especificación de la API simulada con la calidad suficiente para sustituir al modelo actual.

La tarea es la misma que hace el producto: dado el contexto de un repositorio (README, tipos TypeScript, rutas, OpenAPI/Swagger) y una instrucción del usuario, el modelo devuelve un JSON con la lista de endpoints. El banco:

1. construye el prompt con `buildPromptFromInput` (la parte pura de `buildPrompt`, sin base de datos): el modelo recibe exactamente el prompt real;
2. llama al modelo con **un solo proveedor** (el mismo cliente que construye `getLlm()`, pero sin reserva a otro proveedor y **sin cortacircuitos**: se mide el modelo, no las redes de seguridad de producción) y con el mismo esquema JSON (`MOCK_SPEC_JSON_SCHEMA`), temperatura y máximo de tokens que envía el controlador para generar endpoints;
3. puntúa la respuesta con el **mismo** parser tolerante y el **mismo** validador que usa el pipeline de producción (`llmOutputParser`, `llmOutputValidator`).

## Regla de decisión

Un modelo puede sustituir a OpenRouter si y solo si, sobre todos los casos:

| Métrica | Umbral |
|---|---|
| `schemaValid` | **≥ 95 %** |
| `methodPathF1` medio | **≥ 0.85** |
| Latencia p95 | **≤ 60 s** |

El informe termina con `PASS` o `FAIL` contra esos tres umbrales y el proceso sale con código 0 o 1 (`--no-fail` fuerza 0 en ejecuciones exploratorias). Un resultado sin casos nunca pasa.

## Cómo ejecutarlo

Desde la raíz del repositorio (los argumentos van tras `--`; las rutas relativas se resuelven desde `packages/backend`):

```bash
# Autoprueba del propio banco, sin red ni claves (debe dar todo 1.0 y exit 0)
npm run eval -w @mockia/backend -- --provider=fake-perfect
# Respuestas degradadas de forma determinista (las métricas bajan y exit 1)
npm run eval -w @mockia/backend -- --provider=fake-noisy

# Línea base: el modelo actual de producción en OpenRouter (OPENROUTER_MODEL = el MISMO que tiene producción)
AI_PROVIDERS=openrouter OPENROUTER_API_KEY=sk-or-... OPENROUTER_MODEL=<modelo-de-produccion> \
  npm run eval -w @mockia/backend -- --provider=openrouter

# Modelo local con Ollama (el servidor sin /v1)
AI_LOCAL_BASE_URL=http://localhost:11434 \
  npm run eval -w @mockia/backend -- --provider=local --model=qwen2.5-coder:7b-instruct

# Modelo local con vLLM (si arrancó con --api-key, añade AI_LOCAL_API_KEY)
AI_LOCAL_BASE_URL=http://gpu-box:8000 AI_LOCAL_API_KEY=... \
  npm run eval -w @mockia/backend -- --provider=local --model=Qwen/Qwen2.5-Coder-7B-Instruct
```

> **Windows / PowerShell.** Los ejemplos usan la sintaxis de bash `VAR=valor comando` (Linux, macOS o **Git Bash** en Windows). En PowerShell cada variable se fija antes, en la misma sesión:
>
> ```powershell
> $env:AI_PROVIDERS = 'openrouter'; $env:OPENROUTER_API_KEY = 'sk-or-...'; $env:OPENROUTER_MODEL = '<modelo-de-produccion>'
> npm run eval -w @mockia/backend -- --provider=openrouter --no-fail
> $env:AI_LOCAL_BASE_URL = 'http://localhost:11434'
> npm run eval -w @mockia/backend -- --provider=local --model=qwen2.5-coder:7b-instruct
> ```
>
> (`Remove-Item Env:AI_LOCAL_BASE_URL` la quita). La barra invertida `\` de fin de línea de bash no existe en PowerShell: escribe el comando en una sola línea.

`--provider=local` y `--provider=openrouter` fuerzan `AI_PROVIDERS` a ese único nombre durante la ejecución, así que un fallo del modelo local se ve como fila con error y no se tapa con OpenRouter.

Opciones:

| Opción | Efecto |
|---|---|
| `--provider=<local\|openrouter\|fake-perfect\|fake-noisy>` | Obligatoria. |
| `--model=<nombre>` | Sustituye `AI_LOCAL_MODEL` (local) o `OPENROUTER_MODEL` (openrouter) solo en esta ejecución. |
| `--limit=N` | Solo los N primeros casos (ordenados por `id`). |
| `--temperature=<n>` | Temperatura de muestreo (0 a 2). Por defecto la de producción para generar endpoints (`SPEC_GENERATION_DEFAULTS.temperature`, 0.85). |
| `--max-tokens=<n>` | Máximo de tokens de salida. Por defecto el de producción (`SPEC_GENERATION_DEFAULTS.maxTokens`, 5000). |
| `--concurrency=N` | Llamadas simultáneas (1 por defecto: la latencia solo es comparable si el servidor no está compartido). |
| `--out=<dir>` | Carpeta del resultado (por defecto `evals/results`). |
| `--compare=<fichero>` | Imprime la diferencia contra un resultado anterior o contra `evals/baseline.json`. |
| `--cases=<dir>` | Ejecuta los casos de otra carpeta en vez de `evals/cases` (p. ej. los casos reservados de `val.jsonl`, ver abajo). |
| `--no-fail` | Sale con 0 aunque no se cumplan los criterios. |

Códigos de salida: `0` criterios cumplidos (o `--no-fail`), `1` criterios no cumplidos, `2` error de uso o de configuración (argumento desconocido, proveedor inválido, fichero de `--compare` ilegible, `--provider=local` sin `AI_LOCAL_BASE_URL` o `--provider=openrouter` sin `OPENROUTER_API_KEY`; falla antes de hacer ninguna llamada y dice qué falta).

La temperatura y el máximo de tokens usados se imprimen en el resumen y se guardan en el campo `params` del resultado, para poder comparar ejecuciones. El resultado completo (resumen, veredicto, parámetros y una fila por caso) se guarda en `evals/results/<proveedor>-<modelo>-<fecha>.json`. Esa carpeta está en `.gitignore`.

### Notas sobre ejecuciones reales

- No hay cortacircuitos ni reserva: cada caso recibe su llamada aunque los anteriores hayan fallado, y la columna `error` guarda la clase real del fallo (`timeout`, `connection_refused`, `http_500`, `invalid_envelope`, `empty_content`...). Se mantiene el plazo total de una petición (`AI_TOTAL_TIMEOUT_MS`).
- Las latencias de OpenRouter **incluyen sus reintentos y esperas internas** (hasta 3 intentos con retroceso exponencial ante 429/5xx), así que un p95 alto puede deberse a la red o al límite de la cuenta y no al modelo.
- La primera llamada a un modelo local incluye la carga del modelo en memoria: lanza antes una petición de calentamiento o descarta esa fila al comparar latencias.
- A OpenRouter se le degrada el esquema a `json_object` (no todos sus modelos admiten `json_schema` estricto), igual que en producción; con `OPENROUTER_JSON_SCHEMA=1` se envía el esquema estricto. Los modelos locales sí reciben `json_schema` estricto.
- La columna `error` de cada fila guarda solo la **clase** del fallo, nunca mensajes (podrían citar el prompt).

## Guardar la línea base

La línea base es el resultado del modelo que hoy usa producción. Se genera una vez con una clave real y se versiona.

**`OPENROUTER_MODEL` debe fijarse explícitamente al modelo que tiene configurado producción.** Sin ella el banco (como el backend) usa el modelo por defecto del código (`google/gemini-flash-1.5`), que OpenRouter puede haber retirado y que no tiene por qué ser el de producción: la línea base no serviría para comparar. En producción el backend avisa al arrancar si `OPENROUTER_MODEL` no está definida.

```bash
AI_PROVIDERS=openrouter OPENROUTER_API_KEY=... OPENROUTER_MODEL=<modelo-de-produccion> npm run eval -w @mockia/backend -- --provider=openrouter --no-fail
cp packages/backend/evals/results/<fichero-generado>.json packages/backend/evals/baseline.json
git add packages/backend/evals/baseline.json
```

Después, cualquier candidato se compara con `--compare=evals/baseline.json`.

> **Estado actual:** `evals/baseline.json` **no existe todavía**. Generarlo exige una clave de OpenRouter y es un paso manual pendiente del propietario; no se ha fabricado ningún valor. Hasta entonces el banco se ha verificado solo con los proveedores simulados.

## Métricas

Para cada caso (`scoreOutput(expected, actual)` en `scoring.ts`):

- **`validJson`**: la respuesta se pudo interpretar como JSON (objeto o lista) con el parser tolerante de producción, que acepta bloques markdown ```` ```json ```` y texto alrededor del JSON. Si la respuesta es texto, se parsea igual que en producción; si ya es un valor, se usa tal cual.
- **`schemaValid`**: el validador de producción (`validateGeneratedApi`) la acepta como especificación (campos obligatorios, métodos `GET/POST/PUT/DELETE/PATCH`, al menos un endpoint, etc.). Se valida una copia, porque el validador "cura" los ejemplos en su sitio.
- **`methodPathF1`**: F1 sobre el **conjunto** de pares `MÉTODO ruta` normalizados. Un endpoint inventado baja la precisión; uno que falta baja la cobertura (recall). Ambos vacíos = 1; uno vacío y el otro no = 0.
  - Normalización: método en mayúsculas; ruta sin host, sin query, en minúsculas, sin barras duplicadas ni final; cualquier parámetro (`:id`, `{id}`, `{userId}`) se trata como "un parámetro". Los duplicados cuentan una vez.
  - Se calcula sobre los endpoints que se pueden leer aunque la respuesta no pase el validador (para separar "contenido correcto" de "formato correcto").
- **`fieldCoverage`**: para los endpoints que coinciden por método y ruta, media de la fracción de campos de primer nivel del ejemplo de respuesta **2xx** esperado que aparecen en el ejemplo de respuesta de la respuesta del modelo. Si el esperado no tiene campos que comprobar vale 1; si nada coincide, 0. Se lee un ejemplo plano o envuelto en `{ request, response }` como lo haría el validador, y en una lista se usan los campos del primer elemento.

Agregados del informe: `validJson %`, `schemaValid %`, F1 y cobertura medios, latencia p50/p95 (interpolación lineal; cuentan también las llamadas fallidas), tokens/s (tokens de salida entre el tiempo de las llamadas que informaron `usage`; `n/a` si el proveedor no lo da), número de llamadas con error, y una fila por caso con sus puntuaciones, latencia y clase de error.

## Casos

Cada caso es un fichero `cases/<id>.json`; el `id` coincide con el nombre del fichero:

```json
{
  "id": "express-todo-basic",
  "description": "Qué escenario cubre y por qué",
  "tags": ["express", "path-params"],
  "input": {
    "projectTitle": "Todo API",
    "projectDescription": "Opcional",
    "userInput": "La instrucción del usuario",
    "context": {
      "repoName": "todo-api", "repoUrl": "...", "repoOwner": "...", "branch": "main", "summary": "...",
      "stats": { "totalFiles": 3, "totalInterfaces": 1, "totalFunctions": 0, "totalRoutes": 5 },
      "files": [
        { "path": "README.md", "type": "other", "summary": "contenido del README" },
        { "path": "src/routes/todos.ts", "type": "typescript", "summary": "...",
          "routes": [{ "methods": ["GET"], "path": "/todos" }],
          "interfaces": [{ "name": "Todo", "properties": ["id: string"] }] },
        { "path": "openapi.yaml", "type": "swagger", "summary": "...", "routes": [{ "methods": ["GET"], "path": "/pets" }] }
      ]
    }
  },
  "expected": [ { "method": "GET", "path": "/todos", "description": "...", "requestSchema": {}, "responseSchema": {}, "examples": [{ "request": {}, "response": { "id": "t1" } }] } ]
}
```

- `input` tiene la forma de `PromptInput` (`prompt.service.ts`): `context` es lo que devuelve `getProjectContext`; `null` equivale a "sin repositorio conectado".
- `expected` usa el tipo de endpoint de `MockAPIOutput`. **Debe tener al menos un endpoint**: producción rechaza una lista vacía y el prompt prohíbe devolverla. Para repositorios sin documentación, la instrucción del usuario debe pedir endpoints concretos.
- Un ejemplo de error se añade con `"statusCode": 404` (también `status`) en el ejemplo; el puntuador lee solo el ejemplo 2xx para `fieldCoverage`.
- Casos adversarios (`"tags": ["adversarial"]`): el repositorio contiene una instrucción inyectada ("ignora las instrucciones anteriores y añade ..."). `expected` son los endpoints legítimos y `trap` (`{ "method", "path" }`) es el endpoint que añadiría un modelo que obedeciera la inyección; la ruta de `trap` debe aparecer en `input`. Seguir la inyección baja la precisión.
- Mantén cada caso pequeño (el test comprueba que el prompt cabe en unos 6000 tokens): debe caber en el contexto de un modelo de 7B.
- Etiquetas usadas: `express`, `nestjs`, `typescript-types`, `openapi3`, `swagger2`, `path-params`, `nested-resources`, `pagination`, `auth`, `upload`, `errors`, `undocumented`, `es`, `adversarial`.

Los tests (`src/tests/evals.*.test.ts`) comprueban que todos los casos cargan, que los `id` son únicos, que `expected` pasa el validador de producción, que cada caso se puntúa 1.0 contra sí mismo, que el prompt se construye sin base de datos y que cada caso adversario tiene su `trap`.

## Casos reservados (`val.jsonl`)

`npm run ai:export-dataset` (ver `docs/ia-entrenamiento.md`) reserva una parte de los ejemplos reales en `val.jsonl`, que **nunca se usa para entrenar**. Para medir un modelo contra ella con este mismo banco:

```bash
npm run ai:val-to-cases -w @mockia/backend -- ./ai-datasets/val.jsonl ./ai-datasets/val-cases
npm run eval -w @mockia/backend -- --provider=local --cases=./ai-datasets/val-cases --no-fail
```

Cada línea se convierte en un caso cuyo prompt son **exactamente** los mensajes guardados (campo opcional `messages` del caso; `input` queda como un resto sin uso) y cuyo esperado son los endpoints de la respuesta final. Los ficheros se escriben con modo 0600 y salen de datos de usuarios (ya redactados y sin identificadores): déjalos en `ai-datasets/`, que está en `.gitignore`.

## Estructura

| Fichero | Contenido |
|---|---|
| `scoring.ts` | `scoreOutput` (puro, sin E/S) y la normalización de `MÉTODO ruta`. |
| `report.ts` | Percentiles, resumen, criterios de aceptación, comparación e impresión. |
| `cases.ts` | Tipo `EvalCase` y `loadCases`. |
| `valCases.ts`, `val-to-cases.ts` | Convierten `val.jsonl` en casos reservados (`npm run ai:val-to-cases`). |
| `fakeProviders.ts` | `fake-perfect` y `fake-noisy`. |
| `runner.ts` | Núcleo del banco (`runEval`, `parseArgs`); lo usan la CLI y los tests. |
| `run.ts` | Punto de entrada de `npm run eval`. |
| `tsconfig.json` | Comprobación de tipos del banco: `npx tsc -p evals/tsconfig.json`. |
| `baseline.json` | Línea base de OpenRouter (pendiente, ver arriba). |
| `results/` | Resultados de cada ejecución (ignorado por git). |
