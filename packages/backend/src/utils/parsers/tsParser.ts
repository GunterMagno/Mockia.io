import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface InterfaceInfo {
  name: string;
  properties: PropertyInfo[];
  isExported: boolean;
}

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
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

export interface FunctionSignature {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isExported: boolean;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface ParsedTypeScriptFile {
  interfaces: InterfaceInfo[];
  typeAliases: TypeAliasInfo[];
  enums: EnumInfo[];
  functions: FunctionSignature[];
  filePath: string;
}

/**
 * Parses a TypeScript file and extracts interfaces, types, enums, and exported functions
 * @param filePath - Path to the TypeScript file to parse
 * @returns Simplified structure with extracted information
 */
export async function parseTypeScriptFile(filePath: string): Promise<ParsedTypeScriptFile> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const sourceCode = fs.readFileSync(absolutePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const interfaces: InterfaceInfo[] = [];
  const typeAliases: TypeAliasInfo[] = [];
  const enums: EnumInfo[] = [];
  const functions: FunctionSignature[] = [];

  const visit = (node: ts.Node) => {
    // Extract interfaces
    if (ts.isInterfaceDeclaration(node)) {
      const interfaceInfo = extractInterface(node);
      interfaces.push(interfaceInfo);
    }

    // Extract type aliases
    if (ts.isTypeAliasDeclaration(node)) {
      const typeAlias = extractTypeAlias(node);
      typeAliases.push(typeAlias);
    }

    // Extract enums
    if (ts.isEnumDeclaration(node)) {
      const enumInfo = extractEnum(node);
      enums.push(enumInfo);
    }

    // Extract function signatures
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcSignature = extractFunctionSignature(node);
      functions.push(funcSignature);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return {
    interfaces,
    typeAliases,
    enums,
    functions,
    filePath: absolutePath,
  };
}

/**
 * Extract interface information from an interface declaration
 */
function extractInterface(node: ts.InterfaceDeclaration): InterfaceInfo {
  const properties: PropertyInfo[] = [];

  node.members.forEach((member) => {
    if (ts.isPropertySignature(member) && member.name) {
      const propertyName = typeof member.name === 'string'
        ? member.name
        : member.name.getText();

      const type = member.type ? member.type.getText() : 'unknown';
      const optional = member.questionToken !== undefined;

      properties.push({
        name: propertyName,
        type,
        optional,
      });
    }
  });

  const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;

  return {
    name: node.name.text,
    properties,
    isExported,
  };
}

/**
 * Extract type alias information
 */
function extractTypeAlias(node: ts.TypeAliasDeclaration): TypeAliasInfo {
  const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;

  return {
    name: node.name.text,
    type: node.type.getText(),
    isExported,
  };
}

/**
 * Extract enum information
 */
function extractEnum(node: ts.EnumDeclaration): EnumInfo {
  const members = node.members
    .map((member) => {
      if (ts.isEnumMember(member)) {
        return member.name?.getText() || 'Unknown';
      }
      return 'Unknown';
    });

  const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;

  return {
    name: node.name.text,
    members,
    isExported,
  };
}

/**
 * Extract function signature information
 */
function extractFunctionSignature(node: ts.FunctionDeclaration): FunctionSignature {
  const parameters: ParameterInfo[] = [];

  node.parameters.forEach((param) => {
    const paramName = param.name.getText();
    const paramType = param.type ? param.type.getText() : 'unknown';
    const optional = param.questionToken !== undefined;

    parameters.push({
      name: paramName,
      type: paramType,
      optional,
    });
  });

  const returnType = node.type ? node.type.getText() : 'unknown';
  const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;

  return {
    name: node.name?.text || 'Anonymous',
    parameters,
    returnType,
    isExported,
  };
}
