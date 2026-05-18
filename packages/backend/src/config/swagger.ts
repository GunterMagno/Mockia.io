import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

let currentDirname: string;

try {
  // Use a dynamic Function evaluation to prevent compiler errors under CommonJS/Jest
  const metaUrl = new Function('return import.meta.url')();
  if (metaUrl) {
    currentDirname = path.dirname(fileURLToPath(metaUrl));
  } else {
    currentDirname = __dirname;
  }
} catch (e) {
  currentDirname = __dirname;
}

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mockia.io API Documentation',
      version: '1.0.0',
      description: 'API documentation for the Mockia.io platform. Generate, manage and simulate APIs with AI.',
      contact: {
        name: 'Mockia Support',
        url: 'https://mockia.io',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  // Automatically scan all routes and modules for @swagger annotations
  // Scan both .ts (for development and tests) and .js (for production builds)
  apis: [
    path.join(currentDirname, '../routes/*.{ts,js}'),
    path.join(currentDirname, '../modules/**/*.{ts,js}'),
    path.join(currentDirname, '../models/*.{ts,js}'),
  ],
};

export const specs = swaggerJsdoc(options);
