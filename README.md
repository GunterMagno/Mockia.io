# Mockia.io

**Generador Inteligente de Mock APIs**

---

### 🌐 Recursos del Proyecto (Entregables DAW)
- **Despliegue Público (Producción):** [https://mockia-frontend.onrender.com](https://mockia-frontend.onrender.com)
- **Prototipo Interactivo (Figma):** [Figma UI/UX Mockia.io Prototype](https://www.figma.com/design/AwPy6Q8UwZrXtGBYpr9cIV/Proyecto-Mockia.io?m=auto&t=e1ozWaJmS2b6hTJt-6)
- **Documentación Académica Completa:** Disponible detalladamente en la carpeta [/docs](https://github.com/GunterMagno/Mockia.io/tree/main/docs)

---

## ¿Por qué Monorepo?

Un **monorepo con npm workspaces** fue elegido para:

- **Compartir tipos TypeScript** entre frontend y backend sin duplicación
- **Instalación centralizada** de dependencias (menos espacio, más rápido)
- **Versionado único** - un cambio, todos ganan
- **Escalabilidad** - fácil agregar nuevos paquetes (CLI, librerías, etc.)

---

## Stack: MERN + TypeScript

| Componente  | Tecnología             | Puerto |
| ----------- | ---------------------- | ------ |
| **M**ongoDB | Base de datos NoSQL    | 27017  |
| **E**xpress | API REST Backend       | 3000   |
| **R**eact   | Frontend UI            | 5173   |
| **N**ode.js | Runtime con TypeScript | -      |

---

## Inicio Rápido

### Requisitos

- Node.js 20+
- Docker Desktop (para Windows)

### Instalar y levantar

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar servicios
npm run docker:up
```

Accede a: **http://localhost:5173** (frontend) y **http://localhost:3000/api** (backend)

### Otros comandos

```bash
npm run docker:down      # Detener
npm run docker:logs      # Ver logs
npm run docker:rebuild   # Reconstruir imágenes
```

---

## Desarrollo Local (sin Docker)

```bash
# Backend
cd packages/backend && npm run dev

# Frontend
cd packages/frontend && npm run dev
```

---

**Autor:** Alejandro Borrego Cruz | **License:** MIT
