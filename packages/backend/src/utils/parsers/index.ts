/**
 * Parser utilities for parsing TypeScript files, Swagger/OpenAPI specifications,
 * and normalizing type representations
 */

export {
  parseTypeScriptFile,
} from './tsParser.js';

export {
  parseSwaggerFile,
} from './swaggerParser.js';

export {
  normalizeType,
  normalizeTypes,
  compactType,
  extractBaseType,
  isNullable,
  isArrayType,
  isPromiseType,
  type NormalizationResult,
} from './typeNormalizer.js';

// Re-export types from types folder
export type {
  ParsedTypeScriptFile,
  InterfaceInfo,
  PropertyInfo,
  TypeAliasInfo,
  EnumInfo,
  FunctionSignature,
  ParameterInfo,
} from '../../types/tsParser.js';

export type {
  ParsedSwaggerFile,
  PathItem,
  MethodInfo,
  ParameterSchema,
  SchemaReference,
  ResponseSchema,
  ComponentSchema,
} from '../../types/swaggerParser.js';
