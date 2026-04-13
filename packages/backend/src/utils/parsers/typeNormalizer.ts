/**
 * Normalizes complex type representations to simplified forms
 * This helps reduce token usage and provide consistent type representations
 */

export interface NormalizationResult {
  original: string;
  normalized: string;
  simplified: boolean;
}

/**
 * Normalize a type representation to a simpler form
 * Converts common patterns like Optional<T>, T | null, etc.
 * to a consistent format
 *
 * @param type - The type string to normalize
 * @returns Normalized type representation
 */
export function normalizeType(type: string): NormalizationResult {
  const original = type.trim();
  let normalized = original;
  let simplified = false;

  // Remove extra whitespace around operators
  normalized = normalized.replace(/\s*\|\s*/g, ' | ');
  normalized = normalized.replace(/\s*&\s*/g, ' & ');
  normalized = normalized.replace(/\s*:\s*/g, ': ');

  // Convert Optional<T> to T | undefined
  if (normalized.match(/Optional<(.+?)>/)) {
    normalized = normalized.replace(/Optional<(.+?)>/g, '$1 | undefined');
    simplified = true;
  }

  // Convert Nullable<T> to T | null
  if (normalized.match(/Nullable<(.+?)>/)) {
    normalized = normalized.replace(/Nullable<(.+?)>/g, '$1 | null');
    simplified = true;
  }

  // Consolidate null and undefined combinations
  if (normalized.includes('| null') && normalized.includes('| undefined')) {
    const withoutNull = normalized.replace(/\s*\|\s*null\s*/g, '');
    const final = withoutNull.replace(/\s*\|\s*undefined\s*/g, ' | null | undefined');
    normalized = final;
    simplified = true;
  }

  // Convert Promise<T> to Promise<T> (keep as is, already simple)
  // Convert Array<T> to T[] if preferable
  if (normalized.match(/Array<(.+?)>/)) {
    normalized = normalized.replace(/Array<(.+?)>/g, '$1[]');
    simplified = true;
  }

  // Simplify any-like types
  if (normalized === 'any' || normalized === 'unknown' || normalized === 'object') {
    // Keep as is, already simple
  }

  // Remove leading/trailing whitespace and duplicate spaces
  normalized = normalized
    .replace(/\s+/g, ' ')
    .trim();

  const wasSimplified = original !== normalized;

  return {
    original,
    normalized,
    simplified: wasSimplified || simplified,
  };
}

/**
 * Normalize multiple types and return a summary
 * Useful for processing collections of types
 *
 * @param types - Array of type strings to normalize
 * @returns Normalized types with simplification info
 */
export function normalizeTypes(types: string[]): NormalizationResult[] {
  return types.map((type) => normalizeType(type));
}

/**
 * Get a compact representation of a type for display purposes
 * Removes unnecessary details and keeps only essential info
 *
 * @param type - The type string to compact
 * @param maxLength - Maximum length of the output (default: 80)
 * @returns Compacted type representation
 */
export function compactType(type: string, maxLength: number = 80): string {
  const normalized = normalizeType(type);
  let compact = normalized.normalized;

  // Simplify deep generic nesting
  if (compact.match(/<.{50,}>/)) {
    compact = compact.replace(/<.+>/g, '<...>');
  }

  // If still too long, truncate with ellipsis
  if (compact.length > maxLength) {
    compact = compact.substring(0, maxLength - 3) + '...';
  }

  return compact;
}

/**
 * Extract base type from a complex type expression
 * For example: "string | null" -> "string", "T[]" -> "T"
 *
 * @param type - The type string
 * @returns The base type without modifiers
 */
export function extractBaseType(type: string): string {
  let base = type.trim();

  // Remove array brackets
  base = base.replace(/\[\]$/g, '');

  // Remove union types (take first)
  if (base.includes('|')) {
    base = base.split('|')[0].trim();
  }

  // Remove intersection types (take first)
  if (base.includes('&')) {
    base = base.split('&')[0].trim();
  }

  // Remove generic parameters
  base = base.replace(/<.+>/g, '');

  return base.trim();
}

/**
 * Check if a type is nullable (includes null or undefined)
 *
 * @param type - The type string
 * @returns True if type includes null or undefined
 */
export function isNullable(type: string): boolean {
  const normalized = normalizeType(type).normalized.toLowerCase();
  return normalized.includes('null') || normalized.includes('undefined');
}

/**
 * Check if a type is an array type
 *
 * @param type - The type string
 * @returns True if type represents an array
 */
export function isArrayType(type: string): boolean {
  const normalized = normalizeType(type).normalized;
  return normalized.endsWith('[]') || normalized.startsWith('Array<');
}

/**
 * Check if a type is a promise/async type
 *
 * @param type - The type string
 * @returns True if type is Promise or resembles async type
 */
export function isPromiseType(type: string): boolean {
  const normalized = normalizeType(type).normalized;
  return normalized.startsWith('Promise<') || normalized.includes('Promise<');
}
