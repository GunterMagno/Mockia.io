# Apartado 1: Introducción

## 1.1 Identificación de Necesidades y Justificación

En el desarrollo de software moderno, particularmente bajo marcos de trabajo ágiles (Scrum, Kanban), es extremadamente común encontrarse con un desfase temporal entre el equipo de Frontend y el equipo de Backend. Los desarrolladores de interfaces (web o móviles) suelen quedarse bloqueados en las fases iniciales de un sprint debido a la falta de APIs funcionales listas para ser consumidas.

Aunque los contratos de las APIs (definiciones OpenAPI, interfaces TypeScript o controladores básicos) se acuerdan en fases tempranas, la lógica real del servidor y su persistencia en base de datos tardan semanas en ser implementadas y desplegadas. Para evitar este bloqueo, los desarrolladores de Frontend tradicionalmente adoptan soluciones ineficientes:
- **Datos hardcodeados:** Escribir archivos JSON estáticos dentro del código del cliente, que luego deben ser eliminados en producción.
- **Herramientas locales manuales:** Utilizar herramientas como Mockoon o Postman Mocks, que requieren configurar de forma completamente manual cada ruta, método y JSON de respuesta. Esto introduce duplicación de esfuerzos y dificulta el trabajo colaborativo en equipo, al ejecutarse típicamente en local.
- **Desalineación constante:** A medida que la especificación del backend evoluciona, actualizar los mocks locales se convierte en una tarea tediosa y propensa a errores de sincronización.

**Mockia.io** surge para resolver esta problemática de raíz. Su propuesta se basa en combinar la **Inteligencia Artificial** con una arquitectura **Cloud / SaaS** para automatizar por completo la generación y el enrutamiento de Mock APIs. Al proporcionarle el código de un repositorio (rutas parciales, interfaces TypeScript) o documentación técnica, la IA de Mockia deduce la estructura y genera automáticamente las rutas públicas y datos JSON realistas, acelerando el desarrollo en paralelo.

---

## 1.2 Objetivos del Proyecto

El objetivo principal de Mockia.io es proporcionar una plataforma de simulación de APIs inteligente, ágil y colaborativa en la nube. Los objetivos específicos incluyen:
1. **Generación Automatizada sin Fricciones:** Eliminar la configuración manual de rutas mediante el análisis automático de código con IA.
2. **Colaboración en la Nube:** Proveer servidores de mocks dinámicos accesibles mediante URLs públicas estables para que todo el equipo (Frontend, Mobile, QA) trabaje sobre una única fuente de verdad.
3. **Robustez en Pruebas de QA:** Permitir a los equipos de calidad simular latencias de red y forzar códigos de error HTTP específicos (400, 404, 500) en endpoints seleccionados para probar el manejo de excepciones en la interfaz del cliente.
4. **Sincronización en Caliente:** Integrar mecanismos que permitan regenerar y actualizar los mocks a medida que el repositorio de GitHub cambie.

---

## 1.3 Perfil del Usuario Objetivo

Los beneficiarios de Mockia.io se dividen en tres perfiles profesionales clave:
- **Desarrolladores Frontend y Mobile:** Consumirán endpoints realistas y estables desde las fases iniciales del desarrollo del cliente, sin dependencias del progreso del backend.
- **Ingenieros de QA (Quality Assurance):** Podrán forzar fallos de red y probar flujos extremos y de recuperación sin alterar código de base de datos o lógica de negocio real.
- **Arquitectos de Software y Product Owners:** Podrán generar rápidamente prototipos funcionales (sandbox) con datos reales para validación rápida con clientes antes de programar la lógica del backend.
