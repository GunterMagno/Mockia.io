import { ProjectModel } from '../models/Project';

/**
 * Normalizes a string to create a URL-friendly slug
 * - Converts to lowercase
 * - Removes accents and diacritics
 * - Replaces spaces and underscores with hyphens
 * - Removes invalid characters
 * - Removes consecutive hyphens
 * 
 * @param str - String to normalize
 * @returns Normalized slug
 */
function normalizeSlug(str: string): string {
  return str
    // Convert to lowercase
    .toLowerCase()
    // Normalize unicode characters and remove accents
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Replace spaces and underscores with hyphens
    .replace(/[\s_]+/g, '-')
    // Remove invalid characters (keep only alphanumeric and hyphens)
    .replace(/[^\w-]/g, '')
    // Remove consecutive hyphens
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates a unique slug from a title
 * 
 * Algorithm:
 * 1. Normalize the title to create base slug
 * 2. Check if slug already exists
 * 3. If not exists, return base slug
 * 4. If exists, try suffixes: -1, -2, -3, etc. until finding an available one
 * 
 * @param title - Project title
 * @returns Promise resolving to a unique slug
 * @throws Error if unable to generate unique slug after max attempts
 */
export async function generateUniqueSlug(title: string): Promise<string> {
  const baseSlug = normalizeSlug(title);

  if (!baseSlug) {
    throw new Error('Title must contain at least one alphanumeric character');
  }

  const existing = await ProjectModel.findOne({ slug: baseSlug });
  if (!existing) {
    return baseSlug;
  }

  // If base slug exists, try with numeric suffixes
  const maxAttempts = 1000;
  for (let i = 1; i <= maxAttempts; i++) {
    const candidateSlug = `${baseSlug}-${i}`;
    const slugExists = await ProjectModel.findOne({ slug: candidateSlug });

    if (!slugExists) {
      return candidateSlug;
    }
  }

  // If we reach here, we couldn't find an available slug
  throw new Error(
    `Unable to generate unique slug for title "${title}" after ${maxAttempts} attempts`
  );
}
