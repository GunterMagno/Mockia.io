# Apartado 9: Manual de Usuario de la Aplicación

Este manual describe el flujo de trabajo y la experiencia de usuario (UX) en Mockia.io, guiando paso a paso sobre cómo registrarse, gestionar proyectos, autogenerar APIs simuladas con IA y configurarlas en el editor.

## 9.1 Acceso y Gestión de Identidad (Auth)

1. **Registro (Sign Up):** 
   - Navegue a la página de registro.
   - Ingrese su nombre de usuario, correo electrónico y contraseña.
   - El sistema validará la seguridad de su contraseña e inputs (en caso de error, emitirá alertas visuales y sonoras discretas de guía).
   - Presione **Create Account**. El sistema iniciará sesión automáticamente.
2. **Inicio de Sesión (Log In):**
   - Introduzca sus credenciales registradas.
   - Marque **Remember me** para mantener la persistencia de su sesión durante 7 días.

---

## 9.2 El Dashboard de Proyectos

Al iniciar sesión, el usuario accede al **Dashboard**, la sala de mandos principal de Mockia.io:

1. **Creación de un Proyecto:**
   - Haga clic en **New Project**.
   - Rellene el título y descripción (ej: "E-Commerce Frontend Mock").
   - El sistema creará un espacio de trabajo aislado y generará un **slug único** (ej: `e-commerce-frontend-mock`) y una **API Key** privada asociada.
2. **Listado de Proyectos:**
   - Visualice todos sus proyectos activos.
   - Los proyectos se ordenan automaticamente por el ultimo al que has accedido.
   - Puede invitar a miembros ingresando su correo y asignando roles (`EDITOR`, `VIEWER`) desde el modal de configuraciones para trabajar colaborativamente.

---

## 9.3 Ingesta y Autogeneración Inteligente (AI Pipeline)

El valor diferencial de Mockia.io es la autogeneración instantánea analizando el código del propio repositorio.

1. **Vincular GitHub:**
   - En la sección "Import" de su proyecto, introduzca la URL de su repositorio público de GitHub y la rama (ej: `main`).
   - Presione **Import Repository**. El backend extraerá automáticamente las interfaces y firmas del código fuente en segundos.
2. **Generación con IA:**
   - En el panel de generación de IA, introduzca en lenguaje natural qué desea generar o deje que el sistema lo deduzca analizando el contexto de GitHub.
   - Presione **Generate Mock API**.
   - El motor de OpenRouter analizará el código, deducirá los endpoints semánticos (ej: `/products`, `/auth/login`, `/cart`) y creará las respuestas JSON con datos de muestra realistas (nombres reales, fechas, importes válidos) de forma automática.

---

## 9.4 El Editor de Mocks (Mock Editor)

La interfaz interactiva tri-columna es el centro de control del mock:

1. **Visualizar Endpoints:**
   - La barra lateral izquierda muestra el catálogo de rutas con sus respectivos métodos HTTP coloreados semánticamente (GET en azul, POST en verde, PUT en naranja, DELETE en rojo).
2. **Configuración y Simulación (Panel Derecho):**
   - Seleccione un endpoint de la lista.
   - **Simular Latencia de Red (Delay):** Ingrese un valor en milisegundos (ej: `2000` para 2 segundos). Cualquier petición externa a esta ruta sufrirá ese retraso artificial, ideal para probar estados de carga (spinners) en el frontend.
   - **Forzar Códigos de Error (Force Status):** Marque códigos como `400`, `401` o `500` para forzar que el mock devuelva esos fallos HTTP de forma intencionada, validando el control de excepciones de la app.
3. **Editor JSON en Vivo (Panel Central):**
   - Edite el JSON de respuesta autogenerado directamente en el editor integrado. El sistema validará la sintaxis en caliente antes de guardar.

---

## 9.5 Consumo del Servidor Dinámico (Mock Router)

Para integrar las APIs simuladas en su aplicación Frontend o probarlas en Postman:

1. Localice la URL estable expuesta en la parte superior del editor:
   `http://localhost:3000/mock/:projectSlug/:route`  
2. Realice llamadas Fetch, Axios o cURL. 
3. El servidor dinámico de Mockia interceptará las peticiones y responderá con el JSON configurado, respetando el retardo y los errores HTTP indicados en caliente.
