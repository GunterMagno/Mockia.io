import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
// @ts-ignore
import { getSwaggerDirname } from './pathHelper.cjs';

const swaggerDirname = getSwaggerDirname();

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
    path.join(swaggerDirname, '../routes/*.ts'),
    path.join(swaggerDirname, '../modules/**/*.ts'),
    path.join(swaggerDirname, '../models/*.ts'),
  ],
};

export const specs = swaggerJsdoc(options);
