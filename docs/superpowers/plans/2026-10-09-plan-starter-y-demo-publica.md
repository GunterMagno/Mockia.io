# Plan Starter económico, cuota de IA por plan y demo pública sin registro — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Añadir un plan de pago barato ("Starter", 5 $/mes) que siga siendo rentable, protegiendo el coste de la IA con una cuota mensual por plan; (2) ofrecer una demo gratuita con IA real que cualquiera pueda usar sin registrarse, diseñada para que nadie pueda abusar de ella ni convertirla en un producto gratis.

**Architecture:** El catálogo de planes (`@mockia/shared`) pasa a 4 niveles (free/starter/pro/team) y gana un límite nuevo, `maxMonthlyAiGenerations`, que se aplica en el servidor antes de llamar al LLM. La demo es un subsistema aparte (`modules/demo`) con presupuesto propio, sin cuentas ni persistencia de contenido: reto de prueba de trabajo (proof-of-work) propio, cuotas por IP pseudonimizada y globales, mocks efímeros con TTL de 30 min servidos por un router distinto del de los proyectos reales, y un interruptor de apagado.

**Tech Stack:** Node 22, Express, Mongoose, Stripe (fetch), React 18/Vite, Web Workers (PoW en el navegador), Jest, Cypress. Sin dependencias de terceros nuevas para la protección anti-bots (ALTCHA/Cap/Turnstile se descartan: ver decisión D4).

**Spec:** No hay spec formal; la fuente es la petición del usuario (2026-10-09): "plan pequeño barato pero rentable que llegue a más gente" y "demo gratuita sin registro sin que se aprovechen". Contexto: plan anterior `docs/superpowers/plans/2026-10-07-mejora-integral-mockia.md` y su libro de seguimiento `.superpowers/sdd/2026-10-07-mejora-integral-mockia/progress.md`.

## Prerrequisitos (de la rama anterior)

- La pasada final de arreglos de la revisión (ledger `FINAL FIX PASS`) debe estar terminada y fusionada en la rama base: esta demo identifica a los visitantes por IP, así que **A4 (TRUST_PROXY explícito en Render y comprobación post-deploy de `req.ip`) es bloqueante**; también C2 (los parámetros de muestreo los fija el servidor) y la poda de las rutas de IA sin uso.
- Rama sugerida: `atlas/mockia/plan-starter` (Fase A) y `atlas/mockia/demo-publica` (Fase B), apiladas sobre la rama base.

## Decisiones (con razonamiento)

- **D1 — Precio del plan pequeño: 5 $/mes y 50 $/año (10 meses), sin cambiar Pro 29 $ ni Team 99 $.** Razón: los costes fijos de Stripe pesan mucho a precios bajos. Con las tarifas que citan fuentes secundarias (1,5 % + 0,25 € en tarjetas europeas y ≈3,25 % en internacionales, más el recargo de Stripe Billing ≈0,5-0,7 % y de Stripe Tax ≈0,5 %; **verifícalas en la página de precios de Stripe de tu país**) un cobro de 5 $ deja unos 4,5 $ (≈ 8-10 % de comisión total); a 9 $ la comisión baja al ≈ 6-7 %. 5 $ sigue siendo "no es una locura de dinero" y es rentable **si la IA está acotada** (D2). El precio vive en una sola constante (`PLAN_PRICE_USD.starter`) y en los Price de Stripe: cambiarlo es una línea + crear el Price nuevo. Se recomienda promocionar el plan **anual** (50 $/año): un solo cobro anual paga una sola comisión fija.
- **D2 — La IA es el único coste variable real, así que se limita por plan.** Hoy un usuario Free puede lanzar hasta 20 generaciones/minuto sin tope mensual: eso hace inviable cualquier plan barato. Se añade `maxMonthlyAiGenerations` con valores **iniciales** (ajustables tras medir el coste real por generación con el banco `evals`): Free 5, Starter 40, Pro 300, Team 1500 al mes. Starter: 15 proyectos activos y 100 000 peticiones/mes (Free 5 y 10 000; Pro 50 y 1 000 000; Team ∞ y 10 000 000). Los números salen de intuición de producto y de que el plan debe quedar entre Free y Pro; **no hay medición de coste real todavía**: la tarea A5 deja una fórmula en la documentación para que el titular fije los valores con datos.
- **D3 — La demo sólo acepta texto o plantillas, nunca una URL de GitHub.** Clonar repositorios cuesta disco/CPU/tiempo y abre superficie SSRF; para la demo basta con pegar tipos/README (≤ 6 000 caracteres) o elegir una de 3 plantillas. La importación desde GitHub sigue siendo exclusiva de cuentas registradas (es un incentivo natural para registrarse).
- **D4 — Anti-bots con prueba de trabajo propia (hashcash SHA-256), sin terceros.** Turnstile/CAPTCHA enviaría datos del visitante a un tercero (habría que declararlo en Privacidad y Cookies, justo lo que se acaba de limpiar), y ALTCHA/Cap son más dependencias para algo que son ~80 líneas. La prueba de trabajo sola **no** identifica a nadie: se combina con cuotas por IP pseudonimizada y topes globales; es una barrera de coste, no la defensa principal.
- **D5 — La IP es dato personal.** Se guarda únicamente `HMAC-SHA256(ip, secreto + fecha UTC)` (sal que rota cada día, por lo que no se puede correlacionar entre días), IPv6 agrupada por /64, con TTL de 48 h. Se declara en Privacidad.
- **D6 — Presupuesto de la demo separado del de los usuarios.** La demo no consume la cuota de IA de nadie; tiene un tope global diario (`DEMO_DAILY_GENERATIONS`, defecto 150) y un interruptor `DEMO_ENABLED`. Si se agota o se apaga, la demo muestra un mensaje amable y los usuarios registrados no se ven afectados.
- **D7 — La demo no es un producto gratis.** Límites duros: 2 generaciones por IP y día, ≤ 5 endpoints, respuestas ≤ 8 KB, 150 peticiones por mock, mock efímero (30 min), sin claves de API, sin exportación, sin visibilidad privada, sin retardos simulados > 500 ms, cabecera `X-Mockia-Demo: true` y marca visible; para conservarlo hay que registrarse (tarea B6).

## Global Constraints

- Ramas `atlas/mockia/<area>`; commits en español con `Co-Authored-By`; no commitear el repo Atlas; no `git add -A`.
- i18n: todo texto nuevo en `en`, `es`, `zh` con paridad de claves; contenido legal en las tres lenguas (borrador a revisar por un abogado).
- Compatibilidad: ningún cambio rompe la suite existente (backend ≈ 1 400 tests, Cypress ≈ 115); se añaden tests, no se quitan. Los usuarios existentes (`plan` sin `starter`) siguen funcionando.
- Un `price_id` desconocido NUNCA concede un plan de pago (regla ya existente, ahora con 6 price ids).
- Nada de Stripe real ni de IA real en los tests: `fetch` simulado y servidores HTTP falsos (los de `ai.providers.test.ts`).
- Secretos solo por entorno. `assertProdConfig` debe fallar al arrancar en producción si la demo está activada y falta `DEMO_HMAC_SECRET` (≥ 32 caracteres).
- Estética: tokens de diseño morados existentes; accesibilidad AA; 375/768/1440 px sin desbordes.
- Valores por defecto de la demo: `DEMO_ENABLED=false` (hay que activarla explícitamente), para que desplegar este código no abra nada por sorpresa.

## Review Focus

Entradas/condiciones que ninguna tarea prueba por sí sola y que más probablemente afecten a una persona real; cada línea tiene su test en la tarea indicada.

1. Un visitante legítimo tras NAT compartido (universidad, oficina) o con IPv6 que cambia de dirección dentro de su /64 → no se le bloquea por error ni puede esquivar el límite cambiando de dirección. Test en B1.
2. Ráfaga de 50 peticiones simultáneas a `/api/demo/generate` desde muchas IPs → el tope de concurrencia y el presupuesto global acotan el gasto; nadie recibe un 500. Test en B3.
3. Presupuesto diario de la demo agotado o `DEMO_ENABLED=false` → mensaje claro (503 con código `DEMO_UNAVAILABLE`), el sitio y los usuarios registrados siguen igual. Test en B3.
4. Reutilizar un reto resuelto, falsificar la firma del reto o resolverlo con dificultad menor → rechazado. Test en B1.
5. Un usuario Starter cancela o falla el pago con 15 proyectos → conserva los proyectos y no puede crear nuevos hasta bajar de 5 (comportamiento ya vigente para Pro→Free); y cambia el mes UTC → la cuota de IA se reinicia; sube de Starter a Pro a mitad de mes → el nuevo tope aplica en ≤ 30 s. Test en A2.

---

# Fase A — Plan Starter y cuota mensual de IA

### Task A1: Catálogo y facturación con el plan Starter

**Files:**
- Modify: `packages/shared/src/billing.ts`, `packages/backend/src/models/User.ts`, `packages/backend/src/modules/billing/{prices,plans,service,routes}.ts`, `packages/backend/src/modules/billing/validation` (el Joi de `/checkout`), `.env.example`, `packages/backend/.env.example`, `render.yaml`, `docker-compose.prod.yml`, `docs/pagos.md`
- Test: `packages/backend/src/tests/billing.starter.test.ts` (+ adaptar los tests de catálogo existentes sin debilitarlos)

**Interfaces:**
- Produces (shared): `Plan = 'free' | 'starter' | 'pro' | 'team'`; `PaidPlan = 'starter' | 'pro' | 'team'`; `PLANS`; `PLAN_LIMITS.starter = { maxActiveProjects: 15, maxMonthlyRequests: 100_000, maxMonthlyAiGenerations: 40 }`; `PLAN_PRICE_USD.starter = priceOf(5)` (anual 50); `PlanLimits.maxMonthlyAiGenerations: number` y `PlanLimitsDTO.maxMonthlyAiGenerations: number | null` (los cuatro planes con los valores de la decisión D2; el campo lo consume A2).
- Produces (backend): env `STRIPE_PRICE_STARTER_MONTHLY` y `STRIPE_PRICE_STARTER_YEARLY`; `planAndIntervalOfPrice(priceId)` resuelve los 6 price ids; `POST /billing/checkout {plan:'starter'|'pro'|'team', interval}`; `BillingOverview.checkoutAvailable` y `yearlyCheckoutAvailable` incluyen `starter`.

- [ ] **Step 1: Tests (RED)** en `billing.starter.test.ts`: (a) cada uno de los 6 price ids → su `{plan, interval}`; un id desconocido o vacío → ni plan de pago ni intervalo; (b) checkout con `plan:'starter'` usa el price mensual o anual correcto y devuelve 501 `BILLING_NOT_CONFIGURED` nombrando la variable si falta; (c) `effectivePlan` de un usuario `starter` activo = `starter`, `past_due` dentro de la gracia = `starter`, `canceled` = `free`; (d) `PLAN_LIMITS` es estrictamente creciente de free→starter→pro→team en proyectos, peticiones e IA; (e) `annualDiscountPercent('starter') === 17`; (f) un usuario guardado sin `starter` en el enum previo se carga y trata como free sin error.
- [ ] **Step 2:** Ejecutar `cd packages/backend && npx jest billing.starter --forceExit` → FALLA (el plan no existe).
- [ ] **Step 3:** Ampliar `billing.ts` (shared) y reconstruir `@mockia/shared`; añadir `starter` al enum de `User.plan`; actualizar `prices.ts` (dueño único de las variables de entorno), `service.ts` y la validación Joi del checkout. `ANNUAL_DISCOUNT_PERCENT` sigue calculándose desde Pro (es el mismo 17 %).
- [ ] **Step 4:** Variables nuevas en `.env.example` (ambos), `render.yaml` (`sync:false`) y `docker-compose.prod.yml` (`${VAR:-}`, vacío = no configurado). En `docs/pagos.md`: crear el producto "Starter" con 2 prices (`tax_behavior=exclusive`), las 2 variables, y una sección "Precio en euros" que explica cómo añadir `currency_options` en EUR a cada Price (para que un cliente español vea euros) y que PPP por país queda fuera de alcance (se haría con más `currency_options` manuales; no se implementa).
- [ ] **Step 5:** `npx jest --forceExit` completo → todo verde; `VITE_LEGAL_ALLOW_PLACEHOLDER=1 npm run build` verde.
- [ ] **Step 6: Commit** `feat(billing): plan Starter de 5 USD con precio mensual y anual`.

### Task A2: Cuota mensual de generaciones de IA por plan

**Files:**
- Create: `packages/backend/src/modules/billing/aiQuota.ts`
- Modify: `packages/backend/src/modules/billing/usage.ts` (contador `aiGenerations` en el documento mensual de `usages`), `packages/backend/src/routes/ai.routes.ts`, `packages/backend/src/controllers/ai.controller.ts`, `packages/backend/src/modules/billing/routes.ts` (`GET /billing/me`), `packages/shared/src/types/error.ts`, `packages/backend/src/modules/users/gdpr.ts` (exportar el contador)
- Test: `packages/backend/src/tests/billing.aiQuota.test.ts`

**Interfaces:**
- Consumes: A1 (`PLAN_LIMITS[plan].maxMonthlyAiGenerations`), `getUserPlan(userId)` (cache 30 s), el mes UTC de `usage.ts`.
- Produces:
  - `reserveAiGeneration(userId: string, now?: Date): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; used: number; limit: number; resetsAt: Date }>` — reserva atómica con un único `findOneAndUpdate` condicionado (`aiGenerations < límite`) y `$inc`; `release()` devuelve la reserva si la generación falla (error del LLM, validación, deadline, 4xx del proveedor); no se devuelve si el usuario cancela la petición después de que el modelo respondiera.
  - `ErrorCode.AI_QUOTA_EXCEEDED`; respuesta 429 con `Retry-After` hasta el inicio del mes UTC y cuerpo `{ error: { code: 'AI_QUOTA_EXCEEDED', used, limit, resetsAt } }`.
  - `BillingOverview.usage.aiGenerations: number` y `limits.maxMonthlyAiGenerations`.

- [ ] **Step 1: Tests (RED)** en `billing.aiQuota.test.ts` (Mongo real, reloj inyectable): (a) Free con 5 reservas → la 6.ª devuelve `ok:false` con `used:5, limit:5` y `resetsAt` = 1.º del mes siguiente 00:00 UTC; (b) 20 reservas simultáneas con tope 5 → exactamente 5 `ok:true` (atomicidad); (c) `release()` devuelve la reserva y permite una nueva; (d) cambio de mes UTC → contador a 0 (inyectando el reloj); (e) un usuario Starter tiene 40, uno Pro 300; (f) subir de plan a mitad de mes: tras `invalidatePlanCache(userId)` el nuevo tope aplica de inmediato y, sin invalidar, en ≤ 30 s (cache); (g) por HTTP (supertest con LLM falso): generación correcta consume 1; generación que falla (LLM 500 / JSON inválido tras reparar) NO consume; sin cuota → 429 y el LLM falso NO fue llamado; (h) un usuario `past_due` dentro de la gracia conserva el tope de su plan de pago y pasada la gracia pasa al de Free (Review Focus 5); (i) un Starter con 20 proyectos (por una bajada de plan) conserva los 20 y `POST /projects` devuelve el error de límite ya existente.
- [ ] **Step 2:** Ejecutar `npx jest billing.aiQuota --forceExit` → FALLA.
- [ ] **Step 3:** Implementar `aiQuota.ts` reutilizando el documento mensual de `usage.ts` (no crear otra colección). Aplicar en `generate-mock-api-spec` y `generate-and-save`: orden = autenticación → verificación de email → `authorizeRole` → limitador por minuto → `reserveAiGeneration` → LLM; `release()` en cualquier rama de error.
- [ ] **Step 4:** `GET /billing/me` devuelve el uso y el límite de IA; el export RGPD incluye el contador; ajustar el test de la guía de modelos de `users.gdpr.test.ts` solo si cambia la lista de colecciones.
- [ ] **Step 5:** Suite backend completa verde; `tsc` limpio.
- [ ] **Step 6: Commit** `feat(billing): cuota mensual de generaciones de IA por plan`.

### Task A3: Interfaz de planes con Starter y medidor de IA

**Files:**
- Modify: `packages/frontend/src/components/billing/PricingPlans/*`, `packages/frontend/src/pages/Billing/*`, `packages/frontend/src/pages/Landing/Index.tsx` (+ scss), `packages/frontend/src/utils/error.ts` (texto del error `AI_QUOTA_EXCEEDED`), el componente del resultado de IA / modal de crear proyecto que muestra errores de generación, locales `en/es/zh`, `packages/frontend/src/pages/Legal/legalContent/{es,en,zh}.ts` (menciones de los planes)
- Test: `packages/frontend/cypress/e2e/billing.cy.ts` (ampliar)

**Interfaces:**
- Consumes: A1/A2 (`BillingOverview` ampliado, `PLAN_PRICE_USD`, `planPriceUsd`, `annualMonthlyEquivalentUsd`, `PLAN_LIMITS`).
- Produces: componente de tarjetas con 5 opciones (Free, Starter, Pro, Team, Enterprise) y medidor "Generaciones de IA este mes: X de Y (se reinicia el …)" en Billing; cuando la API devuelve `AI_QUOTA_EXCEEDED` se muestra un aviso con enlace a /billing y la fecha de reinicio.

- [ ] **Step 1: Tests (RED)** en `billing.cy.ts`: (a) `/billing` muestra 5 tarjetas y a 375/768/1440 px sin desbordes (rejilla 1 → 2 → 3+2 columnas o 5 en línea ≥ 1440 sin cortar texto); (b) la tarjeta Starter enseña 5 $/mes y, en anual, "≈ 4,17 $/mes · facturado 50 $/año · ahorra 17 %" con los números leídos de la API compartida (no escritos a mano en el test); (c) el botón de Starter envía `plan:'starter'` e `interval` al interceptar `/billing/checkout`; (d) el medidor de IA aparece en `/billing` con datos interceptados y avisa (role=status) cerca del límite (≥ 80 %); (e) una generación que devuelve 429 `AI_QUOTA_EXCEEDED` (interceptada) enseña el aviso traducido en en/es/zh con el enlace; (f) la página legal de Términos menciona los cuatro planes por nombre en es.
- [ ] **Step 2:** Ejecutar `npx cypress run --browser electron --spec cypress/e2e/billing.cy.ts` (con los servidores de desarrollo; ver `context.md`) → FALLA.
- [ ] **Step 3:** Implementar. Reglas de copia honesta: la tarjeta Starter lista solo lo que existe (proyectos, peticiones, generaciones de IA, soporte comunitario); no inventar características. Etiqueta "Más económico" sobre Starter únicamente si es cierta por precio (lo es). Textos con paridad en/es/zh y `Intl` para moneda y fechas.
- [ ] **Step 4:** Revisión visual en el navegador a 375 y 1440 px; restaurar la ventana a escritorio.
- [ ] **Step 5:** Cypress completo en dos mitades (reiniciar el backend entre ambas) y `npm run build` verdes.
- [ ] **Step 6: Commit** `feat(frontend): plan Starter en la pagina de precios y medidor de IA`.

### Task A4: Documentar el coste real y fijar los límites con datos

**Files:**
- Create: `docs/economia-planes.md`
- Modify: `docs/pagos.md` (enlace), `packages/backend/evals/README.md` (cómo obtener tokens por generación)
- Test: `packages/backend/src/tests/docs.economics.test.ts` (comprueba que los números de la tabla del documento coinciden con `PLAN_LIMITS`/`PLAN_PRICE_USD`)

**Interfaces:**
- Produces: tabla "plan → precio → límites → margen estimado" generada a mano pero **verificada por test** contra el catálogo compartido, con la fórmula `margen = precio − comisión Stripe − (generaciones × coste por generación) − hosting prorrateado`, instrucciones para medir `coste por generación` (tokens de entrada/salida de `npm run eval` × precio por token del modelo elegido en OpenRouter, o coste de la máquina si es local) y la regla para elegir `maxMonthlyAiGenerations` de modo que el peor caso (usuario que gasta todo el cupo) siga dejando margen ≥ 0 con el plan Starter. Sin cifras de coste inventadas: las celdas de coste real quedan "pendiente de medir por el titular".

- [ ] **Step 1: Test (RED)**: parsear la tabla de `docs/economia-planes.md` y comprobar que precio mensual/anual y límites de cada plan coinciden con el catálogo; que existen las filas de los 4 planes; que ninguna celda de coste real contiene un número.
- [ ] **Step 2:** `npx jest docs.economics --forceExit` → FALLA (no existe el documento).
- [ ] **Step 3:** Escribir el documento (español) con: comisiones de Stripe como rangos con aviso "verifica en tu país", IVA (los precios son sin IVA; el cliente consumidor español paga IVA además — decisión del titular/gestoría si se anuncia con IVA incluido), ejemplo numérico del peor caso con variables simbólicas, y el procedimiento para reajustar valores (una constante + Price de Stripe).
- [ ] **Step 4:** Tests verdes; **Step 5: Commit** `docs(planes): economia de los planes y como fijar los limites con datos`.

---

# Fase B — Demo pública sin registro

### Task B1: Primitivas anti-abuso (IP pseudonimizada, reto de prueba de trabajo, presupuesto)

**Files:**
- Create: `packages/backend/src/modules/demo/{config,ipHash,pow,budget}.ts`, `packages/backend/src/models/{DemoBudget,DemoSpentChallenge}.ts`
- Modify: `packages/backend/src/config/assertProdConfig.ts`, `.env.example` (ambos)
- Test: `packages/backend/src/tests/demo.primitives.test.ts`

**Interfaces:**
- Produces:
  - `getDemoConfig(env = process.env): { enabled: boolean; dailyGenerations: number; perIpGenerationsPerDay: number; maxConcurrent: number; maxConcurrentPerIp: number; powBits: number; mockTtlMinutes: number; mockMaxRequests: number; ipMockRequestsPerDay: number; maxEndpoints: number }` con los defectos de las decisiones (`enabled=false`, 150, 2, 4, 1, 18 bits, 30, 150, 300, 5) y variables `DEMO_ENABLED`, `DEMO_DAILY_GENERATIONS`, `DEMO_PER_IP_GENERATIONS`, `DEMO_MAX_CONCURRENT`, `DEMO_POW_BITS`, `DEMO_MOCK_TTL_MINUTES`, `DEMO_HMAC_SECRET`.
  - `pseudonymizeIp(ip: string, now?: Date): string` — IPv4 completa, IPv6 truncada a /64 (se normaliza antes: `::ffff:1.2.3.4` = IPv4), `HMAC-SHA256(secret, utcDate + '|' + normalized)` en hex; cambia al cambiar el día UTC.
  - `issueChallenge(now?: Date): { challenge: string; bits: number; expiresAt: string }` — `challenge` = `base64url(payload).base64url(hmac)` con `{ id: 128-bit aleatorio, bits, exp }`; `verifyProof(challenge: string, nonce: string, now?: Date): Promise<{ ok: true } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'insufficient_work' | 'replayed' }>` — el hash es `SHA-256(challenge + ':' + nonce)` con `bits` ceros iniciales; marca el id como gastado de forma atómica (`DemoSpentChallenge` con TTL 10 min, índice único).
  - `tryConsumeDemoBudget(ipHash: string, kind: 'generation' | 'mockRequest', now?: Date): Promise<{ ok: true } | { ok: false; scope: 'ip' | 'global' }>` — `$inc` atómico condicionado sobre `DemoBudget {day, scope, key, kind, count}` con TTL 48 h; además `acquireGenerationSlot(ipHash): Promise<(() => void) | null>` para el tope de concurrencia (en memoria por proceso: documentado como tal; con varias instancias el tope efectivo es N×).

- [ ] **Step 1: Tests (RED)** `demo.primitives.test.ts`: (a) `pseudonymizeIp`: misma IP, mismo día → igual; otro día → distinto; dos direcciones IPv6 del mismo /64 → igual; `::ffff:1.2.3.4` = `1.2.3.4`; nunca contiene la IP en claro (Review Focus 1); (b) PoW: un nonce válido encontrado por fuerza bruta con `bits=8` verifica; con `bits` mayor al firmado no (cambiar `bits` rompe la firma → `bad_signature`); la firma alterada → `bad_signature`; reto vencido → `expired`; **reutilizar el mismo reto resuelto → `replayed`** y dos verificaciones simultáneas del mismo reto → exactamente una `ok` (Review Focus 4); nonce con trabajo insuficiente → `insufficient_work`; entrada basura → `malformed` sin lanzar; (c) presupuesto: 2 generaciones por IP y día y la 3.ª `scope:'ip'`; tras agotar el global `scope:'global'`; 30 llamadas simultáneas con tope 2 → exactamente 2 ok; cambio de día UTC reinicia; (d) concurrencia: con `maxConcurrentPerIp=1`, un segundo `acquireGenerationSlot` del mismo ipHash devuelve `null` hasta liberar el primero; tope global análogo; (e) `assertProdConfig`: producción con `DEMO_ENABLED=true` y `DEMO_HMAC_SECRET` ausente o < 32 caracteres → lanza sin eco del valor; con `DEMO_ENABLED=false` no exige nada.
- [ ] **Step 2:** Ejecutar `npx jest demo.primitives --forceExit` → FALLA.
- [ ] **Step 3:** Implementar los cuatro módulos. El PoW usa `crypto.createHash('sha256')` y comparación de bits iniciales sin librerías; el secreto de firma y el de la IP salen ambos de `DEMO_HMAC_SECRET` con etiquetas de dominio distintas (`'demo-pow'`, `'demo-ip'`).
- [ ] **Step 4:** Suite completa verde.
- [ ] **Step 5: Commit** `feat(demo): primitivas anti-abuso (IP pseudonimizada, prueba de trabajo, presupuesto)`.

### Task B2: Mocks efímeros de la demo y su router

**Files:**
- Create: `packages/backend/src/models/DemoMock.ts`, `packages/backend/src/modules/demo/{mockStore,mockRouter}.ts`
- Modify: `packages/backend/src/index.ts` (montar `/api/demo-mock`), `packages/backend/src/modules/billing/usage.ts` solo si hace falta aislar (la demo NO cuenta contra ningún usuario)
- Test: `packages/backend/src/tests/demo.mockRouter.test.ts`

**Interfaces:**
- Consumes: B1 (`getDemoConfig`, `tryConsumeDemoBudget`, `pseudonymizeIp`).
- Produces:
  - `DemoMock { demoId (128-bit hex, único), ipHash, endpoints: DemoEndpoint[], requestCount, createdAt, expiresAt (índice TTL) }` con `DemoEndpoint { method, path, statusCode, body (JSON), headers? }`; sin referencias a usuarios ni proyectos.
  - `createDemoMock(ipHash: string, endpoints: DemoEndpoint[], now?: Date): Promise<{ demoId: string; expiresAt: Date }>` — recorta a `maxEndpoints`, rechaza cuerpos > 8 KB y caracteres de control, fuerza `Content-Type: application/json`.
  - Router `ALL /api/demo-mock/:demoId/*`: resuelve método+ruta (reutilizando la normalización de rutas/parámetros del enrutador real si es exportable, o con una versión mínima probada), responde `statusCode` y `body`, con cabeceras `X-Mockia-Demo: true`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, CORS abierto solo para GET/POST/PUT/PATCH/DELETE/OPTIONS; `OPTIONS` no cuenta. Límites: `mockMaxRequests` por demo (429 con `Retry-After`) y `ipMockRequestsPerDay` por IP pseudonimizada; demo vencida o inexistente → 404 con el formato de error del mock real; sin retardos ni cabeceras personalizadas.

- [ ] **Step 1: Tests (RED)**: (a) un mock creado responde sus rutas con método, código y cuerpo exactos y las cabeceras de seguridad; (b) ruta/método desconocido → 404; (c) la petición 151 de un mismo demo → 429 con `Retry-After` y las rechazadas/OPTIONS no cuentan; (d) tras `expiresAt` (reloj inyectado + comprobación de que existe el índice TTL) → 404; (e) `createDemoMock` recorta a 5 endpoints, rechaza un cuerpo de 9 KB y elimina cabeceras que no estén en una lista permitida (no `Set-Cookie`, no `Location`); (f) un cuerpo con `</script><script>` o HTML se sirve como JSON con `nosniff` (no ejecutable); (g) el router NO crea ni toca documentos de `User`, `Project`, `Usage`, `AiGeneration` (contar colecciones antes y después); (h) límite por IP diario compartido entre varios demos de la misma IP (Review Focus 1).
- [ ] **Step 2:** `npx jest demo.mockRouter --forceExit` → FALLA.
- [ ] **Step 3:** Implementar. Montar el router en `index.ts` ANTES de los limitadores generales que no deban contar a la demo si procede, y asegurar que las rutas `/api/demo-mock` quedan fuera de `authenticateToken`.
- [ ] **Step 4:** Suite completa verde. **Step 5: Commit** `feat(demo): mocks efimeros con TTL y su router acotado`.

### Task B3: Endpoints de la demo (reto y generación con IA)

**Files:**
- Create: `packages/backend/src/modules/demo/{routes,controller,service,templates}.ts`
- Modify: `packages/backend/src/index.ts` (montar `/api/demo`), `packages/backend/src/config/ai.ts` (`AI_DEMO_PROVIDERS` opcional), `packages/shared/src/types/error.ts` (`DEMO_UNAVAILABLE`, `DEMO_LIMIT_REACHED`, `DEMO_CHALLENGE_INVALID`), `docs/` (se documenta en B7)
- Test: `packages/backend/src/tests/demo.generate.test.ts`

**Interfaces:**
- Consumes: B1, B2, `getLlm()` (cadena local→OpenRouter con `validate` y reparación), `buildPromptFromInput`, `MOCK_SPEC_JSON_SCHEMA`, `validateGeneratedApi`.
- Produces:
  - `GET /api/demo/status` → `{ available: boolean, remainingToday: number | null, maxEndpoints, ttlMinutes }` (no revela contadores globales: solo `available`).
  - `POST /api/demo/challenge` → `{ challenge, bits, expiresAt }` (limitado a 30/h por IP pseudonimizada).
  - `POST /api/demo/generate` body `{ challenge: string, nonce: string, source: { type: 'template', id: 'shop' | 'blog' | 'users' } | { type: 'text', text: string } }` → `201 { demoId, baseUrl, endpoints: DemoEndpoint[], expiresAt, remainingToday }`. Orden de comprobaciones: `DEMO_ENABLED` → forma de la petición (Joi: `text` ≤ 6 000 caracteres, sin claves extra; plantilla en la lista) → presupuesto por IP y global (`tryConsumeDemoBudget`) → `verifyProof` → huecos de concurrencia → LLM con `maxTokens` 1 500, temperatura fija del servidor, tope de 5 endpoints, `AI_DEMO_PROVIDERS` si existe → `createDemoMock`. Cualquier fallo después de consumir presupuesto lo devuelve (`release`) salvo que el modelo haya contestado.
  - Errores: 503 `DEMO_UNAVAILABLE` (apagada, presupuesto global agotado, concurrencia llena), 429 `DEMO_LIMIT_REACHED` (IP) con `Retry-After`, 400 `DEMO_CHALLENGE_INVALID`.
  - NINGUNA persistencia de contenido: no se escribe `AiGeneration`, `AiFeedback`, `Project`, `User`, ni se registran prompts/respuestas en logs.

- [ ] **Step 1: Tests (RED)** (supertest + LLM falso por HTTP + Mongo real): (a) feliz: reto → nonce encontrado en el test → 201 con ≤ 5 endpoints, `demoId` hex de 32 caracteres y el mock responde en `/api/demo-mock/:id/…`; (b) `DEMO_ENABLED=false` → 503 `DEMO_UNAVAILABLE` sin llamar al LLM ni consumir presupuesto (Review Focus 3); (c) presupuesto global agotado → 503 y el LLM no se llama; los endpoints de usuarios registrados (`/api/ai/generate-and-save`) siguen funcionando con su propia cuota (Review Focus 3); (d) 3.ª generación de la misma IP → 429 con `Retry-After`; cambiar de cookie/cabeceras de usuario no cambia nada; misma /64 IPv6 → mismo cupo (Review Focus 1); (e) 50 peticiones simultáneas desde 50 IPs distintas con `maxConcurrent=4` y presupuesto 10 → como máximo 4 llamadas simultáneas al LLM falso, como máximo 10 generaciones correctas, el resto 503/429 y **ninguna 500** (Review Focus 2); (f) reto reutilizado, con firma falsa, vencido o de dificultad inferior → 400 `DEMO_CHALLENGE_INVALID` sin consumir presupuesto de LLM (Review Focus 4); (g) fallo del LLM (500, JSON inválido tras la reparación, deadline) → error amable y la reserva de presupuesto se devuelve; (h) `text` > 6 000, claves extra, plantilla desconocida → 400 y presupuesto intacto; (i) una salida del modelo con 12 endpoints se recorta a 5, con cuerpos > 8 KB se rechaza; texto con inyección de prompt ("ignora lo anterior") no cambia el esquema ni crea nada fuera de `DemoMock`; (j) no aparece ningún documento nuevo en `aigenerations`, `aifeedbacks`, `projects`, `users`; ningún `console.*` contiene el texto enviado (espiando consola con un centinela).
- [ ] **Step 2:** `npx jest demo.generate --forceExit` → FALLA.
- [ ] **Step 3:** Implementar servicio y controlador (`service.ts` orquesta; `templates.ts` contiene las 3 plantillas como `PromptInput` pequeñas y estáticas); montar en `index.ts` con CORS del sitio. Para el acceso a la IP usar `req.ip` (ya depende del `trust proxy` explícito del prerrequisito).
- [ ] **Step 4:** Suite backend completa verde; `tsc` limpio.
- [ ] **Step 5: Commit** `feat(demo): generacion de mocks con IA sin registro, con presupuesto y prueba de trabajo`.

### Task B4: Página `/demo` en el frontend

**Files:**
- Create: `packages/frontend/src/pages/Demo/{Demo.tsx,Demo.module.scss}`, `packages/frontend/src/services/demoService.ts`, `packages/frontend/src/workers/powWorker.ts`
- Modify: `packages/frontend/src/App.tsx`, `routes/paths.ts` (ruta pública `/demo`), `components/ui/Header` (enlace "Probar gratis"), `pages/Landing/Index.tsx` (botón secundario "Probar sin registro" junto al principal), locales `en/es/zh`
- Test: `packages/frontend/cypress/e2e/demo.cy.ts`

**Interfaces:**
- Consumes: B3 (`/api/demo/status|challenge|generate`, `DEMO_*` códigos), `/api/demo-mock/:id/*`.
- Produces: flujo en una sola pantalla — (1) elegir plantilla (tienda/blog/usuarios) o pegar texto, contador de caracteres hasta 6 000; (2) pulsar "Generar" resuelve el reto en un Web Worker (`powWorker.ts`: recibe `{challenge, bits}`, devuelve `{nonce}`; barra de progreso indeterminada con `aria-live`, cancelable) y envía la petición; (3) resultado: lista de endpoints y un panel "Probar" que hace la llamada real a `/api/demo-mock/:id/…` y muestra estado, cabeceras clave y JSON; (4) cabecera permanente con intentos restantes de hoy y cuenta atrás de caducidad (30 min); (5) CTA "Guarda este proyecto: crea tu cuenta gratis" (enlaza a registro y, si B6 está hecho, conserva el `demoId`). Estados: demo no disponible (503) con enlace a registrarse, límite alcanzado (429) con hora aproximada de vuelta, reto inválido (reintento automático una vez), error genérico.

- [ ] **Step 1: Tests (RED)** `demo.cy.ts` (intercepta `/api/demo/*`; el servidor de pruebas arranca con `DEMO_POW_BITS` bajo si se prueba contra el backend real): (a) `/demo` accesible sin sesión y sin redirigir a login; (b) plantilla → "Generar" → aparecen endpoints y el panel "Probar" ejecuta una llamada y muestra el JSON; (c) el worker se usa (no bloquea el hilo principal: la barra sigue respondiendo) y existe botón "Cancelar" que aborta sin enviar; (d) 503 `DEMO_UNAVAILABLE` → mensaje y CTA de registro, sin errores en consola; (e) 429 → muestra cuándo vuelve; (f) texto > 6 000 caracteres bloquea el envío con mensaje accesible; (g) a 375 px sin desbordes y todo operable por teclado; (h) textos en es y zh; (i) el enlace de la cabecera y el botón de la landing llevan a `/demo`.
- [ ] **Step 2:** `npx cypress run --browser electron --spec cypress/e2e/demo.cy.ts` → FALLA.
- [ ] **Step 3:** Implementar. El worker se construye con `new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })`; SHA-256 con `crypto.subtle.digest` en el worker; el cálculo se detiene a los 60 s con mensaje. Estilo morado del resto de la app; sin dependencias nuevas.
- [ ] **Step 4:** Comprobación visual 375/1440 px; `npm run build` y Cypress completo en dos mitades verdes.
- [ ] **Step 5: Commit** `feat(frontend): pagina de demo publica con prueba de trabajo en un worker`.

### Task B5: Textos legales y operación de la demo

**Files:**
- Modify: `packages/frontend/src/pages/Legal/legalContent/{es,en,zh}.ts` (Privacidad, Términos, Cookies), `packages/frontend/cypress/e2e/legal.cy.ts`
- Create: `docs/demo.md`
- Test: `legal.cy.ts` (ampliar) y `packages/backend/src/tests/demo.docs.test.ts`

**Interfaces:**
- Produces: Privacidad — finalidad "ofrecer una demo sin registro y evitar abusos", base interés legítimo (art. 6.1.f), qué se trata (texto enviado, IP **pseudonimizada con HMAC de sal diaria**, nunca la IP en claro; contadores 48 h; el texto y los mocks se borran a los 30 min), destinatario (proveedor de IA que recibe el texto), no hay cookies ni almacenamiento nuevo, derecho de oposición. Términos — uso aceptable de la demo (sin abuso, sin automatizar, sin datos personales reales ni secretos en el texto), sin garantías, límites, que el titular puede apagarla. Cookies — la demo no usa cookies ni almacenamiento local. `docs/demo.md` — variables, cómo activarla (`DEMO_ENABLED=true` + secreto), cómo apagarla, cómo ajustar `DEMO_POW_BITS` (más bits = más coste para bots y más espera para todos; calibrar con un móvil de gama baja), qué mirar si hay abuso, fórmula de coste diario máximo = `DEMO_DAILY_GENERATIONS × coste por generación` y el aviso de que con varias instancias el tope de concurrencia es por proceso.

- [ ] **Step 1: Tests (RED)**: `legal.cy.ts` — en es/en/zh la Privacidad contiene la finalidad de la demo y la expresión que declara que la IP se guarda pseudonimizada (cadena concreta por idioma) y no contiene "dirección IP en claro" como lo que se guarda; la página de Cookies sigue sin listar cookies nuevas; `demo.docs.test.ts` — las variables `DEMO_*` citadas en `docs/demo.md` existen en `getDemoConfig`/`.env.example` y viceversa.
- [ ] **Step 2:** Ejecutarlos → FALLAN. **Step 3:** Redactar (borrador pendiente de revisión jurídica, según el convenio de las páginas legales). **Step 4:** Verde; **Step 5: Commit** `docs(legal): demo publica sin registro (privacidad, terminos, operacion)`.

### Task B6 (opcional, recomendada): Conservar la demo al registrarse

**Files:**
- Modify: `packages/backend/src/modules/demo/{routes,service}.ts`, `packages/backend/src/modules/projects/service.ts` (creación desde endpoints), `packages/frontend/src/pages/Demo/Demo.tsx`, `pages/Auth/Signup.tsx`
- Test: `packages/backend/src/tests/demo.claim.test.ts`, `packages/frontend/cypress/e2e/demo.cy.ts` (ampliar)

**Interfaces:**
- Consumes: B2/B3, el límite de proyectos activos del plan, `deleteProjectsCascade` no se toca.
- Produces: `POST /api/demo/:demoId/claim` (autenticado + email verificado, limitado) → crea un proyecto real con los endpoints del mock (respetando `maxActiveProjects` y sin consumir cuota de IA) y borra el `DemoMock`; 404 si venció, 403/409 si ya fue reclamado o la cuenta está en su límite de proyectos (mensaje con enlace a planes). El `demoId` viaja en `sessionStorage` (no en la URL) y se limpia tras reclamar o al caducar.

- [ ] **Step 1: Tests (RED)**: reclamo feliz crea 1 proyecto con los endpoints y elimina el demo; segundo reclamo → 404; usuario en su límite de proyectos → error de plan y el demo sigue disponible; no se crea nada sin email verificado; un usuario no puede reclamar el demo de otro con un id adivinado (128 bits) ni listar demos; Cypress: demo → registrarse → verificar (bandeja de pruebas) → el proyecto aparece en el panel.
- [ ] **Step 2:** FALLAN; **Step 3:** implementar; **Step 4:** suites completas verdes; **Step 5: Commit** `feat(demo): reclamar la demo como proyecto al registrarse`.

### Task B7: Revisión de abuso y cierre

**Files:**
- Create: `packages/backend/src/tests/demo.abuse.test.ts`
- Modify: `docs/demo.md` (resultado de las pruebas)

**Interfaces:**
- Consumes: B1-B6.

- [ ] **Step 1: Tests (RED→GREEN, sin tocar producción salvo hallazgos)** de escenarios adversos de extremo a extremo con LLM falso: (a) un atacante con 200 IPv6 dentro del mismo /64 → un solo cupo; (b) rotar `User-Agent`, cookies y cabeceras `X-Forwarded-For` falsas desde un cliente directo no cambia la IP efectiva (`req.ip` con `trust proxy` configurado; se prueba la configuración de test equivalente a producción); (c) 1 000 retos pedidos sin resolver no llenan la base (límite del endpoint de reto y TTL); (d) un reto resuelto en paralelo 20 veces → una sola generación; (e) cuerpo JSON de 2 MB y de 10 000 claves → rechazado por tamaño antes de procesar; (f) el coste máximo diario de LLM queda acotado por `DEMO_DAILY_GENERATIONS` (contar llamadas al LLM falso tras 500 intentos con todos los ataques anteriores); (g) la demo no permite llegar a ningún dato de usuarios ni de proyectos reales (rutas y colecciones).
- [ ] **Step 2:** Ejecutar `npx jest demo.abuse --forceExit`; todo lo que falle es un hallazgo: arreglarlo con su propio test en la tarea correspondiente.
- [ ] **Step 3:** Suites completas (backend, `tsc`, `npm run build`, Cypress en dos mitades). **Step 4:** Registrar en `docs/demo.md` qué se probó y qué NO se pudo probar aquí (IP real tras el proxy de Render, comportamiento con varias instancias, dificultad de PoW en móviles reales) como comprobaciones manuales del titular tras desplegar.
- [ ] **Step 5: Commit** `test(demo): escenarios de abuso de extremo a extremo y notas de operacion`.

---

## Orden recomendado

| Orden | Tareas | Por qué |
|-------|--------|---------|
| 1 | Prerrequisitos (fusionar la pasada final de arreglos; medir `req.ip` en Render) | La demo depende de identificar bien la IP. |
| 2 | A1 → A2 → A4 → A3 | Plan y cuota de IA primero: sin tope de IA ningún plan barato es rentable; A4 fija los números con datos. |
| 3 | B1 → B2 → B3 → B7 (parcial) | Backend de la demo con sus tests de abuso antes de exponer ninguna UI. |
| 4 | B4 → B5 | Interfaz y textos legales; activar `DEMO_ENABLED` solo tras B5. |
| 5 | B6 | Conversión a registro (opcional). |

## Lo que solo puedes hacer tú

- Crear el producto Starter con 2 prices en Stripe (`docs/pagos.md`) y, si quieres cobrar en euros, añadir `currency_options` EUR.
- Medir el coste real por generación (banco `evals` + tu proveedor o tu GPU) y ajustar `maxMonthlyAiGenerations` y `DEMO_DAILY_GENERATIONS`.
- Decidir si anunciar los precios con IVA incluido (consumidores) con tu gestoría.
- Generar `DEMO_HMAC_SECRET` (≥ 32 caracteres), activar `DEMO_ENABLED=true` y comprobar tras desplegar que la IP efectiva es distinta para dos clientes distintos; calibrar `DEMO_POW_BITS` con un móvil modesto.
- Revisión jurídica de los textos de la demo (tratamiento de la IP).

## Self-review

- **Cobertura:** plan barato y rentable → A1 (precio/límites), A2 (tope de IA, la clave de la rentabilidad), A3 (UI), A4 (economía verificable). Demo sin registro → B1-B4; "que no se aprovechen" → límites por IP pseudonimizada, presupuesto global, concurrencia, prueba de trabajo, mocks efímeros, sin persistencia, sin claves/exportación (D7), pruebas adversas en B7 y reclamar-al-registrarse como incentivo (B6). Legal/RGPD de la IP → D5, B5.
- **Tipos:** `maxMonthlyAiGenerations` (A1) lo consume A2/A3/A4; `getDemoConfig`/`pseudonymizeIp`/`verifyProof`/`tryConsumeDemoBudget`/`acquireGenerationSlot` (B1) los consumen B2/B3; `createDemoMock`/`DemoEndpoint` (B2) los consume B3/B6; códigos `DEMO_*` (B3) los consume B4.
- **Límites conocidos:** los valores de límites y precios son propuestas iniciales (no hay medición de coste); las comisiones de Stripe provienen de fuentes secundarias; la concurrencia es por proceso; una prueba de trabajo no impide a un atacante con muchas IPs reales, por eso existe el tope global diario como defensa final.
