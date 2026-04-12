/**
 * Types for TypeScript AST parsing
 * Used by tsParser to represent extracted code structure
 */

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface InterfaceInfo {
  name: string;
  properties: PropertyInfo[];
  isExported: boolean;
}

export interface TypeAliasInfo {
  name: string;
  type: string;
  isExported: boolean;
}

export interface EnumInfo {
  name: string;
  members: string[];
  isExported: boolean;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface FunctionSignature {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isExported: boolean;
}

export interface ParsedTypeScriptFile {
  interfaces: InterfaceInfo[];
  typeAliases: TypeAliasInfo[];
  enums: EnumInfo[];
  functions: FunctionSignature[];
  filePath: string;
}
