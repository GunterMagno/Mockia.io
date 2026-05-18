# Apartado 3: Instalación y Configuración del Sistema

Este apartado detalla el procedimiento paso a paso para clonar, configurar e instalar Mockia.io de forma local, abarcando tanto entornos contenerizados (Docker) como ejecuciones nativas de desarrollo.

## 3.1 Requisitos del Sistema

Para el correcto funcionamiento del entorno de desarrollo de Mockia.io, es necesario contar con:
- **Node.js:** Versión 20 o superior LTS (se recomienda Node.js 22).
- **npm:** Versión 10 o superior (gestor de dependencias por defecto).
- **Docker Desktop:** Requerido para la contenerización en Windows (incluye Docker Compose v2).
- **MongoDB (Opcional):** Si se desea ejecutar el backend de manera nativa sin Docker, se requiere una instancia local de MongoDB (v7.0+) activa en el puerto 27017.

---

## 3.2 Clonación e Instalación de Dependencias

1. **Clonar el repositorio git:**
   ```bash
   git clone https://github.com/GunterMagno/Mockia.io.git
   cd Mockia.io
   ```

2. **Instalación centralizada de dependencias:**
   El proyecto utiliza **npm workspaces** para gestionar las dependencias del Monorepo en un único lugar, optimizando espacio y garantizando la compatibilidad. Ejecute en la raíz:
   ```bash
   npm install
   ```
   Esto instalará de forma recursiva todas las dependencias en `node_modules` de la raíz y creará los enlaces simbólicos para los paquetes internos (`packages/shared`, `packages/backend`, `packages/frontend`).

---

## 3.3 Configuración de Variables de Entorno

Tanto el backend como el frontend requieren variables de entorno específicas para enlazarse de forma adecuada.

### Backend (`packages/backend/.env`)
Copie el archivo de ejemplo e introduzca sus configuraciones:
```bash
cp packages/backend/.env.example packages/backend/.env
```
Campos del archivo `.env` del backend:
- `NODE_ENV`: Entorno (`development`, `production` o `test`).
- `BACKEND_PORT`: Puerto de escucha del servidor (por defecto `3000`).
- `MONGODB_URI`: Cadena de conexión a MongoDB. Para ejecución local nativa: `mongodb://localhost:27017/mockia`.
- `CORS_ORIGIN`: Origen permitido para CORS. En desarrollo: `http://localhost:5173`.
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`: Claves de encriptación simétrica para firmar los tokens de seguridad JWT de acceso y refresco.
- `OPENROUTER_API_KEY`: API Key para consumir la Inteligencia Artificial de OpenRouter.

### Frontend (`packages/frontend/.env`)
El frontend cuenta con las siguientes variables configuradas automáticamente para Vite:
- `VITE_API_URL`: Prefijo para las llamadas a la API (generalmente `/api`).
- `VITE_BACKEND_URL`: URL base del backend, por defecto `http://localhost:3000`.

---

## 3.4 Despliegue en Entorno de Desarrollo

El Monorepo de Mockia.io está diseñado para simplificar el arranque de desarrollo mediante Docker Compose o de manera nativa.

### Opción A: Levantar con Docker (Recomendado)
Docker Compose compila, configura e instala las dependencias de los servicios automáticamente y los une en una red interna dedicada, levantando también una base de datos aislada.

```bash
# 1. Levantar base de datos, backend y frontend en desarrollo
npm run docker:up

# 2. Comprobar el estado y ver logs del monorepo
npm run docker:logs

# 3. Detener y remover los contenedores
npm run docker:down
```
Acceso a la aplicación:
- **Frontend UI:** [http://localhost:5173](http://localhost:5173)
- **Backend API & Health:** [http://localhost:3000/api/health](http://localhost:3000/api/health)
- **Swagger Docs:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

### Opción B: Ejecución Nativa (Sin Docker)
Si prefiere trabajar directamente sobre los ejecutables locales y tiene un servicio de MongoDB local activo en el puerto 27017:

1. **Compilar el paquete Shared (Obligatorio para que backend/frontend carguen los tipos):**
   ```bash
   npm run build -w @mockia/shared
   ```

2. **Arrancar Backend (en una terminal):**
   ```bash
   cd packages/backend
   npm run dev
   ```

3. **Arrancar Frontend (en otra terminal):**
   ```bash
   cd packages/frontend
   npm run dev
   ```
