# Propuesta Resumida Proyecto 2ºDAW
## Proyecto de Desarrollo de Aplicaciones Web

## Título

**Mockia.io Generador Inteligente de Mock APIs y Documentación**

## Objetivo/Justificación

El desarrollo de software moderno a menudo se enfrenta a un bloqueo en la etapa de integración: el equipo de Frontend necesita consumir APIs que el equipo de Backend aún está definiendo o implementando. Aunque existen definiciones iniciales (interfaces TypeScript, contratos OpenAPI/Swagger o controladores básicos), la lógica funcional tarda en llegar.

Herramientas tradicionales como Mockoon resuelven esto de manera local y manual, obligando a definir cada respuesta a mano. Mockia.io evoluciona este concepto hacia una solución Cloud y Open Source. Su objetivo es automatizar la creación de servidores simulados (Mocks) analizando la estructura del proyecto (ya sea código parcial o documentación) mediante Inteligencia Artificial. Esto permite a los equipos disponer de una API pública y funcional en segundos, basada en el estado actual del repositorio, facilitando el desarrollo paralelo y la colaboración.

## Tecnología y Herramientas

El proyecto se desarrollará utilizando el stack MERN junto con tecnologías de IA y DevOps:

- **Frontend:** React.js (SPA), SCSS (diseño), React Query (gestión de estado).
- **Backend:** Node.js con Express. Se utilizará manejo avanzado de rutas dinámicas (wildcards) y streams.
- **Base de Datos:** MongoDB. Ideal para almacenar esquemas de respuesta JSON flexibles y dinámicos.
- **Inteligencia Artificial:** Integración con la API de OpenRouter (acceso a modelos LLM) para interpretar la estructura del codigo y generar datos realistas.
- **DevOps y Despliegue:** Docker y Docker Compose para la contenerización y GitHub Actions para CI/CD.
- **Diseño:** Figma para el prototipado previo.
- **Automatización de Contexto:** Integración en el servidor con herramientas de extracción de contexto (como Gitingest o scripts propios) para procesar repositorios de GitHub automáticamente.

## Descripción

Mockia.io se plantea como una plataforma web Open Source que actúa como un servidor de mocks inteligente y colaborativo en la nube. Sus funcionalidades principales son:

1. **Gestión de Usuarios y Proyectos:** Sistema de registro y autenticación (JWT) que permite a los usuarios crear espacios de trabajo aislados, guardar sus configuraciones y gestionar múltiples APIs simuladas de forma persistente.

2. **Ingesta Automatizada de Contexto:** El sistema abstrae la complejidad de la extracción de datos. El usuario introduce la URL de su repositorio o sube un archivo de documentación y la aplicación, mediante un servicio interno, extrae la estructura relevante (rutas, interfaces, modelos) automáticamente, eliminando la necesidad de copiar y pegar código manualmente (como ocurre con Gitingest).

3. **Generación de Mocks vía OpenRouter:** Integración con la API de OpenRouter para analizar las definiciones extraídas. El sistema no solo crea la ruta, sino que genera respuestas JSON con datos realistas basados en los tipos de datos detectados (ej: nombres reales para campos string, fechas válidas, etc.).

4. **Servidor Cloud Dinámico (vs Local):** A diferencia de soluciones de escritorio como Mockoon, Mockia despliega endpoints públicos accesibles inmediatamente vía URL (ej: api.mockia.io/v1/proyecto-id/users). Esto permite compartir el mock con todo el equipo.

5. **Dashboard y Edición en Caliente:** Interfaz visual (estilo Swagger) que documenta los endpoints activos. Incluye un editor de código integrado que permite modificar manualmente el JSON generado por la IA, forzar estados HTTP (404, 500) o simular latencia para probar casos borde en el frontend.

6. **Sincronización de Cambios:** Funcionalidad para "refrescar" el proyecto: si la definición del backend cambia en el repositorio origen, Mockia actualiza los mocks automáticamente, manteniendo el entorno de pruebas alineado con el desarrollo real.
