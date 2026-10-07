# Pagos, impuestos y facturas con Stripe: lo que debe hacer el titular

El código ya crea el Checkout con IVA automático, recogida de NIF-IVA, dirección de facturación obligatoria y aceptación de los Términos (`modules/billing/service.ts`). **Nada de esto funciona hasta que el titular configura Stripe a mano**: son pasos que solo puede dar quien tiene la cuenta y los datos fiscales. Esta lista dice qué hacer y por qué.

> Este documento es una guía técnica, no asesoramiento fiscal. Confirma el tratamiento del IVA y la facturación con una gestoría antes de cobrar a clientes reales (paso 11).

Convención: `<APP_URL>` es la URL pública de la aplicación (variable `APP_URL`) y `<API_URL>` la del backend. En Render con las rutas de `render.yaml` el navegador llega a la API a través del frontend, así que `<API_URL>` = `<APP_URL>`; en un servidor propio con nginx, también (nginx reenvía `/api`).

## Checklist

### 1. Cuenta de Stripe (modo prueba primero, después modo real)

- [ ] Crear la cuenta en <https://dashboard.stripe.com/register> y trabajar con el interruptor **Modo de prueba** activado hasta tener todo verificado.
- [ ] Repetir los pasos 2 a 8 en **modo real** cuando las pruebas pasen. Los productos, precios, webhooks y claves de prueba **no** se copian al modo real: hay que crearlos de nuevo y los identificadores (`price_...`, `whsec_...`) son distintos.
- [ ] Completar la activación de la cuenta (datos del negocio, titular, cuenta bancaria). Sin ella el modo real no cobra.

Por qué: el código solo habla con la cuenta cuyas claves le des. Mezclar claves de prueba con precios reales (o al revés) da errores `No such price`.

### 2. Productos y precios (Pro y Team)

- [ ] Crear dos productos: **Pro** y **Team** (Dashboard → Catálogo de productos).
- [ ] En cada producto, **dos precios recurrentes** en **USD** (los importes que muestra la web están en dólares: ver `PLAN_PRICE_USD` en `@mockia/shared`):

  | Producto | Mensual (`interval = month`) | Anual (`interval = year`) |
  | --- | --- | --- |
  | Pro | 29 USD | 290 USD |
  | Team | 99 USD | 990 USD |

  El anual es **10 veces el mensual** (dos meses gratis, un 17 % de ahorro): es lo que anuncia la web, calculado en `@mockia/shared` (`ANNUAL_MONTHS_CHARGED`, `ANNUAL_DISCOUNT_PERCENT`). Si cambias un importe en Stripe, cámbialo también en `PLAN_PRICE_USD` (`packages/shared/src/billing.ts`) y reconstruye `@mockia/shared`: Stripe cobra lo que tenga el Price, la web solo anuncia.
- [ ] En **cada uno de los cuatro precios**, **Tax behavior = Exclusive** (el impuesto se suma al precio mostrado). Es lo que prometen los Términos ("los precios se indican sin impuestos").
- [ ] En cada producto, **Tax code = `txcd_35000000`** (el código fiscal acordado para el software como servicio). Comprueba en el selector de códigos del producto que ese código sigue siendo el de SaaS que quieres (Stripe distingue algunos usos, p. ej. personal o empresarial) y confírmalo con la gestoría.
- [ ] Copiar los cuatro identificadores `price_...` (no `prod_...`) a `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_PRO_YEARLY` y `STRIPE_PRICE_TEAM_YEARLY` (paso 9).

Por qué: el código deduce el plan **y el intervalo** del `price_...` de la suscripción (un `price_...` que no sea uno de los cuatro configurados nunca concede un plan de pago). Con `tax_behavior` vacío Stripe Tax no sabe si el importe incluye impuesto y rechaza la sesión o cobra de más; el tax code decide el tipo aplicable.

### 3. Activar Stripe Tax

- [ ] Dashboard → Impuestos → **Activar Stripe Tax**.
- [ ] **Dirección de origen** (desde donde se prestan los servicios) y **dirección de la sede social**.
- [ ] Añadir el **registro fiscal de España** (tu NIF-IVA) para que Stripe calcule y muestre el IVA español.
- [ ] Si vas a vender a **consumidores de otros países de la UE**: añadir el **registro OSS de la UE** (ventanilla única, régimen de la Unión) en Impuestos → Registros. Es **un único registro** que cubre todos los demás Estados miembros; sin él no hay forma legal de cobrar el IVA local de cada país desde España.
- [ ] Revisar el **umbral de 10 000 € anuales** de ventas a distancia intracomunitarias a consumidores (suma de todos los países de la UE): por debajo, se puede aplicar el IVA del país del vendedor; al superarlo, hay que tributar en el país del consumidor (y el OSS lo simplifica). Confírmalo con la gestoría y vigila el umbral en el panel de Stripe Tax.

Por qué: `automatic_tax[enabled]=true` solo calcula impuesto en los países donde tienes registro. En los demás, Stripe no cobra IVA (y no avisa a tu usuario).

### 4. Datos públicos y enlaces legales (obligatorio para el consentimiento)

- [ ] Dashboard → Configuración → **Detalles públicos** (Business → Public details): rellenar
  - **URL de las condiciones del servicio**: `<APP_URL>/terms`
  - **URL de la política de privacidad**: `<APP_URL>/privacy`
- [ ] Nombre público y datos de contacto/soporte.

Por qué: `consent_collection[terms_of_service]=required` hace que Stripe se niegue a crear la sesión si no hay URL de condiciones configurada. El texto que acompaña a la casilla (`custom_text[terms_of_service_acceptance]`) enlaza a `<APP_URL>/terms` automáticamente desde el código.

### 5. Datos del vendedor en las facturas

- [ ] Dashboard → Configuración → Facturación → **Facturas**: nombre fiscal o razón social, **NIF**, dirección fiscal, correo, logo. Prefijo y numeración correlativa de facturas.
- [ ] Marcar que Stripe **envíe la factura por correo** al cliente y que muestre el **NIF-IVA del cliente** si lo introduce.

Por qué: en una suscripción Stripe genera la factura automáticamente en cada cobro; los datos fiscales del vendedor salen de esta configuración, no del código. (`invoice_creation` no se envía a propósito: solo existe en `mode=payment`.)

### 6. Portal de cliente

- [ ] Dashboard → Configuración → Facturación → **Portal de cliente** → guardar la configuración (hasta guardarla, `POST /api/billing/portal` da error 502).
- [ ] Activar: **cancelar suscripciones** (la cancelación **al final del periodo de facturación**), **actualizar el método de pago**, **historial de facturas**, y la actualización de datos de facturación (nombre, dirección, NIF-IVA).
- [ ] Si quieres cambio de plan desde el portal (la web lo ofrece como "Cambiar a Pro/Team"): activar **actualizar suscripciones** y añadir los productos Pro y Team **con sus precios mensual y anual**, para que el cliente pueda pasar de mensual a anual (y al revés) desde el portal; el webhook actualiza plan e intervalo solo.

Por qué: la interfaz envía al usuario al portal para cambiar de plan, cancelar y ver facturas; la lógica del webhook (`customer.subscription.updated`) deduce el plan del precio, así que un cambio de plan en el portal se aplica solo.

### 7. Reintentos de cobro (Smart Retries / dunning)

- [ ] Dashboard → Configuración → Facturación → **Suscripciones y correos electrónicos** (Subscriptions and emails) → **Reintentos de pagos fallidos** (Manage failed payments): activar **Smart Retries** y elegir la ventana más corta, **1 semana** (*retry … within 1 week*). Así el último reintento de Stripe cae dentro de los 7 días de gracia de la web.
- [ ] En **Si fallan todos los reintentos de pago de una factura** (*If all retries for a payment fail*) elegir **Cancelar la suscripción** (*Cancel the subscription*). No uses "marcar como impagada" ni "dejar vencida": los Términos dicen que, pasada la gracia, la cuenta pasa a Free; con la suscripción cancelada Stripe deja de cobrar y envía `customer.subscription.deleted`, que deja la cuenta en Free y sin cobros pendientes.
- [ ] En la misma pantalla, activar los correos de "pago fallido" y "tarjeta a punto de caducar" al cliente (Stripe los envía además de los de Mockia).

Por qué: los Términos prometen que, si un cobro falla, la suscripción pasa a `past_due`, se avisa por correo y en la aplicación, Stripe reintenta el cobro y hay **7 días de gracia** antes de pasar a Free. El código cumple su parte (`PAST_DUE_GRACE_DAYS = 7` en `@mockia/shared`); la parte de Stripe (reintentar y cancelar al final) solo ocurre si lo configuras aquí.

Cómo funciona la gracia en el código:

- El primer cobro fallido (`invoice.payment_failed`, o `customer.subscription.updated` con estado `past_due`) pone `billingStatus = past_due` y guarda `pastDueSince` con la hora del evento. **Ni un reintento ni otra factura fallida lo alargan**: la gracia siempre cuenta desde el primer fallo.
- Durante 7 días el usuario conserva el plan de pago (Pro o Team) y la web le muestra un aviso con la fecha límite y un botón al portal para actualizar la tarjeta. Pasado ese plazo el plan efectivo es Free (las cuotas de Free se aplican desde la siguiente petición; la caché de plan nunca sobrevive al fin de la gracia). Los proyectos y datos no se borran.
- Se envía **un solo correo** y **un solo aviso en la app** por secuencia de impago (se reponen cuando el cobro se recupera): reentregas del mismo evento, reintentos de la misma factura o una segunda factura fallida no vuelven a avisar.
- Si un reintento tiene éxito (`invoice.paid`, `invoice.payment_succeeded` o `customer.subscription.updated` con `active`) la cuenta vuelve a `active` y se borra `pastDueSince`. Si Stripe cancela la suscripción (`customer.subscription.deleted`) pasa a Free/`canceled`.
- Un estado `unpaid`, `incomplete` o `paused` de Stripe **no** abre gracia (nunca hubo un pago que falló sobre un plan ya concedido), y el fallo de la primera factura de una suscripción nueva (`billing_reason = subscription_create`) se ignora: el checkout no llegó a completarse.
- Usuarios que ya estaban en `past_due` antes de esta versión no tienen `pastDueSince`: siguen en Free hasta que se recuperen.

### 8. Webhook

- [ ] Dashboard → Desarrolladores → **Webhooks** → añadir endpoint: `<API_URL>/api/billing/webhook` (ruta real: `billingRouter.post('/webhook')` montado en `/api/billing`, ver `modules/billing/routes.ts`).
- [ ] Eventos a suscribir (los que maneja `handleStripeEvent`, ver tabla abajo).
- [ ] Copiar el **secreto de firma** (`whsec_...`) a `STRIPE_WEBHOOK_SECRET`.

Por qué: es la única forma de que el plan del usuario cambie tras pagar, fallar un cobro o cancelar. Sin `STRIPE_WEBHOOK_SECRET` el endpoint responde 501 y no acepta nada sin firmar.

#### Eventos que maneja el código

> Esta tabla refleja `handleStripeEvent` en `packages/backend/src/modules/billing/service.ts`. **Suscribe el endpoint a estos nueve eventos** (los de la columna izquierda); cualquier otro se recibe, se responde con 200 y se ignora.

| Evento | Qué hace el código |
| --- | --- |
| `checkout.session.completed` | Activa el plan elegido, guarda cliente y suscripción de Stripe y cierra cualquier impago anterior. |
| `customer.subscription.created` | Sincroniza estado, plan (por el precio) y fin del periodo. |
| `customer.subscription.updated` | Igual; cubre cambios de plan, cancelación al final del periodo y cambios de estado: `past_due` abre la gracia (si no estaba abierta), `active`/`trialing` la cierra, `unpaid`/`incomplete`/`paused` quedan sin acceso y sin gracia. |
| `customer.subscription.deleted` | Vuelve al plan Free (`canceled`) y cierra el impago. |
| `invoice.payment_failed` | Pone `past_due` y abre la gracia de 7 días (solo a usuarios con plan de pago y salvo en la primera factura de la suscripción). Envía un correo (`payment_failed`, en el idioma del usuario, con la fecha límite y enlace a `<APP_URL>/billing`) y crea un aviso en la app, una sola vez por secuencia de impago. |
| `invoice.paid` | Si el usuario está en `past_due`, vuelve a `active` y borra la gracia (no lo hace si la factura pagada es otra distinta de la que falló). |
| `invoice.payment_succeeded` | Igual que `invoice.paid` (Stripe envía los dos; el segundo no cambia nada). |
| `customer.subscription.trial_will_end` | Envía un correo (`trial_will_end`) y un aviso en la app con la fecha en que acaba la prueba. Hoy no hay pruebas configuradas: solo actúa si algún día se añaden. |
| `charge.refunded` | Solo un aviso en la app con el importe reembolsado. No cambia el plan: si el reembolso acompaña a una cancelación, esta llega como `customer.subscription.deleted`. |

Garantías comunes:

- La **firma** se verifica antes de mirar nada del evento; una firma inválida es 400.
- Cada evento se aplica **como máximo una vez por usuario** (id y hora del último evento aplicado) y uno más antiguo que el último aplicado se descarta, así que las reentregas y los eventos desordenados no repiten correos ni deshacen un cambio posterior.
- **Cliente que aún no está enlazado a ningún usuario:** si el evento tiene menos de 1 hora, el webhook responde **500** y Stripe lo reintenta (cubre la carrera en que una factura o suscripción llega antes que `checkout.session.completed`, que es quien enlaza el cliente). Si es más viejo, responde 200 y deja un aviso en el log sin datos personales (las cuentas borradas dejan clientes huérfanos en Stripe que, si no, reintentarían durante días). En el panel de Stripe verás esos 500 como entregas fallidas durante un rato: es lo esperado.
- Un fallo al enviar el correo o crear el aviso nunca hace fallar el webhook (el estado ya está guardado y Stripe reintentando solo duplicaría); se registra sin dirección ni identificadores.
- El correo necesita `SMTP_URL` y `MAIL_FROM` (ver `docs/08_despliegue.md`); sin SMTP el usuario solo recibe el aviso dentro de la aplicación y el correo de dunning de Stripe del paso 7.

### 9. Variables de entorno del backend

Se definen en `.env` (Docker/servidor propio) o en el panel de Render (`render.yaml` las declara con `sync: false`). Plantilla en `.env.example`:

| Variable | Valor |
| --- | --- |
| `STRIPE_SECRET_KEY` | Clave secreta `sk_test_...` (prueba) o `sk_live_...` (real). Nunca en el frontend ni en Git. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` del paso 8. |
| `STRIPE_PRICE_PRO` | `price_...` del precio mensual de Pro. |
| `STRIPE_PRICE_TEAM` | `price_...` del precio mensual de Team. |
| `STRIPE_PRICE_PRO_YEARLY` | `price_...` del precio anual de Pro (290 USD). |
| `STRIPE_PRICE_TEAM_YEARLY` | `price_...` del precio anual de Team (990 USD). |

Las dos variables `*_YEARLY` son opcionales: sin ellas el backend arranca y se puede contratar al mes, pero `POST /api/billing/checkout` con `interval: "year"` responde **501** nombrando la variable que falta y la web no ofrece comprar al año ese plan (`yearlyCheckoutAvailable` en `GET /api/billing/me`).

Opcionales: `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL` (por defecto `/billing` de la aplicación). Importante: `APP_URL` también es obligatoria en producción y de ahí sale el enlace a los Términos que ve el cliente en el pago.

### 10. Datos legales del titular (ya documentados aparte)

- [ ] Las variables `VITE_LEGAL_*` del `.env.example` deben tener los mismos datos fiscales que configuraste en Stripe (paso 5). Los Términos mencionan al titular y deben coincidir con la factura.

### 11. Gestoría

- [ ] Confirmar con la gestoría: alta como autónomo o sociedad, **tratamiento del IVA español** (y de las ventas a empresas con NIF-IVA intracomunitario, inversión del sujeto pasivo), **emisión y conservación de facturas** (Stripe las genera; la gestoría debe poder contabilizarlas), **declaración OSS** trimestral si te registras, y el **umbral de 10 000 €**.

## Probar en modo de prueba

Con el interruptor de prueba activo y las claves `sk_test_...`:

1. Arranca el backend con las variables del paso 9 (las 4 de siempre y, para probar el anual, las dos `*_YEARLY`) y la web en local.
2. Reenvía los webhooks a tu máquina con la CLI de Stripe (instálala y haz `stripe login`):

   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```

   La CLI imprime un `whsec_...` temporal: ponlo como `STRIPE_WEBHOOK_SECRET` mientras pruebas (es distinto del secreto del endpoint real).
3. En la web: registra un usuario, **verifica el correo** (el checkout lo exige), ve a *Plan y facturación*, elige **Mensual** o **Anual** con el selector y pulsa Pro o Team. En el Checkout el importe debe ser el del intervalo elegido; tras pagar, *Plan y facturación* indica "Facturación anual" o "mensual".
4. En el Checkout comprueba: dirección de facturación obligatoria, campo de **NIF-IVA**, casilla de aceptación de los Términos con el texto de acceso inmediato y pérdida del desistimiento, y la línea de **impuestos** calculada según el país.
5. Tarjetas de prueba (cualquier fecha futura, CVC y código postal):

   | Tarjeta | Resultado |
   | --- | --- |
   | `4242 4242 4242 4242` | El pago se completa. |
   | `4000 0000 0000 0341` | Se guarda la tarjeta, pero el cobro **falla**: sirve para probar `past_due`, los reintentos, los avisos y el fin de la gracia (ver "Probar un impago" más abajo). |

6. Comprueba que el usuario pasa al plan elegido (página de facturación) y que `stripe listen` muestra los eventos con respuesta 200.
7. Abre el portal ("Gestionar facturación"), cancela al final del periodo y verifica que la web muestra la cancelación programada.
8. Revisa la factura generada (Dashboard → Facturas): datos del vendedor, IVA y NIF-IVA del cliente si lo introdujiste.

### Probar un impago (past_due, gracia y avisos)

El Checkout no se puede completar con la tarjeta `4000 0000 0000 0341` (el primer cobro falla y la sesión no termina), así que el impago se provoca en una **renovación**:

1. Suscríbete a Pro con `4242 4242 4242 4242` (paso 3 de arriba).
2. Para controlar el tiempo, usa un **reloj de pruebas** (Dashboard → Facturación → Relojes de prueba / *Test clocks*): crea un reloj, crea en él un cliente con la tarjeta `4242...` y copia su `cus_...` en el campo `stripeCustomerId` del usuario en MongoDB **antes** de suscribirte en la web (el Checkout reutiliza el cliente del usuario). Un cliente creado por el propio Checkout no se puede enganchar a un reloj a posteriori.
3. Cambia el método de pago por defecto del cliente a `4000 0000 0000 0341` (Dashboard → Clientes → el cliente, o desde el portal).
4. **Avanza el reloj** más de un mes. La renovación falla y debes ver: `invoice.payment_failed` con 200 en `stripe listen`; en la web, el aviso "No hemos podido cobrar tu tarjeta… sigue activo hasta <fecha>" (en Facturación y en el panel), el chip del plan marcado "Pago fallido", un aviso en la campana y un correo `payment_failed` (en desarrollo, el enlace sale en el log del backend; en E2E, en `GET /api/__test__/outbox`).
5. Avanza el reloj **más de 7 días** más: el plan efectivo pasa a Free (el aviso cambia a "limitada al plan Free") y, al agotarse los reintentos, Stripe cancela la suscripción y llega `customer.subscription.deleted`.
6. Para ver la recuperación, antes de ese punto cambia la tarjeta a `4242...` y paga la factura abierta desde el Dashboard: llegan `invoice.paid` y `customer.subscription.updated` (`active`) y el aviso desaparece.

Para comprobar a mano el **500 de cliente desconocido**, `stripe trigger invoice.payment_failed` crea un cliente que no pertenece a ningún usuario: el webhook responde 500 mientras el evento tenga menos de una hora (la CLI lo muestra como fallo), y 200 si lo reenvías pasada la hora.

> Estos pasos no se han podido ejecutar contra Stripe real desde el repositorio. Lo que sí está cubierto por tests automáticos (`billing.webhook.test.ts`, `billing.dunning.test.ts` con MongoDB real, `billing.planGate.test.ts` y `billing.cy.ts`) es toda la lógica del webhook, la gracia de 7 días (día 6,9 mantiene el plan, día 7,1 pasa a Free), el aviso único y la pantalla.

## Lo que hace el código y lo que no

- Hace: precio mensual o anual (`interval` en `POST /api/billing/checkout`; el intervalo vigente sale del `price_...` de la suscripción y se guarda en el usuario), IVA automático (`automatic_tax`), NIF-IVA (`tax_id_collection`), dirección obligatoria (`billing_address_collection`), aceptación de Términos con el texto de desistimiento (`consent_collection` + `custom_text`), idioma del Checkout según el idioma guardado del usuario (`es`, `en`, `zh`; si no lo hay, Stripe lo detecta), y `customer_update[address|name]=auto` solo cuando el usuario ya es cliente de Stripe (con `customer_email` Stripe lo rechaza).
- Hace también: gestión del impago con 7 días de gracia, correo y aviso en la app (ver pasos 7 y 8).
- No hace: configurar la cuenta de Stripe, los registros fiscales, los productos, el portal ni los reintentos. Tampoco emite facturas por su cuenta: las genera Stripe.
