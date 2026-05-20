# Apartado 8: Despliegue, Infraestructura y CI/CD

Este apartado describe la arquitectura de despliegue de Mockia.io en entornos de producción, analizando la dockerización, la configuración del proxy inverso (Nginx), la integración continua (GitHub Actions) y las pautas para asegurar el entorno bajo HTTPS/SSL.

## 8.1 Dockerización del Entorno (Desarrollo vs Producción)

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

## 8.2 Configuración del Servidor Web y Proxy Inverso (Nginx)

Se utiliza **Nginx** como único punto de entrada de tráfico web de producción, actuando como servidor estático de la SPA y como proxy inverso inteligente para redirigir las peticiones dinámicas.

### Archivo de Configuración `nginx`.conf:
1. **Rutas Estáticas (`location /`):** Sirve los archivos CSS, JS e HTML compilados del frontend en `/usr/share/nginx/html`. Habilita `try_files` para redirigir peticiones de rutas inexistentes a `index.html`, permitiendo que el enrutador de React (Client-side routing) resuelva las vistas de la SPA de forma nativa.
2. **Rutas de API Backend (`location /api/`):** Redirige el tráfico a `http://backend:3000/api/` gestionando las cabeceras del protocolo (Upgrade, Connection) para soportar flujos asíncronos y mantener el puerto del host limpio.
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

## 8.3 Integración y Despliegue Continuo (CI/CD)

El Monorepo integra un flujo de integración continua mediante **GitHub Actions** en el archivo `.github/workflows/ci.yml`:

- **Eventos Disparadores:** Se ejecuta automáticamente en cada `push` o `pull request` apuntando a las ramas principales (`main` o `develop`).
- **Validación Automatizada (Lint & Format Check):** Inspecciona el cumplimiento de guías de estilo de código mediante Prettier y ESLint de forma paralela en backend y frontend.
- **Verificación de Tipos TypeScript:** Compila de forma secuencial y estricta el monorepo empezando por el paquete `@mockia/shared` y continuando con `@mockia/backend` y `@mockia/frontend` para garantizar la consistencia estática de los contratos e interfaces de datos compartidos.
- **Ejecución de Pruebas Automatizadas:** Levanta un servicio temporal contenerizado de MongoDB en las máquinas virtuales de GitHub, compila el backend y ejecuta la batería completa de pruebas unitarias y de integración de endpoints (con cobertura).
