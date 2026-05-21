# Apartado 2: Descripción del Proyecto

## 2.1 Descripción General y Arquitectura

**Mockia.io** se define como una plataforma web inteligente y colaborativa para la creación y enrutamiento dinámico de Mock APIs. El sistema se construye bajo una arquitectura de **Single Page Application (SPA)** en el lado del cliente, garantizando una interfaz fluida e interactiva similar a una aplicación de escritorio, y una **API RESTful distribuida** en el backend que actúa tanto de servidor de configuración como de enrutador dinámico absoluto (Mock Router).

La aplicación se ha desarrollado utilizando el célebre y demandado **Stack MERN** (MongoDB, Express, React, Node.js), implementado bajo un enfoque moderno de **Monorepo** con npm workspaces. Esta elección de arquitectura e integración de tecnologías permite el intercambio inmediato de tipados estáticos de TypeScript entre todas las capas, maximizando la robustez y velocidad de desarrollo:

- **M - MongoDB:** Base de datos NoSQL documental perfecta para almacenar esquemas de respuesta JSON y estructuras sumamente dinámicas.
- **E - Express.js:** Framework minimalista para Node.js que permite interceptar peticiones arbitrarias (usando wildcards como `/mock/:projectSlug/*`) para devolver en caliente respuestas simuladas.
- **R - React:** Biblioteca para construir interfaces interactivas en formato SPA con TypeScript y Vite. Apoyado en **Vite-CSS Modules con SCSS** y **React Query**.
- **N - Node.js:** Motor de ejecución asíncrono que da soporte a toda la API del backend.
- **Inteligencia Artificial:** Integración con la API de **OpenRouter** para enviar prompts estructurados y deducir rutas, métodos y respuestas realistas que enriquecen las Mock APIs.

---

## 2.2 Funcionalidades Priorizadas (MoSCoW)

### Must Have (Obligatorio para el MVP)
1. **Gestión de Identidad (Auth):** Registro, login y sesión mediante JWT seguros.
2. **Dashboard de Gestión:** Panel para crear, editar, listar y eliminar proyectos aislados.
3. **Ingesta desde GitHub:** Conexión pública a repositorios para extraer código e interpretarlo con IA.
4. **Motor Mock Router:** Servidor capaz de responder a peticiones dinámicas en URLs estables (`/mock/:projectSlug/users`) devolviendo un JSON realista.
5. **Forzado de Latencia y Errores:** Configurar endpoints para simular latencia de red artificial y errores HTTP (400, 404, 500) para equipos de QA.
6. **Editor Visual:** Panel para visualizar respuestas autogeneradas por la IA y editar sus esquemas JSON.

### Should Have (Muy Importante)
- Sincronización Automática.
- Notificaciones asíncronas del Sistema.

### Could Have (Opcional)
- Autenticación OAuth con GitHub.
- Múltiples respuestas por endpoint (selección por Headers).

---

## 2.3 Interfaz y Experiencia de Usuario (UI/UX)

La plataforma se ha diseñado priorizando la eficiencia y la reducción de la carga cognitiva para desarrolladores. La experiencia de usuario (UX) se basa en flujos de trabajo sin fricciones:
- **Flujo de Trabajo Centralizado:** El núcleo de la aplicación es el *Mock Editor*, el cual presenta un diseño de **triple columna vertical**:
  1. **Árbol de Endpoints (Izquierda):** Navegación rápida con distintivos de color semánticos por método (Verde para POST, Azul para GET).
  2. **Editor JSON (Centro):** Un editor de código integrado en el navegador con resaltado de sintaxis para visualizar y modificar la estructura de datos generada por la IA.
  3. **Inspector (Derecha):** Un panel de configuración en caliente para forzar latencias y códigos de estado con un solo clic.
- **Feedback Constante:** El uso de notificaciones tipo *Toast* y alertas modales (combinadas con ligeros efectos de sonido en caso de error) garantizan que el usuario siempre sepa el estado de sus acciones asíncronas.

---

## 2.4 Casos de Uso Típicos

1. **El Inicio del Sprint (Frontend):** Un desarrollador Frontend importa el repositorio de GitHub donde el equipo Backend acaba de subir las interfaces de TypeScript. En 10 segundos, la IA genera el Mock. El desarrollador copia la URL que le da Mockia y empieza a maquetar la aplicación real con datos creíbles.
2. **Pruebas de Resiliencia (QA):** El tester del equipo selecciona la ruta de "Procesar Pago" en el panel derecho de Mockia y le configura un **Delay de 3000ms** y un **Error 500**. Inmediatamente, se va a la web de la empresa y comprueba si al darle a "Pagar" sale correctamente la animación de carga durante 3 segundos y el mensaje de error adecuado, sin haber tocado la base de datos real.
3. **Caída del Backend o Entornos Inestables o Incompletos (Frontend/Demos):** Durante una presentación a un cliente o en un entorno de desarrollo donde el backend real se ha caído, está en mantenimiento o aún no es funcional, el equipo de Frontend simplemente cambia su variable de entorno `API_URL` para que apunte al servidor de Mockia.io. La aplicación cliente sigue funcionando a la perfección mostrando datos realistas simulados, permitiendo continuar el trabajo o salvar una demostración comercial sin depender de la estabilidad del servidor real.