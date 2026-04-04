/**
 * Parser utilities for parsing TypeScript files, Swagger/OpenAPI specifications,
 * and normalizing type representations
 */

export {
  parseTypeScriptFile,
  type ParsedTypeScriptFile,
  type InterfaceInfo,
  type PropertyInfo,
  type TypeAliasInfo,
  type EnumInfo,
  type FunctionSignature,
  type ParameterInfo,
} from './tsParser';

export {
  parseSwaggerFile,
  type ParsedSwaggerFile,
  type PathItem,
  type MethodInfo,
  type ParameterSchema,
  type SchemaReference,
  type ResponseSchema,
  type ComponentSchema,
} from './swaggerParser';

export {
  normalizeType,
  normalizeTypes,
  compactType,
  extractBaseType,
  isNullable,
  isArrayType,
  isPromiseType,
  type NormalizationResult,
} from './typeNormalizer';
