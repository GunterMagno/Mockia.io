# Apartado 4: Guía de Estilos Visuales e Interfaces

Este apartado formaliza la guía de estilos visuales e interfaces (UI/UX) implementada de forma rigurosa y coherente a lo largo de toda la plataforma **Mockia.io**. El diseño y la estética se basan directamente en las variables de CSS y tokens de diseño declarados de manera centralizada en el archivo global de estilos:`global.scss`.

---

## 4.1 Paleta de Colores Completa y Semántica

El sistema de colores cuenta con un esquema vibrante y de alto contraste que facilita la legibilidad de código JSON, estados de endpoints y paneles de control. Los tokens de color se estructuran de la siguiente manera:

### A. Colores Primarios (Gama de Indigo / Violeta)
Dominan las llamadas a la acción principales, enlaces activos y flujos de trabajo primarios:
* **Primary Light (Base):** `#4f46e5` (`--primary-light`) - Color de acento primordial de la marca.
* **Primary Light Hover:** `#473fce` (`--primary-light-hover`) - Tono reactivo para interacciones rápidas.
* **Primary Light Disabled:** `#9793f0` (`--primary-light-disabled`) - Estado desactivado o inactivo.
* **Primary Dark:** `#3b35ac` (`--primary-dark`) - Tono oscuro complementario.
* **Primary Dark Hover:** `#2f2a89` (`--primary-dark-hover`) - Hover en componentes oscuros.
* **Primary Dark Off:** `#241f67` (`--primary-dark-off`) - Fondo ultra oscuro de acento.

### B. Colores Secundarios (Gama Slate / Lavanda Neutro)
Utilizados para interfaces secundarias, layouts neutros y estados intermedios:
* **Secondary Light (Base):** `#7170b6` (`--secondary-light`) - Textos y bordes secundarios de control.
* **Secondary Light Hover:** `#6665a4` (`--secondary-light-hover`) - Hover en botones secundarios.
* **Secondary Light Disabled:** `#ababd6` (`--secondary-light-disabled`) - Estado deshabilitado secundario.
* **Secondary Dark:** `#555489` (`--secondary-dark`) - Para fondos de paneles y texto de menor jerarquía.
* **Secondary Dark Hover:** `#44436d` (`--secondary-dark-hover`) - Hover reactivo.
* **Secondary Dark Off:** `#333252` (`--secondary-dark-off`) - Contenedores anidados secundarios.

### C. Colores Terciarios (Gama de Naranja / Óxido)
Colores de advertencia, llamadas de atención asíncronas y método HTTP `PUT`:
* **Tertiary Light Disabled (Orange):** `#fc9959` (`--tertiary-light-disabled`) - Naranja brillante para notificaciones no leídas, badges y PUT.
* **Tertiary Light:** `#a54100` (`--tertiary-light`) - Óxido vivo para resaltar elementos interactivos.
* **Tertiary Light Hover:** `#953b00` (`--tertiary-light-hover`) - Hover de tono óxido.
* **Tertiary Dark:** `#7c3100` (`--tertiary-dark`) - Método PUT en árbol y estados del editor.
* **Tertiary Dark Hover:** `#632700` (`--tertiary-dark-hover`) - Tono intermedio de advertencia.
* **Tertiary Dark Off:** `#4a1d00` (`--tertiary-dark-off`) - Tono más profundo.

### D. Colores de Soporte y Semánticos
* **Support 01 (Success Green):** `#60cc52` (`--support-01`) - Mensajes de éxito e importaciones correctas.
* **Support 02 (Error Red):** `#ff0c10` (`--support-02`) - Validaciones fallidas y método `DELETE`.
* **Support 03 (Dark Neutral):** `#141414` (`--support-03`) - Color primario del texto (`--text`).
* **Support 04 (Light Neutral):** `#f4f4f4` (`--support-04`) - Fondo general de la SPA (`--bg`) y modales (`--card-bg`).
* **Support 05 (Border Grey):** `#c5c5c5` (`--support-05`) - Color general de bordes (`--border`).

### E. Tokens de Tema Settings (Panel de Configuración)
Un tema lila/lavanda dedicado exclusivamente al modal de ajustes del proyecto:
* **Background del Modal:** `#b0b2e3` (`--settings-modal-bg`)
* **Inputs Background:** `#7e80c1` (`--settings-input-bg`) con texto `#f4f4f4` (`--settings-input-text`)
* **Texto General:** `#141414` (`--settings-text`)
* **Danger Zone Background:** `#ff9b6a` (`--settings-danger-bg`) con borde `#ff4d4d` (`--settings-danger-border`)
* **Botón Principal:** `#8a8ce0` (`--settings-btn-primary`) con hover `#7a7cc0` (`--settings-btn-hover`)
* **Botón Secundario:** `#c0c2ef` (`--settings-btn-secondary`)

---

## 4.2 Tipografía y Escala de Textos

Se utiliza una tipografía altamente legible en pantallas que optimiza el renderizado de código e interfaces complejas:

* **Familia Sans-Serif Principal (`--font-sans`):** System Sans-Serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`).
* **Familia Monoespaciada (Editor JSON y Endpoints):** `SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace`.

### Escala de Textos Estricta:
* `text-xs`: `0.75rem` (12px) - Metadatos, fechas de notificación e insignias de roles.
* `text-sm`: `0.875rem` (14px) - Textos de formularios, etiquetas secundarias e inputs.
* `text-base`: `1rem` (16px) - Texto del cuerpo, botones y campos de entrada de código.
* `text-lg`: `1.125rem` (18px) - Rutas de endpoints y descripciones secundarias.
* `text-xl`: `1.25rem` (20px) - Títulos de paneles laterales y pestañas del editor.
* `text-2xl`: `1.5rem` (24px) - Títulos de páginas y modales.
* `text-3xl`: `1.875rem` (30px) - Encabezados de páginas de bienvenida y landing.

---

## 4.3 Espaciados, Radios y Sombras (Layout)

Para estructurar los paneles y garantizar una disposición modular de las cajas, el diseño utiliza variables centralizadas:

### Medidas de Margen y Espaciado (Padding / Margin)
* `--spacing-1`: `0.25rem` (4px)
* `--spacing-2`: `0.5rem` (8px)
* `--spacing-3`: `0.75rem` (12px)
* `--spacing-4`: `1rem` (16px)
* `--spacing-5`: `1.25rem` (20px)
* `--spacing-6`: `1.5rem` (24px)
* `--spacing-8`: `2rem` (32px)
* `--spacing-10`: `2.5rem` (40px)

### Radios de Bordes (Border Radius)
* `--radius-sm`: `0.25rem` (4px)
* `--radius-md`: `0.375rem` (6px) - Botones e inputs del formulario.
* `--radius-lg`: `0.5rem` (8px) - Tarjetas y paneles del editor.
* `--radius-xl`: `0.75rem` (12px) - Ventanas modales completas.
* `--radius-full`: `500px` - Botones píldora y campana de notificaciones.

### Sombras y Capas
* **Sombras Suaves:** `0 2px 6px rgba(0, 0, 0, 0.06)` (`--shadow-sm`)
* **Sombras de Elevación (Modales):** `0 10px 25px rgba(0, 0, 0, 0.2)` (`--shadow-lg`)
* **Overlay Oscuro:** `rgba(0, 0, 0, 0.5)` (`--overlay`)

---

## 4.4 Efecto Glassmorphism y Capas Especiales

La interfaz utiliza efectos visuales modernos tipo SaaS para estructurar y jerarquizar los elementos interactivos en el espacio tridimensional de la pantalla:

* **Fondo Translúcido (`--glass-bg`):** `rgba(255, 255, 255, 0.15)`
* **Borde Translúcido (`--glass-border`):** `1px solid rgba(255, 255, 255, 0.1)`
* **Filtros de Desenfoque:** `backdrop-filter: blur(12px)`
* **Indicadores Activos en Sidebar:** `rgba(0, 0, 0, 0.1)` (`--sidebar-item-active`)

---

## 4.5 Retícula Responsive y Breakpoints

El monorepo incorpora mixins responsivos en SASS para adaptar fluidamente las interfaces tri-columna del editor en cualquier dispositivo:

* **Breakpoints Oficiales:**
  * `$breakpoint-sm: 576px`
  * `$breakpoint-md: 768px`
  * `$breakpoint-lg: 992px`
  * `$breakpoint-xl: 1200px`

### Implementación mediante Mixin `@mixin respond-to`:
```scss
@mixin respond-to($breakpoint) {
  @if $breakpoint == 'sm' {
    @media (max-width: $breakpoint-sm) { @content; }
  } @else if $breakpoint == 'md' {
    @media (max-width: $breakpoint-md) { @content; }
  } @else if $breakpoint == 'lg' {
    @media (max-width: $breakpoint-lg) { @content; }
  } @else if $breakpoint == 'xl' {
    @media (max-width: $breakpoint-xl) { @content; }
  } @else {
    @media (max-width: $breakpoint) { @content; }
  }
}
```

---

## 4.6 Animaciones, Transiciones e Interactividad (UX)

Para dotar al sistema de una apariencia reactiva, se incorporan efectos interactivos refinados:

1. **Transiciones de Estado:** Todos los botones, campos de entrada de datos y enlaces del menú de navegación implementan transiciones de color y escalado suaves a través de variables de tiempo centralizadas:
   * `--transition-fast`: `150ms ease-in-out`.
   * `--transition-normal`: `250ms ease-in-out`.
2. **Efectos de Sonido en Errores:** Para mejorar la experiencia de uso, el frontend reproduce un sutil sonido de alerta (`playErrorSound()`) cuando ocurre un fallo importante de validación en un formulario o cuando se pierde la conexión con el servidor. Este sonido cuenta con un control de espera inteligente (debounce) para evitar que se reproduzca varias veces seguidas si ocurren muchos errores de golpe, complementando el aviso visual en pantalla de forma limpia.
