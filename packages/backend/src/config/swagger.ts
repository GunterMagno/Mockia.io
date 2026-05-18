import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import fs from 'fs';

const baseDir = process.cwd();

// Automatically detect whether we are running in a production dist environment or from source (src)
const isProd = fs.existsSync(path.join(baseDir, 'dist'));
const sourceDir = isProd ? 'dist' : 'src';

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
  apis: [
    path.join(baseDir, `${sourceDir}/routes/*.{ts,js}`),
    path.join(baseDir, `${sourceDir}/modules/**/*.{ts,js}`),
    path.join(baseDir, `${sourceDir}/models/*.{ts,js}`),
  ],
};

export const specs = swaggerJsdoc(options);
