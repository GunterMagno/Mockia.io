# Mejora integral de Mockia.io — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar Mockia.io listo para producción real: seguro (sesión y despliegue), legalmente defendible en la UE/España, cobrando con impuestos correctos, con producto útil de verdad, y con IA propia autoalojada que sustituya a OpenRouter.

**Architecture:** Se mantiene el monorepo (frontend React/Vite, backend Express/Mongoose, shared). Las mejoras se apilan en fases independientes y desplegables: (A) endurecer despliegue y sesión, (B) cumplimiento legal y RGPD, (C) cobro y fiscalidad, (D) valor de producto, (E) IA propia detrás de una interfaz de proveedor OpenAI-compatible (Ollama/vLLM en Docker), con evaluación antes de cambiar nada.

**Tech Stack:** Node 22, Express, Mongoose, Stripe (Checkout/Portal/Tax), JWT HS256, React 18, Docker Compose, Ollama o vLLM, Qwen2.5-Coder (candidato), Jest, Cypress.

**Spec:** No hay spec formal. La fuente es la petición del usuario (2026-10-07) y la auditoría del código actual (sección "Hallazgos"). Kanban: `Atlas/atlas-vault/Proyectos/Mockia.io/Kanban-Mockia.io.md`.

## Hallazgos de la auditoría (base del plan)

Verificados leyendo el código, no supuestos:

| # | Hallazgo | Dónde |
|---|----------|-------|
| H1 | Los refresh tokens no se guardan ni se revocan: un token robado vale 7 días, el logout no invalida nada, no hay rotación ni detección de reutilización. | `services/jwt.service.ts`, `modules/auth/service.ts` (`refreshTokens`) |
| H2 | Access token de 1 h (OWASP recomienda 5–15 min en apps sensibles) y token en `localStorage`/`sessionStorage` (legible por cualquier XSS). | `jwt.service.ts`, `frontend/src/services/session.ts` |
| H3 | No existe recuperar contraseña, verificación de email, ni cambio de email; la contraseña se hashea con bcrypt coste 10 en `users/service.ts`. | `modules/auth`, `modules/users` |
| H4 | `docker-compose.prod.yml` publica Mongo en `27017` con contraseña por defecto `password`, usa secretos JWT por defecto y `CORS_ORIGIN: '*'` junto a `credentials`. | `docker-compose.prod.yml` |
| H5 | La Política de Privacidad afirma "GitHub tokens are encrypted at rest" y "regular security audits", pero no hay ningún cifrado de tokens en el backend (búsqueda sin resultados). Afirmación falsa = riesgo legal. | `frontend/src/pages/Legal/Privacy.tsx` |
| H6 | Legal solo en inglés, sin Aviso Legal (LSSI-CE), sin Política de Cookies, sin identificar al responsable/CIF/domicilio, sin base jurídica ni plazos de conservación ni transferencias internacionales (OpenRouter/Stripe). | `Legal/*`, `Footer.tsx` |
| H7 | No hay exportar/borrar cuenta (derechos RGPD de acceso/supresión/portabilidad); el mensaje de la política promete que existen. | `modules/users` |
| H8 | Stripe sin cálculo de impuestos (IVA/OSS), sin recogida de NIF-IVA, sin facturas con datos fiscales. | `modules/billing/service.ts` |
| H9 | La IA depende solo de OpenRouter (`gemini-flash-1.5`), `temperature 0.7` para salida estructurada, limitador en memoria `shouldRateLimit(60)` (se pierde al reiniciar y no escala con varias instancias). | `config/ai.ts`, `services/openRouter.service.ts`, `utils/openRouterUtils.ts` |
| H10 | CI con lint/format en `continue-on-error: true` (no bloquea); hay scripts `scratch_*.ts` dentro de `src/tests`. | `.github/workflows/ci.yml`, `src/tests` |
| H11 | La landing tiene cifras y testimonio de relleno (ya anotado antes). | `pages/Landing` |

## Global Constraints

- Ramas `atlas/mockia/<area>`, una por fase; commits en español con `Co-Authored-By` del harness; no commitear el repo Atlas.
- i18n: todo texto nuevo en `en`, `es`, `zh` (claves tipadas); el texto legal puede ir en es/en primero, zh marcado como pendiente de revisión humana.
- Compatibilidad: ningún cambio rompe `npm test` (213 backend) ni `npm run test:e2e` (16 Cypress); se añaden tests, no se quitan.
- Secretos: nunca en el repo; `.env` ya está en `.gitignore`. Los valores por defecto inseguros se sustituyen por "falla al arrancar" (`assertProdConfig()`).
- Precios/planes siguen saliendo de `@mockia/shared` (`PLAN_LIMITS`, `PLAN_PRICE_USD`).
- Nada de pagos reales hasta pasar la checklist de la Fase C; probar solo con claves `sk_test_`.
- Texto legal: **redactado como borrador**; debe revisarlo un abogado o servicio especializado antes de publicar (no soy asesor legal).

## Review Focus

Entradas/condiciones que el plan no cubre con una tarea propia pero que el usuario sentirá primero; cada una ya tiene su test en la tarea indicada.

1. Dos pestañas refrescan el mismo token a la vez → no debe cerrar sesión por falsa "reutilización" (ventana de gracia de 10 s). Test en T2.
2. Usuario con suscripción activa pide borrar su cuenta → se cancela la suscripción en Stripe antes de borrar, o se rechaza con mensaje claro. Test en T6.
3. Webhook de Stripe llega antes de que exista el cliente/usuario en BD → se reintenta (500) y no se pierde. Test en T8.
4. Ollama/vLLM caído o lento (modelo frío tarda >30 s) → el backend cae al proveedor de reserva y no devuelve 500 al usuario. Test en T12.
5. El modelo local devuelve JSON inválido o con campos inventados → el validador existente lo rechaza y se reintenta una vez con el error en el prompt. Test en T13.

---

## Fase A — Seguridad de despliegue y sesión

### Task 1: Despliegue de producción seguro (H4, H10)

**Files:**
- Modify: `docker-compose.prod.yml`, `render.yaml`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/backend/src/config/assertProdConfig.ts`
- Modify: `packages/backend/src/index.ts` (llamar tras `assertJwtConfig()`)
- Delete: `packages/backend/src/tests/scratch_*.ts` (cuatro ficheros; mover útiles a `packages/backend/scratch/`)
- Test: `packages/backend/src/tests/config.assertProdConfig.test.ts`

**Interfaces:**
- Produces: `assertProdConfig(env: NodeJS.ProcessEnv = process.env): void` — lanza `Error` si `NODE_ENV==='production'` y: `CORS_ORIGIN` es `*` o vacío; `MONGODB_URI` contiene `:password@`; falta `APP_URL`; o `JWT_*` están a un valor por defecto conocido.

- [ ] **Step 1: Test** `assertProdConfig` — casos: `CORS_ORIGIN='*'` lanza; `MONGODB_URI` con `:password@` lanza; config válida no lanza; fuera de producción no lanza nunca.
- [ ] **Step 2:** Ejecutar `npm test -w packages/backend -- assertProdConfig` → FALLA (no existe).
- [ ] **Step 3:** Implementar `assertProdConfig` y llamarlo al arrancar.
- [ ] **Step 4:** `docker-compose.prod.yml`: quitar `ports: 27017` de mongo (solo red interna), eliminar todos los `:-default` de secretos y contraseña (usar `${VAR:?falta VAR}`), `CORS_ORIGIN: ${CORS_ORIGIN:?}`, añadir `healthcheck` al backend y `restart: unless-stopped` ya existente.
- [ ] **Step 5:** CI: quitar `continue-on-error: true` de ESLint/Prettier (corregir antes lo que falle con `npm run lint:fix` y `format`) y añadir job `build` (`npm run build`) y job Cypress opcional en `main`.
- [ ] **Step 6:** `npm test` y `docker compose -f docker-compose.prod.yml config` sin `.env` → debe fallar pidiendo variables; con `.env.example` rellenado → OK.
- [ ] **Step 7: Commit** `fix(deploy): produccion falla al arrancar con config insegura`.

### Task 2: Sesión con refresh tokens rotados y revocables (H1, H2)

**Files:**
- Create: `packages/backend/src/models/RefreshSession.ts`, `packages/backend/src/modules/auth/sessions.ts`
- Modify: `services/jwt.service.ts` (access 15 min, refresh con `jti`), `modules/auth/service.ts`, `modules/auth/controller.ts`, `modules/auth/routes.ts`
- Test: `packages/backend/src/tests/auth.sessions.test.ts`

**Interfaces:**
- Produces (`sessions.ts`):
  - `createSession(userId: string, meta: {ip?: string; ua?: string}): Promise<{ jti: string; familyId: string }>`
  - `rotateSession(jti: string): Promise<{ jti: string; familyId: string; userId: string }>` — marca el anterior como usado; si ya estaba usado fuera de la gracia de 10 s, revoca la familia entera y lanza `AppError 401`.
  - `revokeFamily(familyId: string)`, `revokeAllForUser(userId: string)`.
- Modelo `RefreshSession`: `{ jti, familyId, userId, usedAt?, revokedAt?, expiresAt (TTL index), ip, ua }`.
- Endpoints nuevos: `POST /auth/logout` (revoca familia), `POST /auth/logout-all`, `GET /auth/sessions`.

- [ ] **Step 1: Tests** (`auth.sessions.test.ts`): (a) refresh válido devuelve par nuevo y el anterior queda usado; (b) reutilizar el anterior tras 11 s revoca toda la familia y el token nuevo también falla; (c) reutilizar dentro de 10 s **no** revoca (pestañas concurrentes); (d) logout invalida el refresh; (e) cambiar contraseña llama `revokeAllForUser`.
- [ ] **Step 2:** Ejecutar → FALLA.
- [ ] **Step 3:** Implementar modelo + `sessions.ts`; `signRefreshToken(userId, jti)`; `loginUser` crea sesión; `refreshTokens` verifica el `jti` y rota.
- [ ] **Step 4:** Access token a `15m`; el cliente ya refresca (verificar en `frontend/src/services/api`) y debe reintentar la petición original tras el 401 una sola vez.
- [ ] **Step 5:** Pasar tests; ejecutar Cypress `auth` y `routing`.
- [ ] **Step 6: Commit** `feat(auth): refresh tokens rotados con deteccion de reutilizacion y logout real`.

### Task 3: Refresh token en cookie HttpOnly + protección CSRF (H2)

**Files:**
- Modify: `modules/auth/controller.ts`, `index.ts` (cookie-parser), `frontend/src/services/session.ts`, `frontend/src/services/authService.ts`
- Test: `packages/backend/src/tests/auth.cookie.test.ts`, `packages/frontend/cypress/e2e/auth.cy.ts`

**Interfaces:**
- Consumes: T2.
- Produces: cookie `mockia_rt` (`HttpOnly; Secure` en prod; `SameSite=Lax`; `Path=/api/auth`); `POST /auth/refresh` lee la cookie y exige cabecera `X-Requested-With: mockia` (defensa CSRF). El access token solo en memoria del cliente; "Recordarme" decide `Max-Age` de la cookie (sesión vs 7 d).

- [ ] **Step 1: Tests**: login responde `Set-Cookie` con `HttpOnly`; refresh sin la cabecera `X-Requested-With` devuelve 403; el cuerpo de login ya no incluye `refreshToken`.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3:** Frontend: guardar el access token solo en memoria (módulo `session.ts`), al cargar la app llamar a `/auth/refresh` para recuperar sesión; migrar y borrar los tokens antiguos de `localStorage`/`sessionStorage`.
- [ ] **Step 4:** Actualizar Cypress (los comandos `cy.login` dejan de sembrar `localStorage`) y correr los 16 specs.
- [ ] **Step 5: Commit** `feat(auth): refresh token en cookie HttpOnly y access token solo en memoria`.

### Task 4: Recuperar contraseña, verificación de email y endurecer registro (H3)

**Files:**
- Create: `packages/backend/src/services/mailer.ts`, `modules/auth/passwordReset.ts`, `models/AuthToken.ts`, `frontend/src/pages/Auth/ForgotPassword.tsx`, `ResetPassword.tsx`, `VerifyEmail.tsx`
- Modify: `models/User.ts` (`emailVerifiedAt?: Date`), `modules/auth/routes.ts`, `modules/auth/validation.ts`, locales en/es/zh
- Test: `packages/backend/src/tests/auth.passwordReset.test.ts`, `packages/frontend/cypress/e2e/passwordReset.cy.ts`

**Interfaces:**
- Produces: `sendMail(to: string, template: 'verify' | 'reset', data: Record<string,string>): Promise<void>` (SMTP vía `nodemailer`, en test un transport en memoria); `createAuthToken(userId, purpose: 'verify'|'reset', ttlMin: number): Promise<string>` guarda solo el **hash SHA-256**; `consumeAuthToken(raw: string, purpose): Promise<string /*userId*/>` de un solo uso.
- Endpoints: `POST /auth/forgot` (siempre 202, no revela si el email existe), `POST /auth/reset`, `POST /auth/verify`.
- Reglas: contraseña mínimo 10 caracteres; coste bcrypt a 12 y re-hash transparente en el login si el coste guardado es menor; reset revoca todas las sesiones (T2); acciones de pago/IA exigen email verificado.

- [ ] **Step 1: Tests**: `forgot` con email inexistente devuelve 202 y no envía correo; token caducado (>30 min) falla; token usado dos veces falla; tras `reset` el refresh antiguo falla; login con hash de coste 10 lo re-hashea a 12.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3:** Frontend: las tres páginas + enlace "¿Olvidaste tu contraseña?" en el login, estilo del modal renovado.
- [ ] **Step 4:** Proveedor SMTP: documentar en `.env.example` (`SMTP_URL`, `MAIL_FROM`); recomendar Resend o Brevo (plan gratuito) y SPF/DKIM del dominio.
- [ ] **Step 5: Commit** `feat(auth): recuperar contraseña y verificacion de email`.

---

## Fase B — Cumplimiento legal y RGPD

> Este bloque es ingeniería para soportar el cumplimiento; los textos finales requieren revisión jurídica. Marco aplicable: RGPD, LOPDGDD (Ley Orgánica 3/2018), LSSI-CE (Ley 34/2002) y guía de cookies de la AEPD (fuentes en el informe).

### Task 5: Corregir y completar los documentos legales (H5, H6)

**Files:**
- Create: `frontend/src/pages/Legal/LegalNotice.tsx` (Aviso Legal LSSI), `Cookies.tsx`, `legalContent/{es,en}.ts`
- Modify: `Privacy.tsx`, `Terms.tsx`, `Footer.tsx`, `routes/paths.ts`, `App.tsx`, locales
- Test: `packages/frontend/cypress/e2e/legal.cy.ts`

**Interfaces:**
- Produces: `LEGAL_ENTITY` en `@mockia/shared` (`{ name, nif, address, email, registry? }`) leído por todas las páginas y por Stripe; vacío = el build de producción falla (`assertProdConfig` web: `VITE_LEGAL_ENTITY_*`).

- [ ] **Step 1: Test** `legal.cy.ts`: existen `/legal`, `/privacy`, `/terms`, `/cookies`; el footer enlaza a los cuatro; en `es` el texto está en español (sin el aviso "solo inglés"); ninguna página contiene la cadena `encrypted at rest`.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3:** Privacidad (Art. 13 RGPD) con: responsable (nombre, NIF, domicilio, email), finalidades y base jurídica (contrato / interés legítimo / consentimiento), encargados (Stripe, proveedor de email, hosting, proveedor de IA), transferencias internacionales y garantías, plazos de conservación, derechos y cómo ejercerlos, derecho a reclamar ante la AEPD, y si hay decisiones automatizadas.
- [ ] **Step 4:** **Eliminar o hacer verdaderas** las afirmaciones de H5: o se implementa cifrado de tokens GitHub (ver T6 paso 5) o se borra la frase. Hasta entonces, borrarla.
- [ ] **Step 5:** Términos: precio y renovación, desistimiento (el contenido digital con ejecución inmediata exige consentimiento expreso del consumidor para perder el derecho de desistimiento de 14 días — casilla en Checkout), cancelación, límites de uso aceptable de la API mock, propiedad del contenido generado, limitación de responsabilidad, ley aplicable.
- [ ] **Step 6: Commit** `docs(legal): aviso legal, cookies y privacidad conforme a RGPD/LSSI (borrador)`.

### Task 6: Derechos RGPD: exportar y borrar cuenta; consentimiento de cookies (H7)

**Files:**
- Create: `modules/users/gdpr.ts`, `frontend/src/components/ui/CookieBanner/CookieBanner.tsx`, `frontend/src/pages/Settings/AccountData.tsx`
- Modify: `modules/users/routes.ts`, `models/Project.ts` (índice por `ownerId` si falta), `scheduler/projectCleanup.ts`
- Test: `packages/backend/src/tests/users.gdpr.test.ts`, `cypress/e2e/cookies.cy.ts`

**Interfaces:**
- Produces: `exportUserData(userId: string): Promise<Record<string, unknown>>` (usuario sin hash, proyectos, endpoints, notificaciones, uso); `deleteUserAccount(userId: string): Promise<void>` en este orden: si hay suscripción activa → `cancelSubscription` en Stripe, borrar proyectos/endpoints/notificaciones/uso/sesiones, anonimizar o conservar facturas (obligación fiscal), borrar usuario. Endpoints `GET /users/me/export`, `DELETE /users/me` (pide contraseña).
- Banner: solo cookies/almacenamiento técnico hoy ⇒ banner informativo; si se añade analítica, consentimiento previo con opciones "Aceptar/Rechazar" de igual peso (criterio AEPD).

- [ ] **Step 1: Tests**: la exportación no contiene `passwordHash`; borrar con suscripción activa llama a la cancelación de Stripe antes de borrar (mock de `fetch`); tras borrar no quedan documentos del usuario en ninguna colección; con contraseña errónea devuelve 401 y no borra nada.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3:** UI en la página de ajustes: botón "Descargar mis datos" (JSON) y "Eliminar cuenta" con confirmación escribiendo el email.
- [ ] **Step 4:** Cookie banner mínimo y página `/cookies` con tabla de cookies reales usadas (`mockia_rt`, preferencia de idioma).
- [ ] **Step 5 (solo si se guardan tokens GitHub):** cifrar en reposo con AES-256-GCM (`crypto.createCipheriv`), clave `DATA_ENC_KEY` de 32 bytes en entorno; helper `encryptSecret/decryptSecret` con test de ida y vuelta y de manipulación (el tag falla).
- [ ] **Step 6: Commit** `feat(gdpr): exportar y eliminar cuenta, banner de cookies`.

---

## Fase C — Cobro y fiscalidad

### Task 7: Impuestos y facturas con Stripe Tax (H8)

**Files:**
- Modify: `modules/billing/service.ts` (creación de la sesión de Checkout), `modules/billing/routes.ts`, `.env.example`
- Test: `packages/backend/src/tests/billing.checkout.test.ts`

**Interfaces:**
- Produces: la sesión de Checkout se crea con `automatic_tax[enabled]=true`, `tax_id_collection[enabled]=true`, `billing_address_collection=required`, `customer_update[address]=auto`, `customer_update[name]=auto`, `consent_collection[terms_of_service]=required` y `invoice_creation` activada; los precios en Stripe con `tax_behavior=exclusive` y el código fiscal de SaaS `txcd_35000000`.

- [ ] **Step 1: Test**: el cuerpo enviado a `/v1/checkout/sessions` (mock de `fetch`) contiene las claves anteriores.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3 (manual, usuario):** alta como autónomo/sociedad, activar Stripe Tax, añadir registro **OSS de la UE** (ventanilla única) si se vende a consumidores de otros países, y revisar el umbral de 10 000 € de ventas a distancia intracomunitarias. Documentar en `docs/pagos.md`.
- [ ] **Step 4:** Confirmar con la gestoría el tratamiento del IVA español y la emisión de facturas (Stripe genera la factura; los datos fiscales del vendedor se configuran en el panel).
- [ ] **Step 5: Commit** `feat(billing): IVA automatico, NIF-IVA y consentimiento de terminos en Checkout`.

### Task 8: Robustez del webhook y ciclo de vida del impago (H8)

**Files:**
- Modify: `modules/billing/service.ts`, `modules/billing/routes.ts`, `services/notification.service.ts`
- Test: ampliar `billing.webhook.test.ts`

**Interfaces:**
- Consumes: `mailer.sendMail` (T4).
- Produces: manejo de `invoice.payment_failed` (estado `past_due`, aviso por email y notificación dentro de la app, 7 días de gracia antes de degradar a Free), `customer.subscription.trial_will_end`, `charge.refunded`; si el evento llega para un cliente aún sin usuario devuelve 500 para que Stripe reintente.

- [ ] **Step 1: Tests**: pago fallido → `past_due` y se envía correo; a los 8 días se degrada; evento de cliente desconocido → 500; reproducir el mismo evento dos veces no duplica correos.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3: Commit** `feat(billing): gestion de impagos con periodo de gracia y avisos`.

### Task 9: Plan de precios que se pueda vender (H11)

**Files:**
- Modify: `shared/src/billing.ts`, `frontend/src/components/billing/PricingPlans`, `pages/Landing/*`, locales
- Test: `packages/shared` (`billing.test.ts`) y `cypress/e2e/billing.cy.ts`

**Interfaces:**
- Produces: `PLAN_PRICE_USD` con precio anual (`annual: number`) y descuento visible; toggle mensual/anual en `PricingPlans`; Stripe necesita dos `price_id` por plan (`STRIPE_PRICE_PRO_YEARLY`, etc.); `plan derivado del price id` ya existente se amplía.

- [ ] **Step 1: Tests**: el plan se deduce bien desde un price anual; el toggle cambia los importes mostrados.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3:** Retirar de la landing las cifras y el testimonio inventados (H11); sustituirlos por datos reales de `/api/stats` (nº de mocks creados) o quitarlos.
- [ ] **Step 4: Commit** `feat(billing): precio anual y landing sin cifras falsas`.

---

## Fase D — Que sirva de verdad (valor de producto)

> Lo que un usuario real espera de un mocker de APIs. Cada tarea es independiente; se prioriza por impacto/esfuerzo.

### Task 10: Exportar e integrar los mocks

**Files:**
- Create: `modules/projects/export.ts`, `modules/mock/openapiExport.ts`, `frontend/src/components/projects/ExportMenu`
- Test: `packages/backend/src/tests/projects.export.test.ts`

**Interfaces:**
- Produces: `exportOpenApi(projectId: string): Promise<object>` (OpenAPI 3.1 válido), `exportPostman(projectId: string)`, `exportMswHandlers(projectId: string): Promise<string>` (código para MSW). Endpoints `GET /projects/:id/export?format=openapi|postman|msw`.

- [ ] **Step 1: Tests**: el OpenAPI generado pasa validación (`@apidevtools/swagger-parser`) y contiene todas las rutas del proyecto; los handlers MSW compilan con `tsc --noEmit`.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3: Commit** `feat(projects): exportar a OpenAPI, Postman y MSW`.

### Task 11: Uso real: claves de API del mock, URL pública estable y límites por plan

**Files:**
- Create: `models/ApiKey.ts`, `modules/mock/mockAuth.ts`
- Modify: `modules/mock/interceptor.controller.ts`, `middlewares/planGate.ts`, `modules/billing/usage.ts`
- Test: `packages/backend/src/tests/mock.apiKey.test.ts`

**Interfaces:**
- Produces: proyecto con `visibility: 'public' | 'key'`; con `key` el mock exige cabecera `X-Mockia-Key` (hash SHA-256 guardado); contador de peticiones mock por mes en `usages` con tope por plan y respuesta `429` con `Retry-After`; cabeceras `X-RateLimit-Remaining`.

- [ ] **Step 1: Tests**: mock privado sin clave → 401; con clave → 200; superado el tope del plan Free → 429 con `Retry-After`; el contador no cuenta peticiones rechazadas.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3: Commit** `feat(mock): claves de API por proyecto y cuota mensual de peticiones`.

---

## Fase E — IA propia autoalojada (reemplazo de OpenRouter)

**Decisión de diseño (con razonamiento):**
- **No empezar entrenando.** Primero medir. Entrenar (LoRA/QLoRA) solo compensa si hay un conjunto de ejemplos propios y volumen; las guías consultadas sitúan el punto de cruce entre 100 mil y 1 millón de consultas al mes. La tarea de Mockia (leer tipos TypeScript/OpenAPI y emitir un JSON de endpoints validable) está muy acotada, así que un modelo pequeño con **salida restringida a un JSON Schema** (vLLM `guided_json`/xgrammar u Ollama `format`) suele bastar sin entrenar.
- **Modelo candidato:** familia Qwen2.5-Coder (7B/14B) por tamaño y soporte de contexto largo y salida estructurada. Las fuentes que encontré son artículos de blog, no benchmarks propios, así que **la elección final sale de la Task 13 con datos de Mockia**, no de este plan.
- **Hardware = decisión de coste, no de código.** Un 7B cuantizado va en una GPU de 8–12 GB; en CPU funciona pero tarda decenas de segundos (hay que medirlo). Render *free* no sirve para esto: se necesita un VPS/GPU (p. ej. alquiler por horas) o una máquina propia. Mientras tanto OpenRouter sigue como reserva.
- **Entrenado "solo para mi app":** el camino es (1) prompt + esquema restringido, (2) recoger ejemplos con consentimiento (T15), (3) LoRA solo si la evaluación muestra un hueco. Mockia debe poder cambiar de modelo sin tocar el código: de ahí la interfaz de proveedor.

### Task 12: Interfaz de proveedor de IA con reserva automática (H9)

**Files:**
- Create: `packages/backend/src/modules/ai/providers/{types,openaiCompatible,index}.ts`
- Modify: `config/ai.ts`, `services/openRouter.service.ts` (pasa a ser un caso del proveedor genérico), `controllers/ai.controller.ts`, `utils/openRouterUtils.ts`
- Test: `packages/backend/src/tests/ai.providers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface LlmProvider { name: string; complete(req: { messages: ChatMessage[]; jsonSchema?: object; maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> }
  getLlm(): LlmProvider   // lee AI_PROVIDERS="local,openrouter" (orden de preferencia)
  ```
- `openaiCompatible` habla `POST {AI_LOCAL_BASE_URL}/v1/chat/completions` (Ollama, vLLM y llama.cpp lo exponen), pasa `response_format` con el esquema; el limitador por minuto pasa a Mongo/`usages` (clave por usuario, no global en memoria).
- Variables: `AI_PROVIDERS`, `AI_LOCAL_BASE_URL`, `AI_LOCAL_MODEL`, `AI_LOCAL_TIMEOUT_MS` (por defecto 120000), más las de OpenRouter existentes.

- [ ] **Step 1: Tests**: el proveedor local responde → se usa; el local da timeout/ECONNREFUSED/5xx → se llama al siguiente y se registra el motivo; con `jsonSchema` el cuerpo lleva `response_format`; temperatura por defecto `0.2` para salida estructurada.
- [ ] **Step 2:** FALLA → implementar → PASA (reutilizando el retry/backoff existente).
- [ ] **Step 3:** Correr `ai.pipeline.test.ts` y `openRouter.test.ts` existentes; deben seguir en verde.
- [ ] **Step 4: Commit** `refactor(ai): proveedor de LLM intercambiable con reserva automatica`.

### Task 13: Banco de evaluación de la IA (antes de elegir modelo)

**Files:**
- Create: `packages/backend/evals/cases/*.json` (≥30 casos reales: repos pequeños con tipos TS/OpenAPI y la salida esperada), `packages/backend/evals/run.ts`, `evals/README.md`
- Modify: `packages/backend/package.json` (`"eval": "tsx evals/run.ts"`)
- Test: `packages/backend/src/tests/evals.scoring.test.ts` (solo el puntuador)

**Interfaces:**
- Produces: `scoreOutput(expected: EndpointSpec[], actual: unknown): { validJson: boolean; schemaValid: boolean; methodPathF1: number; fieldCoverage: number }` y un informe por modelo (`validJson%`, `schemaValid%`, F1 medio, latencia p50/p95, tokens/s). Criterio de aceptación para sustituir a OpenRouter: `schemaValid ≥ 95 %` y `methodPathF1 ≥ 0.85` con latencia p95 ≤ 60 s.

- [ ] **Step 1: Tests** del puntuador con salida perfecta (F1=1), vacía (0), con un endpoint inventado (precisión baja) y JSON roto (`validJson=false`).
- [ ] **Step 2:** FALLA → implementar el puntuador → PASA.
- [ ] **Step 3:** `evals/run.ts --provider=openrouter` genera la **línea base** y se guarda en `evals/baseline.json`.
- [ ] **Step 4: Commit** `test(ai): banco de evaluacion y linea base`.

### Task 14: Servicio de IA en Docker (Ollama o vLLM) y puesta en producción

**Files:**
- Create: `docker-compose.ai.yml`, `docs/ia-local.md`, `scripts/pull-model.sh`
- Modify: `docker-compose.prod.yml` (perfil `ai`), `nginx.conf` (no exponer el puerto del modelo), `.env.example`

**Interfaces:**
- Produces: servicio `llm` en la red interna (`http://llm:11434` Ollama o `:8000` vLLM), volumen persistente de modelos, `deploy.resources.reservations.devices` con `driver: nvidia` (comentado para CPU), `healthcheck`, **sin `ports:`** publicados, `restart: unless-stopped`.

- [ ] **Step 1:** Levantar `docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d llm` y descargar el modelo candidato con `scripts/pull-model.sh qwen2.5-coder:7b-instruct`.
- [ ] **Step 2:** `npm run eval -w packages/backend -- --provider=local` con 2–3 modelos candidatos (p. ej. 7B, 14B, y un cuantizado distinto); registrar la tabla en `docs/ia-local.md`.
- [ ] **Step 3:** Si no se alcanza el criterio de T13 con prompt + esquema restringido, pasar a la T15; si se alcanza, activar `AI_PROVIDERS=local,openrouter`.
- [ ] **Step 4:** Probar la caída: parar el contenedor `llm` y comprobar en `docker logs` que el backend cae a OpenRouter sin error al usuario (cubre el Review Focus 4).
- [ ] **Step 5: Commit** `feat(ai): servicio LLM autoalojado en Docker`.

### Task 15: Datos propios y ajuste fino opcional (LoRA)

**Files:**
- Create: `models/AiFeedback.ts`, `modules/ai/feedback.ts`, `scripts/ai/export-dataset.ts`, `docs/ia-entrenamiento.md`
- Modify: `frontend` (botones "útil / no útil" y edición del resultado), `Privacy.tsx` (consentimiento específico y opt-in)
- Test: `packages/backend/src/tests/ai.feedback.test.ts`

**Interfaces:**
- Produces: `recordFeedback(userId: string, generationId: string, verdict: 'good'|'bad', correctedOutput?: unknown): Promise<void>`; `export-dataset` genera `train.jsonl` en formato chat (`messages`) solo con usuarios que dieron **consentimiento explícito**, sin emails, con secretos del repo eliminados (regex de claves) y deduplicado.

- [ ] **Step 1: Tests**: sin consentimiento no entra nada en el dataset; los strings que parecen claves (`sk_`, `ghp_`, `AKIA…`) se eliminan; dos generaciones idénticas se deduplican.
- [ ] **Step 2:** FALLA → implementar → PASA.
- [ ] **Step 3 (solo si T14 no alcanzó el criterio y hay ≥ 500 ejemplos buenos):** QLoRA sobre el modelo ganador con Unsloth (cabe en ~6,5 GB de VRAM para ~7–9B en 4 bit, según su documentación), en una GPU alquilada por horas; exportar adaptador, servirlo con Ollama (`Modelfile` con `ADAPTER`) o vLLM (`--enable-lora`).
- [ ] **Step 4:** Reevaluar con T13 sobre un conjunto de test **no usado en el entrenamiento**; solo se promociona si mejora la línea base.
- [ ] **Step 5: Commit** `feat(ai): recogida de feedback con consentimiento y exportador de dataset`.

---

## Orden recomendado y estimación

| Orden | Tareas | Por qué primero |
|-------|--------|-----------------|
| 1 | T1, T5 (paso 4) | Riesgo inmediato: Mongo expuesto y una afirmación legal falsa. Horas de trabajo. |
| 2 | T2, T3, T4 | Sesión segura y recuperar contraseña: sin esto no se puede abrir al público. |
| 3 | T5, T6 | Cumplimiento: necesario antes de recoger datos de usuarios reales. |
| 4 | T7, T8, T9 | Cobrar con impuestos y gestionar impagos. Requiere alta fiscal tuya (manual). |
| 5 | T12, T13 | Abstracción y línea base de IA: bajo riesgo, desbloquea la T14. |
| 6 | T10, T11 | Utilidad de producto. |
| 7 | T14, T15 | IA propia: necesita decidir hardware/coste. |

## Lo que solo puedes hacer tú

- Alta fiscal (autónomo/sociedad), cuenta Stripe en modo real y registro OSS; dominio y correo (SPF/DKIM).
- Elegir hardware de IA (VPS con GPU vs máquina propia vs seguir con OpenRouter) y su presupuesto.
- Revisión de los textos legales por un abogado/gestoría antes de publicarlos.

## Self-review

- **Cobertura:** legal (T5, T6), pago (T7–T9), token de sesión (T2, T3), interfaces (T4, T6 y T9 añaden pantallas con el estilo nuevo; no hay tarea de rediseño aparte porque la UI principal ya se rehízo), "todo en general" (T1, T10, T11), IA propia (T12–T15). Cada hallazgo H1–H11 tiene tarea.
- **Tipos:** `createSession/rotateSession` (T2) son lo que consumen T3 y T4; `sendMail` (T4) lo usa T8; `LlmProvider.complete` (T12) lo usa T13/T14.
- **Límite conocido:** las recomendaciones de modelo vienen de artículos y no de pruebas propias; por eso la elección es el resultado de T13/T14. Los puntos legales son orientativos y no sustituyen asesoría.
