import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  PathItem,
  MethodInfo,
  ParameterSchema,
  SchemaReference,
  ResponseSchema,
  ComponentSchema,
  ParsedSwaggerFile,
} from '../../types/swaggerParser';

/**
 * Parses a Swagger/OpenAPI file (YAML or JSON) and extracts relevant information
 * @param filePath - Path to the OpenAPI/Swagger file
 * @returns Simplified structure with paths, methods, and schemas
 */
export async function parseSwaggerFile(filePath: string): Promise<ParsedSwaggerFile> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  let swaggerObj: Record<string, unknown>;

  try {
    // Try to parse as YAML first (works for both YAML and JSON)
    swaggerObj = yaml.load(fileContent) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse Swagger/OpenAPI file: ${error}`);
  }

  const version = String(swaggerObj.openapi || swaggerObj.swagger || '3.0.0');
  const info = swaggerObj.info as Record<string, unknown> | undefined;
  const title = info?.title as string | undefined;
  const description = info?.description as string | undefined;

  const paths = extractPaths(swaggerObj.paths as Record<string, unknown> || {});
  const components = extractComponents(swaggerObj.components as Record<string, unknown> || {});

  return {
    version,
    title,
    description,
    paths,
    components,
    filePath: absolutePath,
  };
}

/**
 * Extract paths and methods from the OpenAPI spec
 */
function extractPaths(pathsObj: Record<string, unknown>): PathItem[] {
  const paths: PathItem[] = [];

  Object.entries(pathsObj).forEach(([pathKey, pathValue]) => {
    if (!pathKey.startsWith('x-') && pathValue && typeof pathValue === 'object') {
      const methods: MethodInfo[] = [];
      const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

      httpMethods.forEach((method) => {
        const methodData = (pathValue as Record<string, unknown>)[method];
        if (methodData && typeof methodData === 'object') {
          const methodInfo = extractMethodInfo(
            method as MethodInfo['method'],
            methodData as Record<string, unknown>
          );
          methods.push(methodInfo);
        }
      });

      if (methods.length > 0) {
        paths.push({
          path: pathKey,
          methods,
        });
      }
    }
  });

  return paths;
}

/**
 * Extract method information (parameters, request body, responses)
 */
function extractMethodInfo(
  method: MethodInfo['method'],
  methodObj: Record<string, unknown>
): MethodInfo {
  const parameters: ParameterSchema[] = [];
  const parametersObj = methodObj.parameters as Record<string, unknown>[] | undefined;

  if (Array.isArray(parametersObj)) {
    parametersObj.forEach((param) => {
      if (param && typeof param === 'object') {
        parameters.push({
          name: String(param.name || 'unknown'),
          in: String(param.in || 'query') as ParameterSchema['in'],
          required: Boolean(param.required || false),
          schema: param.schema,
          description: param.description as string | undefined,
        });
      }
    });
  }

  let requestBody: SchemaReference | undefined;
  const requestBodyObj = methodObj.requestBody as Record<string, unknown>;
  if (requestBodyObj) {
    const content = requestBodyObj.content as Record<string, unknown>;
    if (content) {
      const contentType = Object.keys(content)[0];
      const contentData = content[contentType] as Record<string, unknown> | undefined;
      requestBody = {
        contentType,
        schema: contentData?.schema,
      };
    }
  }

  const responses: ResponseSchema[] = [];
  const responsesObj = methodObj.responses as Record<string, unknown>;

  if (responsesObj && typeof responsesObj === 'object') {
    Object.entries(responsesObj).forEach(([statusCode, responseValue]) => {
      if (responseValue && typeof responseValue === 'object') {
        const responseData = responseValue as Record<string, unknown>;
        let schema: unknown;

        const content = responseData.content as Record<string, unknown>;
        if (content) {
          const contentType = Object.keys(content)[0];
          const contentData = content[contentType] as Record<string, unknown> | undefined;
          schema = contentData?.schema;
        }

        responses.push({
          statusCode,
          description: responseData.description as string | undefined,
          schema,
        });
      }
    });
  }

  return {
    method,
    summary: methodObj.summary as string | undefined,
    description: methodObj.description as string | undefined,
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses,
  };
}

/**
 * Extract component schemas (reusable schemas)
 */
function extractComponents(componentsObj: Record<string, unknown>): ComponentSchema[] {
  const components: ComponentSchema[] = [];

  const schemasObj = componentsObj.schemas as Record<string, unknown>;
  if (schemasObj && typeof schemasObj === 'object') {
    Object.entries(schemasObj).forEach(([schemaName, schemaValue]) => {
      components.push({
        name: schemaName,
        schema: schemaValue,
      });
    });
  }

  return components;
}
