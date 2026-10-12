# Operación automática, panel de métricas e IA propia del usuario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Cerrar los cabos sueltos de los planes anteriores; (2) automatizar calidad y operación con GitHub Actions (CI bloqueante, seguridad, vigilancia con incidencias automáticas, comprobación tras desplegar, copias de seguridad cifradas); (3) dar al titular un panel de métricas; (4) permitir que cada usuario use su propia IA (su clave de un proveedor compatible con OpenAI) en sus proyectos, con la clave cifrada y protegida.

**Architecture:** Se añade una colección de eventos mínimos de llamadas de IA (`AiCall`, sin contenido ni identidad) que alimenta el panel y las alertas. El titular se identifica por una lista de correos del entorno (`ADMIN_EMAILS`, sin rol en base de datos). La vigilancia vive en GitHub Actions y abre/cierra incidencias sola. La IA propia del usuario es un proveedor más de la cadena existente (`LlmProvider`), construido en cada petición con una credencial descifrada en memoria, con tráfico saliente por un cliente HTTP endurecido contra SSRF y sin ninguna vía de reserva hacia la IA de la plataforma.

**Tech Stack:** Node 22, Express, Mongoose, Jest, React 18/Vite, Cypress, `node:crypto` (AES-256-GCM), `node:https`/`node:dns`, GitHub Actions (`age`, `mongodb-database-tools`, `gh`). Sin dependencias npm nuevas.

**Spec:** No hay spec formal; la fuente es la petición del usuario (2026-10-12): hacer lo pendiente que se pueda, panel de métricas, calidad y operación automáticas con GitHub Actions, y IA propia del usuario muy protegida y cifrada. Contexto: `docs/superpowers/plans/2026-10-07-mejora-integral-mockia.md`, `2026-10-09-plan-starter-y-demo-publica.md`, `2026-10-07-rulings-y-pendientes.md` y los libros `.superpowers/sdd/*/progress.md` (rulings y menores diferidos).

## Qué ya existe (no se rehace)

- **Equipos y roles:** `Project.members` con `OWNER|EDITOR|VIEWER`, `authorizeRole`, `POST /projects/:id/members` (añade a un usuario YA registrado por correo; no hay invitación pendiente para correos sin cuenta: queda fuera de este plan, ver "Fuera de alcance").
- **CI:** `.github/workflows/ci.yml` ya tiene build, tipos, tests de backend con Mongo, Cypress, validación de compose y de los compose de IA. Lo que falta: lint bloqueante (hoy `continue-on-error` por deuda), escaneo de seguridad, vigilancia, post-despliegue y copias.
- **Cadena de IA:** `getLlm(env, scope)`, `LlmProvider`, `providers/openaiCompatible.ts`, cortacircuitos, hooks `onProviderCall/onProviderResult`.

## Decisiones (con razonamiento)

- **D1 — Rama por fase, apiladas sobre `atlas/mockia/demo-publica`:** `atlas/mockia/formato-y-lint` (A1) ⊂ `atlas/mockia/cabos-sueltos` (Fase 0) ⊂ `atlas/mockia/operaciones` (Fase 1 y 2) ⊂ `atlas/mockia/panel-metricas` (Fase 3) ⊂ `atlas/mockia/ia-propia-usuario` (Fase 4). El barrido de formato va primero y solo, para no mezclar un diff enorme y mecánico con cambios de comportamiento.
- **D2 — Administración por lista de correos (`ADMIN_EMAILS`), sin campo de rol en la base de datos:** un fallo de validación o una escritura en `User` nunca puede dar acceso de administrador. Exige correo VERIFICADO (si no, registrarse con el correo de otra persona daría acceso).
- **D3 — Eventos `AiCall` sin contenido ni identidad:** solo `{at, scope, plan, provider, model, outcome, tokens, latencyMs}`, TTL de 90 días. Es lo mínimo para métricas, alertas y coste; no es dato personal.
- **D4 — Coste estimado con tabla de precios del titular (`AI_PRICES_JSON`), nunca precios inventados:** sin tabla, el panel muestra tokens y deja el coste en "sin precios configurados".
- **D5 — Vigilancia sin servicios externos:** Actions programadas que abren una incidencia de GitHub (te llega por correo) y la cierran al recuperarse. Tres reintentos dentro de la misma ejecución antes de dar la alarma (evita falsos positivos por un fallo puntual).
- **D6 — Copias cifradas con `age` a una clave pública del titular:** la clave privada nunca está en GitHub; el artefacto cifrado dura 14 días y, si hay secretos S3, se sube además a un bucket. Un simulacro automático restaura una copia de prueba cada semana para demostrar que se puede recuperar.
- **D7 — IA propia v1: solo APIs compatibles con OpenAI y proveedores predefinidos** (OpenAI, OpenRouter, Groq, Mistral, Together; el titular verifica las URL antes de publicar). URL personalizada solo con `BYOK_ALLOW_CUSTOM_URLS=true` (por defecto `false`): menos superficie SSRF. Función encendida con `BYOK_ENABLED=true` y un llavero válido; por defecto apagada.
- **D8 — La credencial solo la usa su dueño:** no se comparte con editores del proyecto (nadie gasta una clave ajena). No hay respaldo a la IA de la plataforma si la clave falla (no se gasta dinero del titular sin querer), no consume la cuota mensual de IA de la plataforma y tiene su propio tope mensual (`BYOK_MAX_MONTHLY_GENERATIONS`, defecto 3000) para proteger el servidor.
- **D9 — Los datos de generaciones con IA propia nunca van al dataset de entrenamiento**, aunque el usuario haya dado consentimiento (el consentimiento es para la IA de la plataforma).
- **D10 — Cifrado:** AES-256-GCM con llavero de entorno (`BYOK_KEYS="id:base64(32 bytes),…"`, la primera es la activa), IV aleatorio por registro y AAD = `userId|credId|baseUrl` (un texto cifrado copiado a otro usuario, credencial o host no se descifra). Rotación con un script idempotente.

## Global Constraints

- Commits en español, `Agente: <modelo>` y trailer `Co-Authored-By`; no `git add -A`; no commitear el repo Atlas ni `.claude/`.
- i18n: todo texto nuevo en `en`, `es`, `zh` con paridad de claves; textos legales en las tres lenguas (borrador pendiente de abogado).
- Ninguna dependencia npm nueva. Nada de Stripe, IA ni SMTP reales en los tests: `fetch` simulado y servidores HTTP falsos; Mongo real en 27017 sin auth (BD distinta por tarea).
- Secretos solo por entorno/secretos de GitHub. Ningún secreto (clave de usuario, `OPS_TOKEN`, `BYOK_KEYS`, `ADMIN_EMAILS` completa) en logs, respuestas, errores ni artefactos.
- Compatibilidad: la suite existente (backend 73 suites / 1884 tests, Cypress 16 specs) no se debilita; se añaden tests.
- Estética morada y accesibilidad AA; 375/768/1440 px sin desbordes.
- Cada característica nueva viene APAGADA por defecto (`BYOK_ENABLED`, `OPS_TOKEN` sin definir, `ADMIN_EMAILS` vacío) y `assertProdConfig` falla al arrancar si se enciende mal.

## Review Focus

Condiciones que ninguna tarea prueba por sí sola y que más probablemente afecten a una persona real; cada línea tiene su test en la tarea indicada.

1. Un usuario adivina o reutiliza el id de la credencial de otro (o un editor de un proyecto compartido lo intenta) → 404, nunca se descifra ni se usa. Test en K3 y K4.
2. Una URL personalizada que pasa la validación y luego resuelve a una IP privada (DNS rebinding), redirige a `169.254.169.254` o usa IPs en formatos raros (decimal, octal, `::ffff:`) → bloqueada al conectar. Test en K2.
3. El proveedor del usuario devuelve un error que repite la clave o la cabecera `Authorization` → no aparece en la respuesta, los logs ni la base de datos. Test en K4 y K6.
4. Alguien con el correo de un administrador sin verificar, o un usuario normal, llama a `/api/admin/*` → 403. Test en O2.
5. Un fallo aislado de red en el monitor no abre incidencia, y cuando el servicio se recupera la incidencia se cierra sola sin duplicarse. Test en A3.

---

# Fase A — Formato y lint bloqueantes (rama `atlas/mockia/formato-y-lint`)

### Task A1: Barrido único de formato y lint, y CI que bloquea

**Files:**
- Modify: todo el código formateable (solo formato), `.github/workflows/ci.yml` (quitar `continue-on-error` de los tres pasos de lint; añadir `concurrency` con `cancel-in-progress` por rama), `package.json` (scripts `format`, `format:check`, `lint` si faltan)
- Test: el propio CI local: `npm run format:check`, `npm run lint`, suites existentes

**Interfaces:**
- Consumes: la deuda medida en el TODO(H10) del `ci.yml` (Prettier 244 ficheros; ESLint backend 1210 errores, frontend 2050).
- Produces: `npm run format:check` y `npm run lint` salen con código 0 en la raíz y por paquete.

- [ ] **Step 1:** Rama nueva desde `atlas/mockia/demo-publica`. Ejecuta `npm run format` y `npm run lint:fix` en un commit que SOLO toca formato (`style: barrido de formato y lint`); si un cambio automático altera comportamiento, deshazlo en ese fichero.
- [ ] **Step 2:** Corrige a mano los errores no autofixables restantes (≈130) en un segundo commit por paquete; si una regla genera ruido sin valor, desactívala en la configuración con un comentario que diga por qué (no con `eslint-disable` suelto por línea).
- [ ] **Step 3:** Quita `continue-on-error` de los tres pasos y añade `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
- [ ] **Step 4:** Verifica: `npm run format:check && npm run lint` (código 0), `npx tsc --noEmit -p packages/backend`, `VITE_LEGAL_ALLOW_PLACEHOLDER=1 npm run build`, suite backend completa (misma cifra de tests que antes del barrido), Cypress en dos mitades. Expected: todo verde y el número de tests idéntico.
- [ ] **Step 5: Commit** `ci: lint y formato bloquean; concurrencia por rama`.

---

# Fase 0 — Cabos sueltos (rama `atlas/mockia/cabos-sueltos`)

### Task L1: El enlace compartido de una demo no sirve para reclamarla; reclamos simultáneos respetan el límite

**Files:**
- Modify: `packages/backend/src/modules/demo/{service,claim,controller,routes}.ts`, `packages/backend/src/models/DemoMock.ts`, `packages/shared/src/` (tipo de respuesta de generate), `packages/frontend/src/services/{demoService,demoPending}.ts`, `pages/Demo/Demo.tsx`, `docs/demo.md`
- Test: `packages/backend/src/tests/demo.claim.test.ts` (ampliar), `packages/frontend/cypress/e2e/demo.cy.ts` (ampliar)

**Interfaces:**
- Produces: `POST /api/demo/generate` devuelve además `claimToken: string` (128 bits hex, solo en esa respuesta; se guarda en `DemoMock` como hash SHA-256 `claimTokenHash`, nunca en claro); `POST /api/demo/:demoId/claim` exige `{ claimToken }` en el cuerpo. El `demoId` (público, va en la URL del mock) deja de ser capacidad de reclamo.
- Consumes: M1 y M8 del ledger del plan 2 (id compartido reclamable; dos reclamos con el plan a límite−1 dejan la cuenta 1 por encima).

- [ ] **Step 1: Tests (RED)** en `demo.claim.test.ts`: (a) con `demoId` correcto y `claimToken` ausente o erróneo → 404 igual que "no existe" y el demo sigue disponible; (b) con el token correcto → crea el proyecto como hasta ahora; (c) `DemoMock` en Mongo no contiene el token en claro (`JSON.stringify(doc)` no lo incluye); (d) dos reclamos simultáneos de dos demos distintos de la misma cuenta con el plan en límite−1 → exactamente uno crea proyecto y el otro recibe 402 `PLAN_LIMIT_REACHED` y su demo sigue disponible; el recuento final de proyectos activos no supera el límite. En Cypress: el flujo "demo → registrarse → reclamar" sigue funcionando y el `claimToken` va en `sessionStorage` (nunca en la URL).
- [ ] **Step 2:** Ejecuta `cd packages/backend && MONGODB_URI="mongodb://localhost:27017/mockia-test-l1" npx jest demo.claim --forceExit --coverage=false` → FALLA (a, c, d).
- [ ] **Step 3:** Implementa: generar y hashear el token en `service.ts`; verificarlo en `claim.ts` con comparación en tiempo constante; para (d), tras crear el proyecto recuenta los activos de la cuenta y, si superan el límite, borra el proyecto recién creado, restaura el demo con su caducidad original y responde 402 (compensación; el recuento se hace dentro de la misma operación de reclamo). Actualiza `demoPending.ts` para guardar `{demoId, claimToken}` y los textos de `docs/demo.md`.
- [ ] **Step 4:** Tests de L1 verdes + suite backend completa + `demo.cy.ts`.
- [ ] **Step 5: Commit** `fix(demo): el token de reclamo se separa del id publico y los reclamos respetan el limite`.

### Task L2: Avisar de la cuota de IA agotada antes de clonar el repositorio

**Files:**
- Modify: `packages/backend/src/modules/ai/` (ruta nueva) y `modules/billing/aiQuota.ts`, `packages/frontend/src/components/projects/CreateProjectModal/CreateProjectModal.tsx`, locales `en/es/zh`
- Test: `packages/backend/src/tests/billing.aiQuota.test.ts` (ampliar), `packages/frontend/cypress/e2e/billing.cy.ts` (ampliar)

**Interfaces:**
- Produces: `GET /api/ai/quota` (autenticado) → `{ used: number, limit: number | null, resetsAt: string, available: boolean }`; solo informa, NO reserva (la reserva atómica sigue siendo la autoridad).

- [ ] **Step 1: Tests (RED)**: (a) `GET /api/ai/quota` de un Free con 5/5 → `available:false`; con 4/5 → `true`; plan sin tope → `limit:null, available:true`; la llamada no cambia el contador; (b) Cypress: con cuota agotada (interceptada) el modal de crear proyecto desde GitHub muestra el aviso de cuota con enlace a `/billing` ANTES de lanzar `POST /api/github/…` (el spy de la ruta de clonado no se invoca).
- [ ] **Step 2:** Ejecuta ambos → FALLAN.
- [ ] **Step 3:** Implementa el endpoint reutilizando el contador de `reserveAiGeneration` en modo lectura; el modal lo consulta al elegir "importar de GitHub" y, si `available` es falso, bloquea el clonado con el mensaje existente `AI_QUOTA_EXCEEDED`. Si la consulta falla, el flujo sigue como hoy (no bloquea).
- [ ] **Step 4:** Verdes + suites.
- [ ] **Step 5: Commit** `fix(ai): consultar la cuota de IA antes de clonar el repositorio`.

### Task L3: Detalles pequeños (precios duplicados, URL https del mock, mensaje de red compartida)

**Files:**
- Modify: `packages/backend/src/modules/billing/prices.ts`, `config/assertProdConfig.ts`, `packages/backend/src/modules/demo/service.ts` (baseUrl), locales `en/es/zh` (mensaje de cupo), `docs/economia-planes.md` si cita el mensaje
- Test: `packages/backend/src/tests/billing.starter.test.ts` y `demo.generate.test.ts` (ampliar), `config.assertProdConfig.test.ts`

**Interfaces:**
- Produces: dos variables `STRIPE_PRICE_*` con el mismo id → `assertProdConfig` lanza (sin eco del valor) y `prices.ts` no resuelve en silencio a Starter; `baseUrl` de la demo usa `https` cuando la petición llegó con `X-Forwarded-Proto: https` (con `trust proxy` configurado) o cuando `APP_URL` es https.

- [ ] **Step 1: Tests (RED)**: (a) producción con `STRIPE_PRICE_PRO` = `STRIPE_PRICE_STARTER_MONTHLY` → arranque falla nombrando ambas variables; (b) `generate` tras un proxy con `X-Forwarded-Proto: https` → `baseUrl` empieza por `https://`; (c) el mensaje de cupo agotado por IP en es/en/zh no dice "has usado" (texto neutro: "se alcanzó el cupo de esta red hoy").
- [ ] **Step 2:** Ejecuta → FALLAN. **Step 3:** Implementa. **Step 4:** Verdes + suite completa.
- [ ] **Step 5: Commit** `fix: precios duplicados fallan al arrancar, baseUrl https y mensaje de cupo neutro`.

### Task L4: Limpieza de la carpeta `~` suelta en la raíz del repo

**Files:**
- Delete (manual, lo ejecuta la persona): `./~` (copia de `skill-creator-plus` creada por un `git clone` con `~` sin expandir; está ignorada por `*~`; la instalación buena está en `~/.claude/skills/skill-creator-plus`)

- [ ] **Step 1:** Comprueba que `~/.claude/skills/skill-creator-plus/SKILL.md` existe y que `./~/.claude/skills/skill-creator-plus` es solo un duplicado (`diff -rq` sin diferencias relevantes).
- [ ] **Step 2:** Entrega a la persona UN comando por bloque para borrarla (no se ejecuta desde aquí: las herramientas de borrado están restringidas) y confirma con `ls -a` que `./~` ya no existe.

---

# Fase 1 — Cimientos de operación (rama `atlas/mockia/operaciones`)

### Task O1: Eventos de llamadas de IA (`AiCall`) para métricas y alertas

**Files:**
- Create: `packages/backend/src/models/AiCall.ts`, `packages/backend/src/modules/metrics/aiCalls.ts`
- Modify: `modules/ai/aiGenerationPipeline.ts` o el controlador de IA (punto único tras cada generación), `modules/demo/service.ts`
- Test: `packages/backend/src/tests/metrics.aiCalls.test.ts`

**Interfaces:**
- Produces:
  - `AiCall { at: Date (índice TTL 90 días), scope: 'users' | 'demo' | 'byok', plan: Plan | 'anonymous', provider: string, model: string, outcome: 'ok' | 'invalid' | 'truncated' | 'timeout' | 'refused' | 'error', inputTokens?: number, outputTokens?: number, latencyMs: number }` (sin `userId`, sin IP, sin contenido).
  - `recordAiCall(event: Omit<AiCallEvent, 'at'>, now?: Date): Promise<void>` — nunca lanza (error logueado con `describeError`); no bloquea la respuesta.
  - `outcomeFromProviderResult(result: ProviderOutcome | undefined, err?: unknown): AiCallOutcome` reutilizando `providerOutcomeOf`.

- [ ] **Step 1: Tests (RED)**: (a) una generación correcta de un usuario Starter crea un `AiCall` `{scope:'users', plan:'starter', outcome:'ok'}` con tokens y latencia; (b) salida truncada → `outcome:'truncated'`; timeout → `'timeout'`; (c) una generación de la demo → `{scope:'demo', plan:'anonymous'}`; (d) el documento no contiene `userId`, IP, prompt ni salida (`Object.keys` exactas); (e) si Mongo falla al guardar, la generación responde igual (no 500); (f) el índice TTL existe (`expireAfterSeconds` ≈ 90 días).
- [ ] **Step 2:** `MONGODB_URI="mongodb://localhost:27017/mockia-test-o1" npx jest metrics.aiCalls --forceExit --coverage=false` → FALLA.
- [ ] **Step 3:** Implementa modelo y `recordAiCall`; engánchalo donde hoy se liberan/consumen las cuotas (un solo punto por camino) usando los hooks `onProviderResult` para tokens y desenlace.
- [ ] **Step 4:** Verde + suite backend completa. **Step 5: Commit** `feat(metrics): eventos AiCall sin contenido ni identidad`.

### Task O2: Administración por lista de correos

**Files:**
- Create: `packages/backend/src/config/admin.ts`, `packages/backend/src/middlewares/requireAdmin.ts`, `packages/backend/src/modules/admin/routes.ts`
- Modify: `index.ts` (montar `/api/admin`), `config/assertProdConfig.ts`, ambos `.env.example`, `render.yaml`/`docker-compose.prod.yml` (reenviar `ADMIN_EMAILS` vacía)
- Test: `packages/backend/src/tests/admin.auth.test.ts`

**Interfaces:**
- Produces: `getAdminEmails(env?): ReadonlySet<string>` (minúsculas, recortadas; entradas que no son un correo válido se ignoran y `assertProdConfig` las rechaza); `requireAdmin` (tras `authenticateToken`): 403 `FORBIDDEN` si el correo del usuario no está en la lista **o no está verificado**; `GET /api/admin/me` → `{ isAdmin: boolean }` para cualquier usuario autenticado (nunca revela la lista).

- [ ] **Step 1: Tests (RED)** (Review Focus 4): (a) correo en la lista y verificado → `isAdmin:true` y acceso a una ruta de prueba protegida; (b) correo en la lista pero SIN verificar → 403; (c) usuario normal → 403; (d) sin sesión → 401; (e) la lista no distingue mayúsculas; (f) `GET /admin/me` de un no administrador responde `{isAdmin:false}` sin pista de quién lo es; (g) `assertProdConfig` rechaza una entrada que no es un correo sin eco del valor.
- [ ] **Step 2:** Ejecuta → FALLA. **Step 3:** Implementa. **Step 4:** Verde + `config.assertProdConfig`. **Step 5: Commit** `feat(admin): acceso de administrador por lista de correos verificados`.

### Task O3: Resumen operativo y versión desplegada

**Files:**
- Create: `packages/backend/src/modules/ops/{routes,summary}.ts`
- Modify: `index.ts` (`/api/ops`, y `commit` en `/api/health`), `modules/ai/providers/index.ts` (`getLlmStatus`), `config/assertProdConfig.ts`, `.env.example`, `render.yaml`, `docker-compose.prod.yml`
- Test: `packages/backend/src/tests/ops.summary.test.ts`

**Interfaces:**
- Consumes: `AiCall` (O1), `getDemoConfig`, `DemoBudget`, estado de cortacircuitos.
- Produces:
  - `GET /api/health` añade `commit: string | null` (de `RENDER_GIT_COMMIT` o `GIT_COMMIT`).
  - `getLlmStatus(): Record<string, { scope: LlmScope; provider: string; breaker: 'closed' | 'open' }>`.
  - `GET /api/ops/summary` con `Authorization: Bearer <OPS_TOKEN>` (≥ 32 caracteres, comparación en tiempo constante; **404 si `OPS_TOKEN` no está definido**; 401 si falta o es erróneo) → `{ generatedAt, db: { ok }, demo: { enabled, generationsToday, dailyLimit, usedRatio }, ai: { last60m: { calls, errors, errorRatio, byScope }, breakers }, caller: { pseudonym: string | null } }` sin ningún dato personal (`caller.pseudonym` es `pseudonymizeIp(req.ip)` o `null` si no hay `DEMO_HMAC_SECRET`; permite comprobar desde fuera si `X-Forwarded-For` es falsificable).

- [ ] **Step 1: Tests (RED)**: (a) sin `OPS_TOKEN` en el entorno → 404; con token erróneo → 401 sin pista; correcto → 200 con la forma exacta; (b) tras sembrar 10 `AiCall` (4 con `error`) en la última hora → `errorRatio` 0.4 y `calls` 10; los de hace 2 h no cuentan; (c) con la demo al 80 % del presupuesto → `usedRatio` 0.8; (d) un cortacircuitos abierto aparece como `open`; (e) la respuesta no contiene correos, ids de usuario ni IPs (`JSON.stringify` + regex); (f) `caller.pseudonym` difiere para dos `X-Forwarded-For` distintos solo cuando `trust proxy` los acepta (prueba con 0 y 2 saltos); (g) `OPS_TOKEN` < 32 caracteres hace fallar `assertProdConfig`; (h) `/health` incluye `commit`.
- [ ] **Step 2:** Ejecuta → FALLA. **Step 3:** Implementa; el endpoint va antes de los limitadores de `/api` generales pero con su propio limitador ligero (60/min por IP). **Step 4:** Verde + suite. **Step 5: Commit** `feat(ops): resumen operativo protegido por token y commit en /health`.

---

# Fase 2 — Automatización en GitHub Actions (misma rama `atlas/mockia/operaciones`)

### Task A2: Seguridad automática (dependencias, código y secretos)

**Files:**
- Create: `.github/dependabot.yml`, `.github/workflows/security.yml`, `.gitleaks.toml` (solo si hace falta una lista de permitidos documentada)
- Modify: `docs/08_despliegue.md` (sección de CI) 
- Test: `packages/backend/src/tests/ci.workflows.test.ts` (comprueba los YAML: ver abajo)

**Interfaces:**
- Produces: Dependabot semanal para `npm` (raíz y `packages/*`) y `github-actions` agrupando actualizaciones menores; workflow `security.yml` en push a `main`, PR y cron semanal con tres trabajos: CodeQL (JavaScript/TypeScript), `npm audit --omit=dev --audit-level=high` (bloquea por altas/críticas de producción), y `gitleaks` sobre el historial del PR.

- [ ] **Step 1: Tests (RED)** en `ci.workflows.test.ts` (lee los YAML del repo con el parser de la propia suite o `JSON`-izando con una expresión simple; si no hay parser YAML en el repo, comprueba con regex las claves): existen `dependabot.yml` con los ecosistemas `npm` y `github-actions`; `security.yml` define los tres trabajos; ningún workflow usa `pull_request_target`; todos los `uses:` de acciones de terceros van fijados a una versión mayor concreta (no `@main`/`@master`); los permisos de cada workflow son mínimos (`contents: read` salvo donde se justifica).
- [ ] **Step 2:** Ejecuta `npx jest ci.workflows` → FALLA. **Step 3:** Crea los ficheros. **Step 4:** Verde. **Step 5: Commit** `ci(seguridad): dependabot, CodeQL, auditoria de dependencias y escaneo de secretos`.

### Task A3: Vigilancia programada con incidencias automáticas

**Files:**
- Create: `.github/workflows/monitor.yml`, `scripts/ci/monitor.mjs`, `scripts/ci/monitor-decide.mjs`
- Test: `scripts/ci/monitor-decide.test.mjs` (`node --test`, ejecutado también desde `ci.yml`)

**Interfaces:**
- Produces: `decide(probes: Probe[], summary: OpsSummary | null): Finding[]` (función pura) con `Finding = { key: string, severity: 'incident' | 'warning', title: string, detail: string }`; claves estables: `down`, `ai-errors`, `breaker-open`, `demo-budget`. `monitor.mjs` hace 3 reintentos separados 30 s a `${BACKEND_URL}/api/health` y `${APP_URL}/`, lee `/api/ops/summary` si hay `OPS_TOKEN`, y por cada `key` abre UNA incidencia con la etiqueta `incident-auto` (o comenta en la existente) y cierra las que ya no tienen hallazgo. Workflow: cron `*/15 * * * *` + `workflow_dispatch`; secretos `BACKEND_URL`, `APP_URL`, `OPS_TOKEN` (opcional); sin secretos, termina en verde con un aviso.

- [ ] **Step 1: Tests (RED)** (Review Focus 5): (a) `/health` falla en 1 de 3 reintentos → sin hallazgos; falla en los 3 → hallazgo `down` severidad `incident`; (b) `errorRatio ≥ 0.5` con `calls ≥ 10` → `ai-errors`; con `calls < 10` → nada; (c) un cortacircuitos `open` → `breaker-open`; (d) `usedRatio ≥ 0.8` → `demo-budget` `warning`, `≥ 1` → `incident`; (e) sin resumen (sin token) solo evalúa `down`; (f) la reconciliación (`reconcile(findings, openIssues)`) devuelve `{ toOpen, toComment, toClose }` sin duplicar: dos ejecuciones seguidas con el mismo hallazgo → una sola apertura; hallazgo desaparecido → cierre; (g) el texto de la incidencia nunca incluye el token ni la URL con credenciales.
- [ ] **Step 2:** `node --test scripts/ci/` → FALLA. **Step 3:** Implementa las funciones puras y el script (usa `gh issue` desde el workflow con `GITHUB_TOKEN`, permisos `issues: write`). **Step 4:** Verde; añade el paso `node --test scripts/ci/` a un trabajo de `ci.yml`. **Step 5: Commit** `ci(operacion): vigilancia cada 15 minutos con incidencias automaticas`.

### Task A4: Comprobación automática tras desplegar

**Files:**
- Create: `.github/workflows/post-deploy.yml`, `scripts/ci/smoke.mjs`, `scripts/ci/smoke-checks.mjs`
- Test: `scripts/ci/smoke-checks.test.mjs`

**Interfaces:**
- Consumes: `/api/health` (con `commit`), `/api/demo/availability`, `/api/ops/summary` (O3).
- Produces: `checks` puras: `commitMatches(health, sha)`, `securityHeaders(headers): string[]` (faltas de `helmet`: `x-content-type-options`, `strict-transport-security` en https, `x-frame-options`/CSP), `corsClosed(headers)` (un origen ajeno NO obtiene `access-control-allow-origin` en `/api/projects`), `ipSpoofable(pseudonymA, pseudonymB): boolean` (verdadero si dos peticiones directas al backend con `X-Forwarded-For` distintos dan seudónimos distintos). Workflow: en push a `main` y `workflow_dispatch`; espera hasta 10 min a que `health.commit == github.sha` (si el servidor no expone commit, salta la espera y lo anota), ejecuta los chequeos y abre incidencia `post-deploy-auto` si fallan los críticos (`commitMatches`, `corsClosed`, cabeceras); `ipSpoofable` verdadero abre una incidencia de severidad `warning` con la guía de `docs/demo.md` (esto automatiza la comprobación manual de `TRUST_PROXY` pendiente desde el plan 2).

- [ ] **Step 1: Tests (RED)**: tabla de casos para cada `check` (cabeceras presentes/ausentes, CORS abierto/cerrado, seudónimos iguales/distintos, commit igual/distinto/ausente).
- [ ] **Step 2:** `node --test scripts/ci/smoke-checks.test.mjs` → FALLA. **Step 3:** Implementa checks y script; el workflow usa los secretos `BACKEND_URL`, `APP_URL`, `OPS_TOKEN`. **Step 4:** Verde. **Step 5: Commit** `ci(despliegue): comprobacion automatica tras desplegar, incluida la IP real tras el proxy`.

### Task A5: Copias de seguridad cifradas y simulacro de restauración

**Files:**
- Create: `.github/workflows/backup.yml`, `scripts/ci/backup.sh`, `scripts/ci/restore.sh`, `scripts/ci/backup-drill.sh`, `docs/operaciones.md`
- Modify: `.github/workflows/ci.yml` (trabajo `backup-drill` con servicio Mongo), `docs/08_despliegue.md` (enlace)
- Test: `scripts/ci/backup-drill.sh` (se ejecuta en CI y localmente con Mongo en 27017)

**Interfaces:**
- Produces: `backup.sh <uri> <recipient> <out>` → `mongodump --archive --gzip` cifrado con `age -r <recipient>`, fichero `mockia-YYYYMMDD-HHMM.archive.gz.age`, sin dejar nunca el volcado sin cifrar en disco (tubería directa) y sin imprimir la URI; `restore.sh <file.age> <identity-file> <uri>` descifra y restaura con `mongorestore --nsInclude`. Workflow `backup.yml`: cron diario 03:17 UTC; secretos `MONGODB_URI_BACKUP` (usuario de solo lectura), `BACKUP_AGE_RECIPIENT`; artefacto con retención de 14 días; si existen `BACKUP_S3_*` lo sube también a un almacenamiento compatible con S3; sin secretos termina en verde con un aviso. `docs/operaciones.md`: cómo generar la pareja de claves `age` (la privada solo en tu equipo y en un gestor de contraseñas), cómo restaurar paso a paso, qué cubre cada copia, y qué NO está cubierto (Stripe, el correo, las copias del propio Atlas).

- [ ] **Step 1: Test (RED)** `backup-drill.sh`: genera una pareja `age` temporal, siembra una BD con colecciones y documentos conocidos, ejecuta `backup.sh`, comprueba que el fichero no contiene texto en claro de un documento sembrado (`grep` falla) y que sin la clave privada no se descifra, restaura con `restore.sh` en otra BD y compara el número de documentos y un hash por colección. Expected: código 0 y "drill OK".
- [ ] **Step 2:** Ejecútalo antes de tener los scripts → FALLA. **Step 3:** Implementa los scripts (`set -euo pipefail`, sin eco de secretos, `umask 077`). **Step 4:** `bash scripts/ci/backup-drill.sh` verde; añade el trabajo a `ci.yml` y un cron semanal que lo repite. **Step 5: Commit** `ci(copias): copias cifradas con age y simulacro de restauracion`.

---

# Fase 3 — Panel de métricas (rama `atlas/mockia/panel-metricas`)

### Task P1: API de métricas del titular

**Files:**
- Create: `packages/backend/src/modules/admin/metrics.ts`, `packages/shared/src/admin.ts`
- Modify: `modules/admin/routes.ts`, `docs/` (breve en `docs/operaciones.md`)
- Test: `packages/backend/src/tests/admin.metrics.test.ts`

**Interfaces:**
- Consumes: O1 (`AiCall`), O2 (`requireAdmin`), `User`, `Project`, `Usage`, `PLAN_PRICE_USD`.
- Produces: `GET /api/admin/metrics?days=7|30|90` (por defecto 30) → `AdminMetrics`:
  ```ts
  interface AdminMetrics {
    generatedAt: string; days: number;
    users: { total: number; verified: number; byPlan: Record<Plan, number>; newPerDay: { day: string; count: number }[] };
    funnel: { registered: number; verified: number; withProject: number; withAiGeneration: number }; // cohorte registrada en la ventana
    billing: { paying: Record<PaidPlan, number>; mrrUsdEstimate: number }; // estimación desde el catálogo, NO es facturación
    ai: { perDay: { day: string; calls: number; errors: number; byScope: Record<'users'|'demo'|'byok', number> }[];
          tokens: { input: number; output: number }; errorRatio: number;
          estimatedCostUsd: number | null /* null sin AI_PRICES_JSON */ };
    demo: { generationsPerDay: { day: string; count: number }[] };
  }
  ```
  `AI_PRICES_JSON` = `{"<provider>/<model>": {"inputPerMTok": number, "outputPerMTok": number}}`; un modelo sin precio suma tokens pero no coste y se lista en `ai.unpriced: string[]`. Caché en memoria de 60 s por `days`.

- [ ] **Step 1: Tests (RED)**: con datos sembrados conocidos (usuarios en 3 días, 2 planes de pago activos, 1 `past_due`, 20 `AiCall`): (a) cifras exactas de `users`, `funnel`, `billing.paying` y `mrrUsdEstimate` (el `past_due` y los cancelados no cuentan; el anual cuenta como precio/12); (b) `ai.perDay`, `tokens`, `errorRatio`; (c) coste con `AI_PRICES_JSON` definido y `null` sin él; modelo sin precio en `unpriced`; (d) la respuesta no contiene correos, ids de usuario ni IPs; (e) `days` inválido → 400; (f) no administrador → 403 (Review Focus 4); (g) segunda llamada dentro de 60 s no repite agregaciones (espía sobre `UserModel.aggregate`).
- [ ] **Step 2:** `MONGODB_URI="mongodb://localhost:27017/mockia-test-p1" npx jest admin.metrics --forceExit --coverage=false` → FALLA. **Step 3:** Implementa con agregaciones y los índices que hagan falta (`User.createdAt`, `AiCall.at`). **Step 4:** Verde + suite. **Step 5: Commit** `feat(admin): API de metricas del titular sin datos personales`.

### Task P2: Pantalla `/admin`

**Files:**
- Create: `packages/frontend/src/pages/Admin/{Admin.tsx,Admin.module.scss}`, `packages/frontend/src/components/admin/{LineChart,StatCard}.tsx`, `packages/frontend/src/services/adminService.ts`
- Modify: `App.tsx`, `routes/paths.ts`, menú de usuario de la cabecera (enlace solo si `isAdmin`), locales `en/es/zh`
- Test: `packages/frontend/cypress/e2e/admin.cy.ts`

**Interfaces:**
- Consumes: `GET /api/admin/me` y `GET /api/admin/metrics` (P1).
- Produces: ruta `/admin` (protegida; un no administrador ve la página 404 existente), selector 7/30/90 días, tarjetas (usuarios, de pago, MRR estimado con la leyenda "estimación, consulta Stripe", llamadas de IA, tasa de error, coste estimado o "sin precios configurados"), gráficos de línea y barras en SVG propio (sin dependencias, con tabla accesible equivalente), embudo de activación, `<meta name="robots" content="noindex">`.

- [ ] **Step 1: Tests (RED)** `admin.cy.ts` (intercepta la API): (a) administrador → ve tarjetas y gráficos con los números interceptados y el selector de días reenvía `days`; (b) no administrador → página 404 y NO se pide `/admin/metrics`; (c) sin precios → texto "sin precios configurados"; (d) cada gráfico tiene `role="img"` con `aria-label` y una tabla equivalente; (e) 375 px sin desbordes; (f) es/en/zh.
- [ ] **Step 2:** `npx cypress run --browser electron --spec cypress/e2e/admin.cy.ts` → FALLA. **Step 3:** Implementa. **Step 4:** Revisión visual 375/1440 px; build y Cypress en dos mitades verdes. **Step 5: Commit** `feat(frontend): panel de metricas del titular`.

---

# Fase 4 — IA propia del usuario (rama `atlas/mockia/ia-propia-usuario`)

### Task K1: Cifrado de secretos con llavero y rotación

**Files:**
- Create: `packages/backend/src/modules/byok/crypto.ts`, `packages/backend/src/scripts/byokKeys.ts` (`byok:genkey`, `byok:rotate`)
- Modify: `config/assertProdConfig.ts`, ambos `.env.example`, `render.yaml`/`docker-compose.prod.yml` (`BYOK_ENABLED` por defecto `false`, `BYOK_KEYS` sin valor), `packages/backend/package.json` (scripts)
- Test: `packages/backend/src/tests/byok.crypto.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SealedSecret { v: 1; kid: string; iv: string; tag: string; ct: string } // base64
  type Keyring = { active: string; keys: ReadonlyMap<string, Buffer> }
  loadKeyring(env?: NodeJS.ProcessEnv): Keyring        // BYOK_KEYS="k1:<base64 de 32 bytes>,k2:..."; la primera es la activa
  seal(plain: string, aad: string, ring?: Keyring): SealedSecret
  open(sealed: SealedSecret, aad: string, ring?: Keyring): string   // lanza ByokCryptoError (mensaje fijo, sin texto en claro)
  needsRotation(sealed: SealedSecret, ring?: Keyring): boolean
  ```
  `byok:rotate -w @mockia/backend [--dry-run]` re-sella con la clave activa todas las credenciales cuyo `kid` no lo sea (idempotente; muestra solo recuentos).

- [ ] **Step 1: Tests (RED)** (a) ida y vuelta; (b) AAD distinto → `open` falla (un texto cifrado no sirve para otro usuario, credencial o host); (c) alterar `ct`, `tag` o `iv` → falla; (d) `kid` desconocido → falla; (e) rotación: sellar con `k1`, luego llavero con `k2` activa y `k1` presente → `open` funciona y `needsRotation` es verdadero; tras re-sellar es falso; (f) 10 000 sellados del mismo texto producen IV distintos; (g) los mensajes de error y `JSON.stringify(sealed)` no contienen el texto en claro; (h) `loadKeyring` rechaza claves que no son de 32 bytes, ids fuera de `[a-z0-9_-]{1,16}` y duplicados; (i) `assertProdConfig` con `BYOK_ENABLED=true` y llavero ausente o inválido falla sin eco del valor.
- [ ] **Step 2:** `MONGODB_URI="mongodb://localhost:27017/mockia-test-k1" npx jest byok.crypto --forceExit --coverage=false` → FALLA. **Step 3:** Implementa con `node:crypto` (`aes-256-gcm`, IV de 12 bytes, tag de 16). **Step 4:** Verde. **Step 5: Commit** `feat(byok): cifrado AES-256-GCM con llavero rotable y AAD`.

### Task K2: Cliente HTTP saliente endurecido contra SSRF

**Files:**
- Create: `packages/backend/src/modules/byok/safeHttp.ts`
- Modify: `packages/backend/src/modules/ai/providers/openaiCompatible.ts` (acepta un `transport` opcional; por defecto el `fetch` global, sin cambiar el comportamiento actual)
- Test: `packages/backend/src/tests/byok.safeHttp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  isForbiddenAddress(ip: string): boolean            // loopback, privadas, link-local (169.254.0.0/16 incl. metadata), CGNAT, 0.0.0.0/8, multicast, reservadas, ULA fc00::/7, fe80::/10, ::1, v4-mapeadas de todo lo anterior
  normalizeHost(raw: string): string                 // IDNA, minúsculas, sin punto final; rechaza userinfo, puertos distintos de 443, IPs literales en decimal/octal/hex
  createSafeFetch(opts?: { timeoutMs?: number; maxBytes?: number; lookup?: LookupFn }): typeof fetch
  ```
  `createSafeFetch` usa `node:https` con un `lookup` propio que resuelve y **rechaza direcciones prohibidas en el momento de conectar** (anti-DNS-rebinding), solo `https:`, verificación TLS activa, **no sigue redirecciones** (3xx → error), tope de bytes de respuesta (por defecto 1 MiB) y de tiempo (30 s).

- [ ] **Step 1: Tests (RED)** (Review Focus 2): tabla de ≥ 40 casos: `127.0.0.1`, `10.0.0.1`, `192.168.1.1`, `172.16.0.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `[::1]`, `[fd00::1]`, `[::ffff:127.0.0.1]`, `2130706433`, `0x7f000001`, `0177.0.0.1`, `localhost`, `localhost.`, `foo.localtest.me` resuelto por un `lookup` falso a `127.0.0.1`, host con `@`, puerto 8443, esquema `http:`/`file:`/`ftp:` → todos rechazados; un host público con `lookup` falso a `93.184.216.34` → permitido; DNS rebinding: un `lookup` falso que devuelve primero IP pública (en la validación) y luego `127.0.0.1` (al conectar) → rechazado; un servidor HTTPS local de prueba con certificado propio responde 302 hacia `http://169.254.169.254/` → error sin seguirla; respuesta mayor que `maxBytes` → corta con error; timeout → error; los mensajes de error no incluyen cabeceras de la petición.
- [ ] **Step 2:** Ejecuta → FALLA. **Step 3:** Implementa; en `openaiCompatible.ts` el cambio es solo inyectar el transporte y mantener los tests existentes (`ai.providers.test.ts`) intactos. **Step 4:** Verde + `ai.providers`. **Step 5: Commit** `feat(byok): cliente HTTP saliente contra SSRF (IP al conectar, sin redirecciones)`.

### Task K3: Modelo de credenciales y API de gestión

**Files:**
- Create: `packages/backend/src/models/AiCredential.ts`, `packages/backend/src/modules/byok/{routes,controller,service,validation,presets}.ts`, `packages/shared/src/byok.ts`
- Modify: `index.ts` (`/api/ai-credentials` con `authenticateToken`, `requireVerifiedEmail`, el mismo requisito de cabecera anti-CSRF que el resto), `modules/users/gdpr.ts` (exportar solo metadatos), `modules/projects/cascade.ts` o el borrado de cuenta (borrar credenciales), plantilla de correo `ai_key_added` en `services/mailer.ts` (es/en/zh), `shared` (códigos de error)
- Test: `packages/backend/src/tests/byok.credentials.test.ts`

**Interfaces:**
- Consumes: K1 (`seal/open`), K2 (`createSafeFetch`), `Notification`.
- Produces:
  - `AiCredential { userId, label (≤ 40), preset: 'openai'|'openrouter'|'groq'|'mistral'|'together'|'custom', baseUrl, model, sealed: SealedSecret, last4: string, createdAt, lastUsedAt?, lastError?: 'rejected' | 'unreachable' }`, índice único `(userId, label)`, máximo 5 por usuario.
  - `AI_PROVIDER_PRESETS: Record<Exclude<Preset,'custom'>, { label: string; baseUrl: string }>` en `@mockia/shared` (el titular verifica las URL antes de publicar; el modelo lo escribe el usuario, no hay modelos por defecto que caduquen).
  - Rutas: `GET /api/ai-credentials/config` → `{ enabled, allowCustom, presets }`; `GET /` → lista de metadatos (`id, label, preset, model, last4, createdAt, lastUsedAt, lastError`); `POST /` `{ label, preset, baseUrl?, model, apiKey }` (el `baseUrl` solo se acepta con `preset:'custom'` y `BYOK_ALLOW_CUSTOM_URLS=true`; con un preset se IGNORA cualquier `baseUrl` enviado) → 201 con metadatos, tras verificar la clave con `GET {baseUrl}/models` por `createSafeFetch` (401/403 → 400 `AI_PROVIDER_REJECTED`; otros fallos de red → se guarda con `lastError:'unreachable'`); `PATCH /:id` `{ label?, model?, apiKey? }`; `DELETE /:id` → 204. Todas con `Cache-Control: no-store`; escrituras limitadas a 20/hora por usuario; `BYOK_ENABLED=false` → 404 en todas.
  - La clave se sella con AAD `${userId}|${credId}|${baseUrl}`; **ninguna respuesta, log ni notificación contiene la clave**; crear o borrar una credencial genera una `Notification` y un correo de aviso de seguridad.

- [ ] **Step 1: Tests (RED)**: (a) crear con preset → 201, la lista devuelve `last4` y NO contiene la clave (ni en la respuesta, ni en `JSON.stringify` del documento Mongo: solo `sealed`); (b) `baseUrl` enviado con un preset se ignora (queda el del preset); `custom` sin `BYOK_ALLOW_CUSTOM_URLS` → 400; `custom` con `http://`, IP privada o puerto 8443 → 400 (reutiliza K2); (c) la clave de prueba rechazada por el proveedor (servidor falso responde 401) → 400 `AI_PROVIDER_REJECTED` y no se guarda nada; (d) **Review Focus 1**: el usuario B con el id de la credencial de A → 404 en PATCH/DELETE y no aparece en su lista; (e) sexta credencial → 409; etiqueta duplicada → 409; (f) `PATCH` con nueva `apiKey` re-sella con IV nuevo y actualiza `last4`; (g) `BYOK_ENABLED=false` → 404; sin correo verificado → 403; sin sesión → 401; (h) la exportación RGPD incluye metadatos y nunca `sealed`/clave; borrar la cuenta borra las credenciales; (i) se crea la notificación y el correo (bandeja de pruebas) y ninguno contiene la clave; (j) sexta escritura en una hora sobre el límite → 429.
- [ ] **Step 2:** `MONGODB_URI="mongodb://localhost:27017/mockia-test-k3" npx jest byok.credentials --forceExit --coverage=false` → FALLA. **Step 3:** Implementa. **Step 4:** Verde + `users.gdpr` + suite. **Step 5: Commit** `feat(byok): credenciales de IA cifradas por usuario y API de gestion`.

### Task K4: Generar con la IA del usuario

**Files:**
- Create: `packages/backend/src/modules/byok/provider.ts`
- Modify: `modules/ai/` (controlador de `generate-mock-api-spec` y `generate-and-save`, validación Joi: `credentialId?: ObjectId`), `modules/billing/aiQuota.ts` o `usage.ts` (contador mensual `byokGenerations` con reserva atómica y devolución al fallar sin respuesta), `modules/ai/generationStore.ts` (no guardar para el dataset), `modules/metrics/aiCalls.ts` (`scope:'byok'`), `modules/ai/redact.ts` (reutilizar), códigos de error en `shared`
- Test: `packages/backend/src/tests/byok.generate.test.ts`

**Interfaces:**
- Consumes: K1, K2, K3, O1.
- Produces: `createByokProvider(cred: AiCredentialDoc, apiKey: string): LlmProvider` (OpenAI-compatible con `createSafeFetch`; prueba `json_schema` y, si el proveedor rechaza `response_format` con 400, reintenta una vez con `json_object`; la salida pasa el mismo `validate` + una reparación que en la IA de la plataforma). En el controlador: con `credentialId` → carga la credencial **del usuario autenticado** (si no es suya o no existe, 404 `AI_CREDENTIAL_NOT_FOUND` sin distinguir), la abre en memoria, **no reserva cuota de la plataforma**, reserva su propio contador `BYOK_MAX_MONTHLY_GENERATIONS`, NO usa la cadena de la plataforma ni hace respaldo si falla, mapea 401/403 del proveedor a `AI_PROVIDER_REJECTED` (y marca `lastError:'rejected'`), 402/429 a mensajes propios, y registra `AiCall{scope:'byok'}` (con `provider` = preset, nunca la URL de una custom).

- [ ] **Step 1: Tests (RED)** (servidor HTTPS falso como proveedor del usuario, vía `lookup` falso a 127.0.0.1 permitido solo en tests): (a) generación correcta: usa la clave del usuario (cabecera `Authorization` recibida por el servidor falso), el contador de cuota de la plataforma NO cambia y el de BYOK sube 1; (b) **Review Focus 1**: `credentialId` de otro usuario → 404 y el servidor falso no recibe ninguna petición; (c) el proveedor responde 401 → `AI_PROVIDER_REJECTED`, `lastError:'rejected'`, y la IA de la plataforma NO se llama (espía sobre `getLlm`); (d) **Review Focus 3**: el servidor falso devuelve un error 500 cuyo cuerpo repite la clave y `Authorization: Bearer <clave>` → ni la respuesta, ni `console.*`, ni el documento de `AiCall`, ni el error guardado contienen la clave (centinela); (e) el proveedor tarda más que el plazo → 504 sin devolver nada que revele la clave; (f) tope mensual alcanzado → 429 con código propio; (g) la generación no se guarda en el almacén del dataset aunque el usuario tenga consentimiento; (h) `response_format` rechazado con 400 → un segundo intento con `json_object` y éxito; (i) `credentialId` con `BYOK_ENABLED=false` → 404; (j) un editor del proyecto con SU propia credencial genera bien y con la credencial del dueño → 404.
- [ ] **Step 2:** Ejecuta → FALLA. **Step 3:** Implementa. **Step 4:** Verde + `billing.aiQuota`, `ai.*` y suite completa. **Step 5: Commit** `feat(byok): generar con la IA propia del usuario sin cuota ni respaldo de la plataforma`.

### Task K5: Pantalla de ajustes de IA y selector al generar

**Files:**
- Create: `packages/frontend/src/pages/AiSettings/{AiSettings.tsx,AiSettings.module.scss}`, `packages/frontend/src/services/aiCredentialsService.ts`
- Modify: `App.tsx`, `routes/paths.ts` (`/settings/ai`), menú de usuario, `MockEditor.tsx` (modal de IA) y `CreateProjectModal.tsx` (selector), locales `en/es/zh`
- Test: `packages/frontend/cypress/e2e/byok.cy.ts`

**Interfaces:**
- Consumes: K3 y K4.
- Produces: página con la lista de credenciales (etiqueta, proveedor, modelo, `…last4`, estado), formulario de alta (selector de proveedor; campo de URL solo si `allowCustom`; clave en `<input type="password" autocomplete="off">`; avisos: la clave no se vuelve a mostrar, el coste lo cobra tu proveedor, tu código del proyecto se envía a tu proveedor), borrado con confirmación; en los diálogos de IA, selector "IA de Mockia (cuota)" / "Mi IA: etiqueta" cuyo estado vive solo en memoria de React (sin `localStorage`).

- [ ] **Step 1: Tests (RED)** `byok.cy.ts` (API interceptada): (a) añadir una credencial: la petición lleva la clave, la respuesta no; tras guardar, el DOM y `localStorage`/`sessionStorage`/URL no contienen la clave (barrido de texto); (b) el campo de clave se vacía tras guardar y es `type=password`; (c) con `BYOK_ENABLED` falso (config) la página dice "no disponible" y el selector no aparece; (d) elegir "Mi IA" envía `credentialId` a `generate-and-save`; (e) 401 del proveedor muestra el mensaje traducido con enlace a la configuración; (f) 375 px sin desbordes, operable con teclado; (g) es/en/zh.
- [ ] **Step 2:** `npx cypress run --browser electron --spec cypress/e2e/byok.cy.ts` → FALLA. **Step 3:** Implementa. **Step 4:** Revisión visual, build y Cypress en dos mitades. **Step 5: Commit** `feat(frontend): ajustes de IA propia y selector al generar`.

### Task K6: Textos legales, documentación y pruebas adversarias de extremo a extremo

**Files:**
- Create: `docs/ia-propia-usuario.md`, `packages/backend/src/tests/byok.abuse.test.ts`
- Modify: `packages/frontend/src/pages/Legal/legalContent/{es,en,zh}.ts` (Privacidad y Términos), `packages/frontend/cypress/e2e/legal.cy.ts`, `docs/operaciones.md`
- Test: `byok.abuse.test.ts`, `legal.cy.ts`

**Interfaces:**
- Consumes: K1-K5.
- Produces: Privacidad — qué se guarda (clave cifrada, etiqueta, últimos 4 caracteres, modelo, URL del proveedor), para qué (llamar a tu proveedor a tu petición), base legal (ejecución del servicio), que el contenido de tu proyecto que envías al generar va a TU proveedor (la relación con él es tuya y puede implicar transferencias internacionales), borrado inmediato al eliminar la credencial o la cuenta, y que esos datos no se usan para entrenar. Términos — el uso y el coste de tu proveedor son tuyos, no uses claves ajenas, puedes revocar la clave en tu proveedor en cualquier momento, y el titular puede desactivar la función. `docs/ia-propia-usuario.md` — modelo de amenazas (qué protege el cifrado y qué no: un servidor comprometido con acceso al llavero y a la base ve las claves), gestión del llavero (generar, guardar fuera del repo, rotar, qué hacer si se filtra: rotar y pedir a los usuarios que revoquen), cómo apagar la función.

- [ ] **Step 1: Tests (RED)** `byok.abuse.test.ts` (extremo a extremo con proveedor HTTPS falso): (a) volcado crudo de la base tras crear 5 credenciales: ninguna colección contiene la clave en claro (`mongoexport`-like con el driver y búsqueda de la cadena centinela, también en `notifications`, `aicalls`, `usages`); (b) barrido de logs: espía sobre `console.*` durante todo el flujo (crear, listar, generar con éxito y con error del proveedor, borrar) sin la clave; (c) ninguna respuesta HTTP de todo el flujo contiene la clave; (d) copiar el `sealed` de la credencial de A a la de B en Mongo → generar con B falla (AAD) sin llamar al proveedor; (e) `BYOK_KEYS` rotada (clave nueva activa + antigua presente): todo sigue funcionando y `byok:rotate` re-sella; (f) borrar la cuenta elimina credenciales; (g) con `BYOK_ENABLED=false` toda la superficie responde 404 y la generación con `credentialId` se rechaza; (h) rate limit de escrituras y tope mensual; (i) SSRF por la vía de la API: un `custom` apuntando a `127.0.0.1` o a un nombre que resuelve a IP privada → 400 al crear y, si se forzó en la base, 400/error al generar sin conectar.
- [ ] **Step 2:** `legal.cy.ts`: en es/en/zh Privacidad y Términos contienen la sección de IA propia con una cadena concreta por idioma y NO afirman que las claves "no se almacenan"; el test de textos de la demo sigue verde.
- [ ] **Step 3:** Ejecuta ambos → FALLAN. **Step 4:** Redacta textos y documento; arregla en producción lo que `byok.abuse` destape (con su propio test rojo→verde, anotado). **Step 5:** Suite backend completa, `tsc`, build, Cypress en dos mitades. **Step 6: Commit** `test(byok): pruebas adversarias de extremo a extremo; legal y documentacion de IA propia`.

---

## Fuera de alcance (decidido)

- **Invitaciones pendientes por correo** para quien aún no tiene cuenta (hoy el dueño o editor añade solo a usuarios registrados): depende del correo real (SMTP) y se aborda cuando exista.
- **Cosas que solo puede hacer el titular**: correo SMTP real, cuenta y Price de Stripe, `VITE_LEGAL_*`, revisión de abogado, crédito en OpenRouter y rotar la clave pegada en el chat, `npm run eval` de la demo, simulacros de Docker/GPU, secretos de GitHub (`BACKEND_URL`, `APP_URL`, `OPS_TOKEN`, `MONGODB_URI_BACKUP`, `BACKUP_AGE_RECIPIENT`, opcionales `BACKUP_S3_*`) y las variables `ADMIN_EMAILS`, `OPS_TOKEN`, `BYOK_KEYS`, `BYOK_ENABLED`.
- **Entrenar el modelo propio**: sigue pendiente de datos con consentimiento y de una GPU (ver `docs/ia-entrenamiento.md`); este plan no lo cambia.
- Proveedores no compatibles con OpenAI (API nativa de Anthropic o Google), compartir una credencial entre miembros de un proyecto y facturación por uso de IA propia.
