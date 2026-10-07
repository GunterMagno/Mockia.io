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
- [ ] En cada producto, un precio **recurrente mensual** en **USD** (los importes que muestra la web están en dólares: ver `PLAN_PRICE_USD` en `@mockia/shared`).
- [ ] En cada precio, **Tax behavior = Exclusive** (el impuesto se suma al precio mostrado). Es lo que prometen los Términos ("los precios se indican sin impuestos").
- [ ] En cada producto, **Tax code = `txcd_35000000`** (el código fiscal acordado para el software como servicio). Comprueba en el selector de códigos del producto que ese código sigue siendo el de SaaS que quieres (Stripe distingue algunos usos, p. ej. personal o empresarial) y confírmalo con la gestoría.
- [ ] Copiar los dos identificadores `price_...` (no `prod_...`) a `STRIPE_PRICE_PRO` y `STRIPE_PRICE_TEAM` (paso 9).

Por qué: con `tax_behavior` vacío Stripe Tax no sabe si el importe incluye impuesto y rechaza la sesión o cobra de más; el tax code decide el tipo aplicable.

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
- [ ] Si quieres cambio de plan desde el portal (la web lo ofrece como "Cambiar a Pro/Team"): activar **actualizar suscripciones** y añadir los productos Pro y Team.

Por qué: la interfaz envía al usuario al portal para cambiar de plan, cancelar y ver facturas; la lógica del webhook (`customer.subscription.updated`) deduce el plan del precio, así que un cambio de plan en el portal se aplica solo.

### 7. Reintentos de cobro (Smart Retries / dunning)

- [ ] Dashboard → Configuración → Facturación → **Suscripciones y correos electrónicos** (Subscriptions and emails): activar **Smart Retries** y los correos de "pago fallido" al cliente.
- [ ] Decidir la acción tras agotar los reintentos (cancelar la suscripción o marcarla como impagada).

Por qué: los Términos prometen que, si un cobro falla, Stripe lo reintenta. Sin esta opción el reintento no ocurre.

### 8. Webhook

- [ ] Dashboard → Desarrolladores → **Webhooks** → añadir endpoint: `<API_URL>/api/billing/webhook` (ruta real: `billingRouter.post('/webhook')` montado en `/api/billing`, ver `modules/billing/routes.ts`).
- [ ] Eventos a suscribir (los que maneja `handleStripeEvent`, ver tabla abajo).
- [ ] Copiar el **secreto de firma** (`whsec_...`) a `STRIPE_WEBHOOK_SECRET`.

Por qué: es la única forma de que el plan del usuario cambie tras pagar, fallar un cobro o cancelar. Sin `STRIPE_WEBHOOK_SECRET` el endpoint responde 501 y no acepta nada sin firmar.

#### Eventos (actualizar con T8)

> Esta tabla debe reflejar `handleStripeEvent` en `packages/backend/src/modules/billing/service.ts`. La tarea T8 (periodo de gracia, avisos de pago fallido) añadirá eventos: **actualizarla y suscribir los nuevos en Stripe**.

| Evento | Qué hace el código |
| --- | --- |
| `checkout.session.completed` | Activa el plan elegido y guarda cliente y suscripción de Stripe. |
| `customer.subscription.created` | Sincroniza estado, plan (por el precio) y fin del periodo. |
| `customer.subscription.updated` | Igual; cubre cambios de plan, impagos y cancelación al final del periodo. |
| `customer.subscription.deleted` | Vuelve al plan Free. |

El resto de eventos se reciben, se responden con 200 y se ignoran.

### 9. Variables de entorno del backend

Se definen en `.env` (Docker/servidor propio) o en el panel de Render (`render.yaml` las declara con `sync: false`). Plantilla en `.env.example`:

| Variable | Valor |
| --- | --- |
| `STRIPE_SECRET_KEY` | Clave secreta `sk_test_...` (prueba) o `sk_live_...` (real). Nunca en el frontend ni en Git. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` del paso 8. |
| `STRIPE_PRICE_PRO` | `price_...` del precio mensual de Pro. |
| `STRIPE_PRICE_TEAM` | `price_...` del precio mensual de Team. |

Opcionales: `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL` (por defecto `/billing` de la aplicación). Importante: `APP_URL` también es obligatoria en producción y de ahí sale el enlace a los Términos que ve el cliente en el pago.

### 10. Datos legales del titular (ya documentados aparte)

- [ ] Las variables `VITE_LEGAL_*` del `.env.example` deben tener los mismos datos fiscales que configuraste en Stripe (paso 5). Los Términos mencionan al titular y deben coincidir con la factura.

### 11. Gestoría

- [ ] Confirmar con la gestoría: alta como autónomo o sociedad, **tratamiento del IVA español** (y de las ventas a empresas con NIF-IVA intracomunitario, inversión del sujeto pasivo), **emisión y conservación de facturas** (Stripe las genera; la gestoría debe poder contabilizarlas), **declaración OSS** trimestral si te registras, y el **umbral de 10 000 €**.

## Probar en modo de prueba

Con el interruptor de prueba activo y las claves `sk_test_...`:

1. Arranca el backend con las 4 variables del paso 9 y la web en local.
2. Reenvía los webhooks a tu máquina con la CLI de Stripe (instálala y haz `stripe login`):

   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```

   La CLI imprime un `whsec_...` temporal: ponlo como `STRIPE_WEBHOOK_SECRET` mientras pruebas (es distinto del secreto del endpoint real).
3. En la web: registra un usuario, **verifica el correo** (el checkout lo exige), ve a *Plan y facturación* y elige Pro o Team.
4. En el Checkout comprueba: dirección de facturación obligatoria, campo de **NIF-IVA**, casilla de aceptación de los Términos con el texto de acceso inmediato y pérdida del desistimiento, y la línea de **impuestos** calculada según el país.
5. Tarjetas de prueba (cualquier fecha futura, CVC y código postal):

   | Tarjeta | Resultado |
   | --- | --- |
   | `4242 4242 4242 4242` | El pago se completa. |
   | `4000 0000 0000 0341` | Se guarda la tarjeta, pero el cobro **falla**: sirve para probar `past_due`, los reintentos y el plan degradado. |

6. Comprueba que el usuario pasa al plan elegido (página de facturación) y que `stripe listen` muestra los eventos con respuesta 200.
7. Abre el portal ("Gestionar facturación"), cancela al final del periodo y verifica que la web muestra la cancelación programada.
8. Revisa la factura generada (Dashboard → Facturas): datos del vendedor, IVA y NIF-IVA del cliente si lo introdujiste.

## Lo que hace el código y lo que no

- Hace: IVA automático (`automatic_tax`), NIF-IVA (`tax_id_collection`), dirección obligatoria (`billing_address_collection`), aceptación de Términos con el texto de desistimiento (`consent_collection` + `custom_text`), idioma del Checkout según el idioma guardado del usuario (`es`, `en`, `zh`; si no lo hay, Stripe lo detecta), y `customer_update[address|name]=auto` solo cuando el usuario ya es cliente de Stripe (con `customer_email` Stripe lo rechaza).
- No hace: configurar la cuenta de Stripe, los registros fiscales, los productos ni el portal. Tampoco emite facturas por su cuenta: las genera Stripe.
