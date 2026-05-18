# Apartado 2: Descripción del Proyecto

## 2.1 Descripción General y Arquitectura

**Mockia.io** se define como una plataforma web inteligente y colaborativa para la creación y enrutamiento dinámico de Mock APIs. El sistema se construye bajo una arquitectura de **Single Page Application (SPA)** en el lado del cliente, garantizando una interfaz fluida e interactiva similar a una aplicación de escritorio, y una **API RESTful distribuida** en el backend que actúa tanto de servidor de configuración como de enrutador dinámico absoluto (Mock Router).

La aplicación se ha desarrollado utilizando el célebre y demandado **Stack MERN** (MongoDB, Express, React, Node.js), implementado bajo un enfoque moderno de **Monorepo** con npm workspaces. Esta elección de arquitectura e integración de tecnologías permite el intercambio inmediato de tipados estáticos de TypeScript entre todas las capas, maximizando la robustez y velocidad de desarrollo:

- **M - MongoDB (Base de Datos):** Base de datos NoSQL documental perfecta para almacenar esquemas de respuesta JSON y estructuras de endpoints sumamente dinámicos y variables sin las rigideces de un esquema relacional tradicional.
- **E - Express.js (Backend / Framework de Servidor):** Framework minimalista para Node.js que permite interceptar peticiones arbitrarias (usando wildcards de enrutamiento dinámico como `/mock/:projectSlug/*`) para resolver y devolver en caliente las respuestas simuladas configuradas por los usuarios.
- **R - React (Frontend / Interfaz de Usuario):** Biblioteca líder para construir interfaces de usuario interactivas en formato SPA con TypeScript y Vite. Se apoya en **Vite-CSS Modules con SCSS** para un estilado modular y encapsulado, y en **React Query (TanStack Query)** para una comunicación asíncrona avanzada, caché y sincronización.
- **N - Node.js (Entorno de Ejecución Backend):** Motor de ejecución asíncrono basado en JavaScript que da soporte a toda la API del backend, garantizando un alto rendimiento y escalabilidad en la gestión de conexiones y peticiones concurrentes.
- **Inteligencia Artificial (Valor Añadido):** Integración con la API de **OpenRouter** para enviar prompts estructurados y contexto formateado a modelos de lenguaje (LLM), los cuales interpretan el código ingresado por el usuario y deducen las rutas, métodos y respuestas realistas que enriquecen los datos iniciales de las Mock APIs.

---

## 2.2 Funcionalidades Priorizadas (MoSCoW)

Para asegurar la viabilidad del Producto Mínimo Viable (MVP) y su escalado posterior, las funcionalidades se han estructurado utilizando la metodología MoSCoW:

### Must Have (Obligatorio para el MVP)
1. **Gestión de Identidad y Autenticación (Auth):** Registro, inicio de sesión y gestión de sesión mediante JSON Web Tokens (JWT) seguros con tokens de acceso y refresco persistentes.
2. **Dashboard de Gestión:** Panel visual interactivo para crear, editar, listar y eliminar proyectos o espacios de trabajo aislados.
3. **Ingesta Automatizada desde GitHub:** Conexión pública a repositorios de GitHub para extraer archivos de código fuente, interfaces u OpenAPI e interpretarlos automáticamente mediante la IA.
4. **Motor de Enrutamiento Dinámico (Mock Router):** Servidor capaz de responder a peticiones dinámicas en URLs estables (`/mock/:projectSlug/users`) y buscar en MongoDB la respuesta correspondiente para retornar un JSON realista.
5. **Forzado de Latencia y Códigos de Error:** Habilidad de configurar endpoints específicos para retardar la respuesta (latencia de red artificial) y retornar errores HTTP parametrizados (400, 404, 500) para QA.
6. **Editor Visual de Endpoints:** Panel estilo Swagger que permite visualizar las respuestas autogeneradas por la IA y editar manualmente en caliente sus esquemas JSON.

### Should Have (Muy Importante)
- **Sincronización Automática:** Capacidad de "refrescar" el proyecto, volviendo a analizar el repositorio de GitHub si hay commits en la rama asociada para actualizar la estructura de mocks.
- **Notificaciones del Sistema:** Panel de notificaciones asíncronas para alertar al usuario sobre el éxito o fallo en la importación de repositorios o generación de código con IA.

### Could Have (Opcional)
- **Autenticación OAuth con GitHub:** Registro rápido e importación directa de repositorios privados del usuario.
- **Soporte para múltiples respuestas por endpoint:** Retornar datos diferentes según parámetros de query o headers (ej. paginación dinámica).

### Won't Have (Futuro)
- **Generación de código cliente automático (SDKs):** Descarga de clientes TypeScript/Axios listos para consumir las rutas mockeadas.
