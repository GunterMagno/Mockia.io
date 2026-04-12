/**
 * Types for Swagger/OpenAPI parsing
 * Used by swaggerParser to represent extracted API structure
 */

export interface ParameterSchema {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  schema?: unknown;
  description?: string;
}

export interface SchemaReference {
  contentType?: string;
  schema?: unknown;
}

export interface ResponseSchema {
  statusCode: string;
  description?: string;
  schema?: unknown;
}

export interface MethodInfo {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
  summary?: string;
  description?: string;
  parameters?: ParameterSchema[];
  requestBody?: SchemaReference;
  responses: ResponseSchema[];
}

export interface PathItem {
  path: string;
  methods: MethodInfo[];
}

export interface ComponentSchema {
  name: string;
  schema: unknown;
}

export interface ParsedSwaggerFile {
  version: string;
  title?: string;
  description?: string;
  paths: PathItem[];
  components: ComponentSchema[];
  filePath: string;
}
