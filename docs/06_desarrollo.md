# Apartado 6: Desarrollo y Arquitectura del Backend (DWES)

Este apartado analiza detalladamente la implementación técnica de la lógica de servidor, abordando el patrón MVC limpio de desarrollo, la autenticación por JWT, el motor dinámico de enrutamiento (Mock Router) y la integración de prompts con Inteligencia Artificial.

## 6.1 Arquitectura MVC e Implementación Limpia

El backend está diseñado bajo principios de **arquitectura de tres capas (MVC modificado)** para garantizar la modularidad y separación estricta de responsabilidades, facilitando la escalabilidad del sistema:

1. **Rutas (Routing Layer):** Mapean los endpoints de la API, configuran los middlewares y delegan la ejecución al controlador correspondiente.
2. **Controladores (Interface Layer):** Actúan como delgados receptores de peticiones HTTP. Validan la entrada (mediante Joi), manejan el flujo básico de negocio, capturan errores con `asyncHandler` y devuelven respuestas HTTP. *No interactúan directamente con la base de datos ni contienen lógica compleja.*
3. **Servicios (Business Logic Layer):** Capa donde reside toda la lógica de negocio y las consultas complejas de base de datos (Mongoose/MongoDB). Los servicios son reutilizables y desacoplados del protocolo HTTP (facilitando su prueba unitaria).
4. **Modelos (DataAccess Layer):** Esquemas de Mongoose que interactúan directamente con las colecciones de MongoDB y definen sus tipos TypeScript.

---

## 6.2 Gestión de Identidad y Seguridad (JWT)

La autenticación de usuarios se implementa de manera robusta y sin estado utilizando **JSON Web Tokens (JWT)**:

- **Tokens de Acceso (Access Tokens):** Firmados mediante `JWT_ACCESS_SECRET`. Tienen un tiempo de vida corto (1 hora) y deben enviarse en la cabecera `Authorization: Bearer <token>` para proteger las rutas privadas.
- **Tokens de Refresco (Refresh Tokens):** Almacenados en la base de datos de forma encriptada y firmados mediante `JWT_REFRESH_SECRET` con un vencimiento de 7 días. Se utilizan para regenerar tokens de acceso caducados de forma transparente para el usuario.
- **Cifrado de Contraseñas:** Se utiliza **bcrypt** con un factor de sal de 10 para encriptar y verificar las claves de usuario de forma segura.

### Control de Acceso basado en Roles (RBAC)
Para proteger la integridad de los espacios de trabajo, se define el middleware `authorizeRole.ts` que intercepta las llamadas basándose en el rol del usuario para el proyecto específico (`OWNER`, `EDITOR`, `VIEWER`):
- `OWNER`: Permiso total de lectura, edición, invitación de miembros y borrado/archivado de proyectos.
- `EDITOR`: Permiso de lectura y edición de endpoints de mock. Puede invitar colaboradores y eliminar otros miembros (excepto al `OWNER`), pero no puede borrar ni archivar el proyecto.
- `VIEWER`: Permiso de solo lectura sobre la estructura de endpoints y visualización en el dashboard.

---

## 6.3 Motor de Enrutamiento Dinámico (Mock Router)

Una de las joyas arquitectónicas de Mockia.io es el **Mock Router**. Mientras que otros servidores de mocks requieren definir rutas estáticas en código, Mockia captura peticiones de forma dinámica absoluta utilizando el enrutador wildcard de Express.

### Mecanismo de Intercepción:
En `index.ts`:
```typescript
app.all('/mock/:projectSlug/*', catchAllMockRouter);
```
1. El middleware captura cualquier verbo HTTP (GET, POST, PUT, DELETE, PATCH) en cualquier ruta que comience por `/mock/:projectSlug/`.
2. Extrae el `projectSlug` y localiza el proyecto correspondiente en MongoDB cargando sus índices únicos optimizados.
3. Analiza el path dinámico solicitado (ej: `/users/profile`) y compara mediante expresiones regulares avanzadas si existe un endpoint que coincida con el método y path en la colección de `Endpoint`.
4. Si hay una coincidencia:
   - Carga la configuración del endpoint en `EndpointConfig`.
   - Si tiene configurado un retardo artificial (`delay_ms`), detiene la respuesta usando un temporizador asíncrono para simular latencia de red.
   - Si tiene un código de estado forzado (`force_status_code`), retorna ese código HTTP.
   - Devuelve la respuesta mockeada (`override_response` o el JSON schema autogenerado de la colección `Response`).
5. Si no coincide, retorna un error HTTP 404 semántico con el formato estándar de Mockia.

---

## 6.4 Ingesta de GitHub e Integración de IA con OpenRouter

La funcionalidad central de autogeneración inteligente se gestiona mediante un flujo estructurado:

1. **Ingesta de Código (GitHub Service):** Lee el repositorio indicado de forma superficial (clonado parcial o llamadas a la API de GitHub) y extrae las firmas relevantes (interfaces TypeScript, esquemas de bases de datos, definiciones Swagger/OpenAPI o controladores).
2. **Formateo de Contexto:** El servicio comprime y formatea el código extraído para reducir consumo de tokens de contexto, estructurándolo en un objeto estructurado `GitHubContext`.
3. **Prompt Engineering (AI Service):** Envía un prompt del sistema altamente guiado a **OpenRouter** para forzar al modelo de lenguaje (ej: `meta-llama/llama-3-8b-instruct`) a responder en un formato JSON estrictamente alineado con la especificación interna de Mockia.
4. **Pipeline de Procesamiento:** El pipeline asíncrono valida sintácticamente el JSON devuelto por la IA, crea el documento `MockAPI` e inserta recursivamente todas las rutas (`Endpoint`) y datos realistas de muestra (`Response`) en la base de datos MongoDB.
