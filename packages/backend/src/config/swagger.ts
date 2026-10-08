import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
// @ts-ignore
import { getSwaggerDirname } from './pathHelper.cjs';

const swaggerDirname = getSwaggerDirname();

export const swaggerOptions: swaggerJsdoc.Options = {
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

/**
 * Builds the OpenAPI document from the @swagger annotations. A YAML error in one annotation does not throw: swagger-jsdoc
 * only prints a report and drops that block (tests/swagger.spec.test.ts fails on such a report).
 */
export function buildSwaggerSpec(): object {
  return swaggerJsdoc(swaggerOptions);
}

export const specs = buildSwaggerSpec();
