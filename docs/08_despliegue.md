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