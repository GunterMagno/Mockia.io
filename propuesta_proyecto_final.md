# Propuesta de Proyecto Final: Mockia.io
**Generador Inteligente de Mock APIs y Documentación**

**Autor/a:** Alejandro Borrego Cruz  
**Ciclo Formativo:** Desarrollo de Aplicaciones Web (DAW)  
**Módulo:** Proyecto de Desarrollo de Aplicaciones Web

---

## Índice
1. [Identificación de necesidades](#1-identificación-de-necesidades)
2. [Oportunidades de negocio](#2-oportunidades-de-negocio)
3. [Tipo de proyecto](#3-tipo-de-proyecto)
4. [Características específicas](#4-características-específicas)
5. [Obligaciones legales y prevención](#5-obligaciones-legales-y-prevención)
6. [Ayudas y subvenciones](#6-ayudas-y-subvenciones)
7. [Guión de trabajo](#7-guión-de-trabajo)
8. [Referencias](#8-referencias)

---

## 1. Identificación de necesidades

### El Problema
En el desarrollo de software moderno (especialmente bajo metodologías ágiles), es extremadamente común que exista un desajuste de tiempos entre los equipos. El equipo de Frontend suele quedarse bloqueado esperando a que el equipo de Backend desarrolle y despliegue las APIs necesarias para consumir los datos.

### Evidencias y Detección
Durante el periodo de Formación en Centros de Trabajo (FFEOE) y a través de la observación de la industria, se ha detectado que:
* Las definiciones de API (como contratos OpenAPI/Swagger) existen en etapas tempranas, pero no devuelven datos funcionales ni realistas.
* Los desarrolladores de Frontend pierden horas creando archivos JSON estáticos (hardcodeados) que deben modificar constantemente y que no simulan el comportamiento real de un servidor (tiempos de respuesta, errores HTTP 404/500).
* Mantener estos datos falsos actualizados cuando el backend cambia es un proceso manual propenso a errores.

### Usuarios Objetivo y Beneficiarios
* **Desarrolladores Frontend y Mobile:** Podrán trabajar de forma paralela al backend consumiendo una API real.
* **Equipos de QA (Quality Assurance):** Podrán automatizar pruebas y forzar casos límite (errores, latencias).
* **Desarrolladores Full-Stack y Freelancers:** Acelerarán la creación de prototipos funcionales para mostrar a clientes antes de programar la lógica compleja del servidor.

---

## 2. Oportunidades de negocio

### Análisis del Mercado y Competencia
Actualmente, el mercado aborda este problema con varias herramientas, pero presentan limitaciones:
* **Mockoon / Postman:** Son herramientas excelentes, pero obligan a definir cada ruta y cada JSON de respuesta **de forma completamente manual**. Además, Mockoon se ejecuta en local, dificultando que todo un equipo consuma la misma API simulada.
* **JSONPlaceholder / DummyJSON:** Ofrecen APIs públicas gratuitas, pero sus datos son estáticos (solo sirven para probar listas de posts, usuarios ficticios estándar, etc.) y no se adaptan a la lógica de negocio específica de una empresa.

### Propuesta de Valor Diferencial
**Mockia.io** revoluciona este flujo introduciendo **Inteligencia Artificial y Cloud**. El valor diferencial radica en:
1. **Cero Configuración Manual:** Al proporcionarle un repositorio, código parcial o documentación, la IA de Mockia deduce la estructura y genera automáticamente las rutas y datos realistas.
2. **Disponibilidad Inmediata:** Despliega un servidor dinámico accesible mediante una URL pública (ej. `api.mockia.io/...`), facilitando el trabajo colaborativo.

### Potencial y Escalabilidad
El proyecto nace como Open Source para ganar tracción en la comunidad de desarrolladores. Su modelo de negocio futuro es un SaaS (Software as a Service) Freemium, donde los equipos pagarán por espacios de trabajo privados, SLAs de alta disponibilidad y límites de peticiones más altos.

---

## 3. Tipo de proyecto

### Tipo de Aplicación
Mockia.io se desarrollará bajo una arquitectura de **Single Page Application (SPA)** en el lado del cliente y una **API RESTful dinámica** en el lado del servidor.

### Justificación
* **SPA (React.js):** Es la solución ideal para el panel de control (Dashboard). Al ser un entorno donde el usuario interactuará con editores de código JSON, visualizará esquemas y modificará estados en caliente, una SPA ofrece una experiencia fluida de tipo escritorio sin recargas de página.
* **API RESTful (Node.js + Express):** El backend no solo gestiona usuarios, sino que actúa como un *router* dinámico absoluto. Express permite el uso avanzado de wildcards (`/*`) para capturar peticiones arbitrarias e interceptarlas para devolver los Mocks generados.

### Arquitectura Propuesta
Se utilizará una arquitectura Cliente-Servidor separada y contenerizada (Microservicios base):
* **Frontend Service:** Aplicación React (SPA).
* **Core API Service:** Servidor Node.js/Express que gestiona la lógica de negocio, la base de datos (MongoDB) y la comunicación con la IA (OpenRouter).
* **Mock Router Service:** El subsistema encargado de interceptar peticiones hacia los endpoints simulados y devolver el JSON almacenado.

---

## 4. Características específicas

Se utilizará el método MoSCoW para priorizar las funcionalidades y definir un Producto Mínimo Viable (MVP) realista y alcanzable.

### Funcionalidades (MVP - Obligatorias)
1. **Gestión de Identidad (Auth):** Registro, login y gestión de sesión mediante JWT.
2. **Gestión de Proyectos/APIs:** Creación, edición y borrado de espacios de trabajo para alojar diferentes mocks.
3. **Ingesta Automatizada desde GitHub e IA:** El usuario proporciona la URL de un repositorio de GitHub y el sistema extrae automáticamente la estructura relevante (interfaces, controladores o documentación). Este contexto se procesa y envía al LLM mediante OpenRouter para generar las rutas y los esquemas JSON realistas de forma automatizada.
4. **Motor de Enrutamiento Dinámico:** Capacidad del servidor de recibir peticiones en URLs dinámicas (ej. `/mock/proyecto-id/users`), buscar la respuesta en la BBDD y devolverla con el formato adecuado.
5. **Simulación y Forzado de Estados:** El sistema permitirá al usuario configurar endpoints específicos para simular latencia de red (retrasos en la respuesta) o forzar códigos de error HTTP (ej. 400, 404, 500) para probar casos límite en el desarrollo frontend.
6. **Dashboard de Edición:** Interfaz gráfica para visualizar los endpoints generados y modificar manualmente el JSON y los estados devueltos por la IA si fuera necesario.

### Funcionalidades (Opcionales / Escalado futuro)
* Sincronización automática (vía Webhooks o cronjobs) para actualizar los Mocks si el código del repositorio original en GitHub cambia.
* Soporte para repositorios privados de GitHub mediante autenticación OAuth.
* Soporte para ingesta manual avanzada (subida de archivos Swagger/OpenAPI o pegado de texto en bruto).

### Requisitos Técnicos (Stack)
* **Frontend:** React.js, SCSS, React Query (gestión de estado de peticiones), Axios.
* **Backend:** Node.js, Express.js. Integración con la API de GitHub o scripts de clonado parcial para extraer el contexto.
* **Base de Datos:** MongoDB (ideal por la naturaleza NoSQL y la necesidad de guardar esquemas JSON flexibles y variados).
* **Inteligencia Artificial:** OpenRouter API (modelos LLM).
* **DevOps/Despliegue:** Docker, Docker Compose, GitHub Actions (CI/CD).

---

## 5. Obligaciones legales y prevención

El proyecto cumplirá con el marco normativo europeo y español aplicable al desarrollo web y servicios digitales:

### Normativa de Protección de Datos (RGPD y LOPDGDD)
* Se requerirá el consentimiento expreso para la recopilación de datos de registro (email, nombre).
* Los tokens de acceso a repositorios privados (si se implementan) se encriptarán en la base de datos de MongoDB.
* Se habilitarán mecanismos para que el usuario ejerza sus derechos ARCO (Acceso, Rectificación, Cancelación y Oposición).

### LSSI-CE (Ley de Servicios de la Sociedad de la Información)
* Al ser un servicio susceptible de monetización futura, la web incluirá un Aviso Legal, Política de Privacidad, Términos del Servicio y banner de consentimiento de Cookies (necesario para el uso de JWT/Sesiones locales).

### Medidas de Seguridad
* **Autenticación:** Uso de JSON Web Tokens (JWT) con tiempos de expiración y almacenamiento seguro.
* **Rate Limiting:** Al tener un servicio de Mocks público y consumir APIs de pago (OpenRouter), es crítico implementar limitación de peticiones por IP y usuario para prevenir ataques de denegación de servicio (DDoS) y abusos de consumo.
* **Sanitización:** Prevención contra inyecciones NoSQL y XSS en los inputs del usuario.

### Accesibilidad (WCAG)
* El diseño de la interfaz (Figma) contemplará un contraste de colores adecuado, etiquetas ARIA en los editores de código y navegación accesible por teclado, apuntando al nivel de conformidad AA de la W3C.

---

## 6. Ayudas y subvenciones

El ecosistema tecnológico en España y Europa ofrece múltiples vías para la viabilidad financiera del proyecto si decidiera constituirse como empresa:

### Ayudas Gubernamentales e Institucionales
1. **ENISA Jóvenes Emprendedores:** Financiación mediante préstamos participativos dirigida a PYMES innovadoras impulsadas por menores de 40 años, ideal para un SaaS tecnológico.
2. **Programa Neotec (CDTI):** Subvenciones para nuevos proyectos empresariales que requieran el uso de tecnologías o conocimientos desarrollados a partir de la actividad investigadora (uso de modelos LLM aplicados).
3. **Kit Digital:** Aunque Mockia es un producto, como empresa desarrolladora podríamos certificarnos como "Agente Digitalizador" y ofrecer la integración de Mockia como servicio de desarrollo subvencionado para otras empresas españolas.

### Recursos Gratuitos y Bajo Coste (Bootstraping)
Para la fase de desarrollo y despliegue inicial en el ciclo formativo, se utilizarán recursos que reduzcan los costes a cero:
* **GitHub Student Developer Pack:** Acceso a repositorios pro y herramientas CI/CD gratuitas.
* **Hosting Freemium:** Despliegue del Frontend en Vercel o Netlify, y el Backend en Render o Fly.io.
* **Base de Datos:** MongoDB Atlas (Free Tier de 512MB, suficiente para el MVP).
* **IA:** Se utilizará OpenRouter seleccionando modelos Open Source de bajo coste (o gratuitos) para las pruebas de generación de contexto.

---

## 7. Guión de trabajo

El proyecto se gestionará bajo la metodología ágil **Scrum** adaptada a un solo desarrollador. Se utilizará **GitHub Projects (Kanban)** para la gestión de tareas y **Toggl Track** para el control del tiempo. El desarrollo está planificado para una duración aproximada de 10 semanas, culminando con la defensa del proyecto.

### Cronograma General e Hitos

* **Fase 1: Planificación y Diseño (Semanas 1-2)**
  * Creación de repositorios y configuración de contenedores (Docker).
  * Diseño de wireframes y UI/UX en Figma, contemplando el dashboard del editor.
  * Modelado de la base de datos MongoDB (esquemas dinámicos para guardar los mocks).
  * *Hito 1: Prototipo visual aprobado, arquitectura definida y entorno de desarrollo levantado.*

* **Fase 2: Core Backend y Autenticación (Semanas 3-4)**
  * Desarrollo del sistema de registro y login seguro (JWT).
  * Creación de la API CRUD para la gestión de Espacios de Trabajo y Proyectos.
  * *Hito 2: El usuario es capaz de registrarse, iniciar sesión y crear la estructura base de su proyecto.*

* **Fase 3: Ingesta de GitHub e Integración IA (Semanas 5-6)**
  * Implementación del servicio de lectura de repositorios (vía API de GitHub o clonado parcial) para extraer el contexto (interfaces, rutas).
  * Integración con la API de OpenRouter: envío de *prompts* estructurados y procesamiento de la respuesta LLM.
  * *Hito 3: El sistema puede recibir una URL de GitHub, analizar el código y generar automáticamente una estructura de API simulada en la base de datos.*

* **Fase 4: Motor de Enrutamiento Dinámico y Frontend (Semanas 7-8)**
  * Programación del "Mock Router" en Express usando *wildcards* (`/*`) para interceptar peticiones dinámicas.
  * Implementación de la lógica de **forzado de estados (errores HTTP) y simulación de latencia**.
  * Desarrollo del Dashboard de React (Peticiones con React Query, visualización y edición manual del JSON generado).
  * *Hito 4: MVP Funcional. La aplicación permite generar la API desde GitHub, editarla, forzar errores y ser consumida desde herramientas externas (Postman/Frontend local).*

* **Fase 5: Despliegue, Pruebas y Documentación (Semanas 9-10)**
  * Configuración de *pipelines* en GitHub Actions (CI/CD) para automatizar los pases a producción.
  * Despliegue de los servicios (Frontend, Backend y BBDD) en la nube.
  * Pruebas finales (QA) y redacción de la memoria del proyecto.
  * *Hito 5: Proyecto finalizado, online y listo para la defensa ante el tribunal.*

---

## 8. Referencias

* **Normativa Web:** Guía de la Agencia Española de Protección de Datos (AEPD) para desarrolladores.
* **Accesibilidad:** Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1.
* **Documentación Técnica:**
  * [React.js Oficial Docs](https://react.dev/)
  * [Express.js Routing](https://expressjs.com/en/guide/routing.html)
  * [OpenRouter API Documentation](https://openrouter.ai/docs)
* **Análisis de Competencia:** Mockoon (mockoon.com), Stoplight (stoplight.io).
