# Apartado 8: Despliegue, Infraestructura y CI/CD

Este apartado describe la arquitectura de despliegue de Mockia.io en entornos de producción, analizando la dockerización, la configuración del proxy inverso (Nginx), la integración continua (GitHub Actions) y las pautas para asegurar el entorno bajo HTTPS/SSL.

## 8.1 URL de la Aplicación en Producción

El proyecto se encuentra totalmente operativo y accesible a través de Internet en las siguientes direcciones:
- **Frontend SPA (Aplicación Web):** [https://mockia-frontend.onrender.com](https://mockia-frontend.onrender.com)
- **Backend API Base URL:** [https://mockia-backend.onrender.com/api](https://mockia-backend.onrender.com/api)
- **Servidor Dinámico (Mock Router):** `https://mockia-backend.onrender.com/mock/:slug/*`

---

## 8.2 Entorno de Despliegue (PaaS: Render)

Para el paso a producción se ha seleccionado la plataforma en la nube **Render** por su soporte nativo de contenedores Docker y sitios estáticos. El despliegue se orquesta mediante el archivo IaC (Infrastructure as Code) `render.yaml` presente en la raíz del repositorio, el cual levanta dos servicios:

1. **Web Service (Backend):** Render lee el `Dockerfile.prod` del backend, compila TypeScript, expone el puerto interno e inyecta las variables de entorno de producción (Tokens, Base de Datos, API Keys).
2. **Static Site (Frontend):** Render ejecuta el comando de *build* (`npm run build:frontend`) y sirve los archivos HTML/JS resultantes a través de un CDN ultrarrápido (Content Delivery Network), gestionando los certificados SSL/HTTPS de forma automática.
3. **Base de Datos (Database):** El clúster principal de datos NoSQL se aloja de forma externa y segura en **MongoDB Atlas**.

---

## 8.3 Dockerización del Entorno (Desarrollo vs Producción)
Mockia.io está diseñado para ser totalmente reproducible y portable mediante contenedores de **Docker**. El proyecto se separa en dos configuraciones independientes:

### Entorno de Desarrollo (`docker-compose.yml`)
Configurado para acelerar la programación mediante montajes de volúmenes de desarrollo (`bind mounts`) en el backend y frontend. Esto permite que cualquier cambio de código en local refresque automáticamente los servicios internos sin necesidad de reconstruir las imágenes. Levanta:
- Contenedor MongoDB local (`mockia-mongo`) con persistencia en volumen `mongo_data`.
- Contenedor Backend (`mockia-backend`) levantado con `npm run dev` en puerto 3000.
- Contenedor Frontend (`mockia-frontend`) levantado para refrescarse automaticamente en puerto 5173.

### Entorno de Producción (`docker-compose.prod.yml`)
Optimizado para rendimiento, seguridad y empaquetamiento estático:
- **Exposición Protegida:** El backend expone internamente el puerto 3000 pero no lo publica en el host, previniendo llamadas directas y forzando que todo el tráfico transite por Nginx.
- **Frontend Compilado:** El frontend se compila a estático (`npm run build`) mediante una compilación multi-etapa (multi-stage build) y se inyecta directamente dentro de un contenedor Nginx optimizado, reduciendo al máximo el tamaño de la imagen y aumentando el rendimiento.
- **Redes Bridge Propias:** Aislamiento absoluto de red interna a través de `mockia-network-prod`.

---

### Correo transaccional (verificación y recuperación de contraseña)

El backend envía dos correos: el enlace de **verificación de email** (24 h) y el de **recuperar contraseña** (30 min). Se envían con `nodemailer` por SMTP, configurado con tres variables:

| Variable | Valor |
|---|---|
| `SMTP_URL` | URL del servidor SMTP, p. ej. `smtp://resend:<API_KEY>@smtp.resend.com:465` (Resend) o `smtp://<login>:<clave SMTP>@smtp-relay.brevo.com:587` (Brevo) |
| `MAIL_FROM` | Remitente, p. ej. `Mockia.io <no-reply@tudominio.com>`; debe ser una dirección de un dominio verificado en el proveedor |
| `APP_URL` | URL pública de la aplicación: los enlaces del correo son `${APP_URL}/reset-password?token=...` y `${APP_URL}/verify-email?token=...` |

**Proveedor recomendado:** Resend o Brevo; ambos tienen plan gratuito suficiente para el volumen de un proyecto de este tamaño. Pasos (manuales, no automatizables desde el repositorio):

1. Crear la cuenta en el proveedor y **verificar el dominio** del remitente.
2. Publicar en el DNS del dominio los registros que indica el proveedor: **SPF** (`TXT`) y **DKIM** (`TXT`/`CNAME`). Sin ellos los correos acaban en spam o son rechazados; conviene añadir también un registro **DMARC** (`_dmarc`, `v=DMARC1; p=none; rua=mailto:...`) y endurecerlo cuando los informes salgan limpios.
3. Crear una clave de API/SMTP con permiso solo de envío y guardarla en `SMTP_URL` (nunca en el repositorio).
4. Probar el flujo completo: registrarse, recibir el correo de verificación, pedir "¿Olvidaste tu contraseña?".

Sin `SMTP_URL`: en desarrollo el enlace se imprime en la consola del backend; en producción se registra un error y **no se envía nada** (la petición sigue respondiendo igual para no revelar qué correos existen), así que los usuarios no podrían verificarse ni recuperar la contraseña. El backend avisa de ello al arrancar.

**Verificación obligatoria.** La generación con IA y el checkout/portal de facturación exigen el correo verificado (`403` con código `EMAIL_NOT_VERIFIED`) cuando `REQUIRE_EMAIL_VERIFICATION=true`; sin definir, solo se exige en `NODE_ENV=production`. **Antes de activarlo en una base de datos con usuarios existentes** hay que ejecutar una vez `npm run backfill:email-verified -w @mockia/backend` (con `MONGODB_URI` apuntando a esa base), que marca como verificadas las cuentas anteriores; es idempotente.

---

### Derechos RGPD: exportar y borrar la cuenta

Desde **Ajustes de la cuenta > Mis datos** (modal de perfil) cada usuario puede descargar sus datos (`GET /api/users/me/export`) y eliminar su cuenta (`DELETE /api/users/me`, pide el correo exacto y la contraseña). Notas de operación:

- **Orden del borrado** (`modules/users/gdpr.ts`): contraseña, cancelación inmediata de la suscripción en Stripe, proyectos con todo su contenido (`deleteProjectsCascade`), pertenencias a proyectos ajenos, notificaciones, contadores de uso, sesiones, tokens de correo y, al final, el usuario. Si Stripe falla (`502`) o no está configurado teniendo el usuario una suscripción (`409`), **no se borra nada**: el usuario puede reintentarlo.
- **Stripe conserva el cliente** (`stripeCustomerId`) y sus facturas: es una obligación fiscal y Stripe es responsable de esa conservación. Mockia no llama a la API para borrar el cliente. La Política de Privacidad lo indica.
- **Copias de seguridad**: si el proveedor de base de datos hace copias, los datos borrados desaparecen de ellas al rotar según su política de retención; documéntalo en el registro de tratamientos.
- **Aviso de cookies**: `CookieBanner` es informativo (solo hay almacenamiento estrictamente necesario). Si algún día se añade analítica o publicidad hay que sustituirlo por un banner de consentimiento previo con «Aceptar» y «Rechazar» de igual peso y actualizar la Política de Cookies.

---

### IA: modelo propio con reserva automática (OpenRouter)

El backend habla con los modelos a través de una interfaz de proveedor (`modules/ai/providers`). `AI_PROVIDERS` lista los proveedores por orden de preferencia: `openrouter` (por defecto, sin cambios) o `local,openrouter` para probar primero un modelo de código abierto en tu propio servidor (Ollama, vLLM o llama.cpp: cualquier servidor que exponga `POST /v1/chat/completions`) y caer a OpenRouter si el local está parado, tarda o responde algo inservible (timeout, conexión rechazada, 4xx/5xx, sobre JSON inválido, contenido vacío). Un nombre desconocido se ignora con un aviso al arrancar; una lista sin ningún proveedor válido impide arrancar.

- `AI_LOCAL_BASE_URL`: raíz del servidor **sin `/v1`** (p. ej. `http://llm:11434`); obligatoria en producción si `AI_PROVIDERS` incluye `local` y debe ser `http(s)://`. `AI_LOCAL_MODEL` (por defecto `qwen2.5-coder:7b-instruct`), `AI_LOCAL_TIMEOUT_MS` (120000: la primera carga del modelo es lenta) y `AI_LOCAL_API_KEY` (solo si el servidor exige clave).
- **Cortacircuitos**: tras 3 fallos seguidos el proveedor local se salta durante 60 s (sin esperar el timeout en cada petición) y después se deja pasar una sola petición de prueba. Constantes en `providers/index.ts`.
- **Plazo total**: `AI_TOTAL_TIMEOUT_MS` (240000 por defecto) es el presupuesto de UNA petición de IA sumando modelo local, reserva y reintentos; se reparte como señal de cancelación, de modo que cada llamada termina en el menor de su propio timeout y lo que queda del presupuesto. Al agotarse, la petición acaba con `504` (`EXTERNAL_SERVICE_ERROR`) sin seguir. **Debe quedar por debajo del `proxy_read_timeout` de nginx para `/api/ai/` (300 s en `nginx.conf`)**; el peor caso de una cadena `local,openrouter` es `AI_LOCAL_TIMEOUT_MS` + hasta 3 intentos de 30 s de OpenRouter con espera entre ellos, acotado por ese plazo. Si pones otro proxy delante (Render, balanceadores), súbele también su timeout de lectura por encima de 240 s o baja `AI_TOTAL_TIMEOUT_MS` y `AI_LOCAL_TIMEOUT_MS`.
- **Salida estructurada**: la generación de endpoints (`generate-mock-api-spec` y `generate-and-save`) envía el esquema JSON de la especificación (`modules/ai/outputSchema.ts`, equivalente al validador de producción) para que el servidor local (Ollama, vLLM) limite la decodificación a ese formato. A OpenRouter se le degrada a `json_object` porque no todos sus modelos admiten `json_schema` estricto (los que no, responden 400); pon `OPENROUTER_JSON_SCHEMA=1` solo si `OPENROUTER_MODEL` lo soporta.
- **Banco de evaluación**: antes de poner un modelo local como principal, mídelo con `npm run eval -w @mockia/backend` (casos, métricas y criterio de aceptación en `packages/backend/evals/README.md`).
- **Límite por usuario**: `AI_RATE_PER_MINUTE` (20 por defecto) llamadas de IA por usuario y minuto, contadas en Mongo (colección `airatewindows`, con índice TTL), válido entre reinicios e instancias; al superarlo, `429` con `Retry-After`.
- **Permisos**: `generate-mock-api-spec` (solo lectura) exige ser miembro del proyecto (propietario, editor o lector) y `generate-and-save` (guarda endpoints) propietario o editor; sin pertenencia, `403`, y no se construye el prompt ni se llama a ningún modelo.
- Los registros del servidor indican qué proveedor respondió y el tipo de fallo (código HTTP o clase de error); nunca el prompt, el contenido del repositorio, la respuesta ni las claves.

---

## 8.4 Configuración del Servidor Web y Proxy Inverso (Nginx)

Se utiliza **Nginx** como único punto de entrada de tráfico web de producción, actuando como servidor estático de la SPA y como proxy inverso inteligente para redirigir las peticiones dinámicas.

### Archivo de Configuración `nginx`.conf:
1. **Rutas Estáticas (`location /`):** Sirve los archivos CSS, JS e HTML compilados del frontend en `/usr/share/nginx/html`. Habilita `try_files` para redirigir peticiones de rutas inexistentes a `index.html`, permitiendo que el enrutador de React (Client-side routing) resuelva las vistas de la SPA de forma nativa.
2. **Rutas de API Backend (`location /api/`):** Redirige el tráfico a `http://backend:3000/api/` gestionando las cabeceras del protocolo (Upgrade, Connection) para soportar flujos asíncronos y mantener el puerto del host limpio.
   Nginx reenvía las cabeceras de respuesta sin tocarlas, `Set-Cookie` incluida, y como API y SPA salen por el mismo origen la cookie `mockia_rt` (`Path=/api/auth`) llega al backend sin configuración adicional. **Producción debe servir la SPA y `/api` bajo un único origen**: con `SameSite=Lax` (por defecto, variable `COOKIE_SAMESITE`) el navegador no envía la cookie entre sitios distintos; por eso `render.yaml` reescribe `/api/*` hacia el backend en lugar de apuntar el frontend a otro dominio `onrender.com`. La cookie es `Secure` en producción: detrás de HTTP plano (que no sea `localhost`) el navegador la descarta y no habría sesión.
3. **Rutas de Mock Router (`location /mock/`):** Proxy inverso que canaliza el tráfico de clientes externos que consumen sus APIs simuladas a `http://backend:3000/mock/`.

### Seguridad e Habilitación de HTTPS (SSL/TLS)
En servidores de producción expuestos a Internet (como VPS o instancias EC2), se debe sustituir la configuración HTTP básica del puerto 80 por una escucha segura en el puerto 443 con certificados SSL de **Let's Encrypt**:
```nginx
server {
    listen 443 ssl;
    server_name api.mockia.io;

    ssl_certificate /etc/letsencrypt/live/mockia.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mockia.io/privkey.pem;

    location / {
        proxy_pass http://frontend:80;
    }
}
```
*(En plataformas PaaS modernas como Render o Vercel, la terminación SSL se gestiona automáticamente en el borde/Edge CDN, por lo que la configuración simple en HTTP expuesta en `docker-compose.prod.yml` es ideal para acoplarse directamente).*

---

## 8.5 Integración y Despliegue Continuo (CI/CD)

El Monorepo integra un flujo de integración continua mediante **GitHub Actions** en el archivo `.github/workflows/ci.yml`:

- **Eventos Disparadores:** Se ejecuta automáticamente en cada `push` o `pull request` apuntando a las ramas principales (`main` o `develop`).
- **Validación Automatizada (Lint & Format Check):** Inspecciona el cumplimiento de guías de estilo de código mediante Prettier y ESLint de forma paralela en backend y frontend.
- **Verificación de Tipos TypeScript:** Compila de forma secuencial y estricta el monorepo empezando por el paquete `@mockia/shared` y continuando con `@mockia/backend` y `@mockia/frontend` para garantizar la consistencia estática de los contratos e interfaces de datos compartidos.
- **Ejecución de Pruebas Automatizadas:** Levanta un servicio temporal contenerizado de MongoDB en las máquinas virtuales de GitHub, compila el backend y ejecuta la batería completa de pruebas unitarias y de integración de endpoints (con cobertura).