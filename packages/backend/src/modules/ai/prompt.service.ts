/**
 * Prompt Building Service for Mockia AI
 * 
 * Orchestrates the construction of prompts by combining:
 * - System prompt (role and rules)
 * - GitHub repository context
 * - User input and requirements
 */

import { SYSTEM_PROMPT } from './systemPrompt.js';
import { getProjectContext } from '../../services/github-context.service.js';
import { buildSampleData, formatSampleDataForPrompt } from './fakeDataProvider.js';
import { ProjectModel } from '../../models/Project.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode, type MockAPIOutput } from '@mockia/shared';
import type { OpenRouterMessage } from '../../types/ai.js';

/**
 * Token limit constants for prompt building
 */
const TOKEN_LIMITS = {
  systemPrompt: 2000, // System prompt is typically short
  contextBudget: 6000, // Available tokens for GitHub context
  userInput: 1000, // User request
  response: 4000, // Reserve for response
  total: 16000, // OpenRouter typical limit
};

/**
 * Truncates context to fit within token budget
 * Uses a simple heuristic: ~4 characters ≈ 1 token
 * 
 * @param context - The GitHub context to truncate
 * @param maxTokens - Maximum tokens allowed
 * @returns Truncated context string
 */
function truncateContext(context: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (context.length <= maxChars) {
    return context;
  }

  // Truncate and add indicator
  return (
    context.substring(0, maxChars) +
    '\n... [Context truncated due to length]'
  );
}

/**
 * Formats the GitHub context into a readable string for the prompt
 * Implements intelligent sorting, noise filtering, and file-level budgeting
 * 
 * @param context - Raw GitHub context data
 * @param maxTokens - Maximum tokens allowed for the context budget
 * @returns Formatted context string
 */
function formatGitHubContext(context: any, maxTokens: number): string {
  const sections: string[] = [];

  // Repository info
  sections.push(`## Repository: ${context.repoName}`);
  sections.push(`URL: ${context.repoUrl}`);
  sections.push(`Owner: ${context.repoOwner}`);
  if (context.branch) {
    sections.push(`Branch: ${context.branch}`);
  }
  sections.push(`Summary: ${context.summary}`);

  // Statistics
  sections.push(`\n## Structure Statistics`);
  sections.push(`- Total Files: ${context.stats?.totalFiles || 0}`);
  sections.push(`- Interfaces: ${context.stats?.totalInterfaces || 0}`);
  sections.push(`- Functions: ${context.stats?.totalFunctions || 0}`);
  sections.push(`- Routes: ${context.stats?.totalRoutes || 0}`);

  if (!context.files || context.files.length === 0) {
    return sections.join('\n');
  }

  // Filter out noisy files (tests, configs, locks, setup)
  const isNoiseFile = (filePath: string): boolean => {
    const lower = filePath.toLowerCase();
    return (
      lower.includes('.test.') ||
      lower.includes('.spec.') ||
      lower.includes('.setup.') ||
      lower.includes('.config.') ||
      lower.endsWith('.d.ts') ||
      lower.includes('/__tests__/') ||
      lower.includes('/mocks/') ||
      lower.includes('/test/') ||
      lower === 'tsconfig.json' ||
      lower === 'package.json' ||
      lower === 'package-lock.json' ||
      lower === 'yarn.lock' ||
      lower === 'pnpm-lock.yaml'
    );
  };

  const filteredFiles = context.files.filter((file: any) => !isNoiseFile(file.path));

  // Priority scoring for files (lower is higher priority)
  const getFilePriority = (file: any): number => {
    const lowerPath = file.path.toLowerCase();
    if (lowerPath === 'readme.md' || lowerPath.endsWith('/readme.md') || lowerPath.endsWith('\\readme.md')) {
      return 0;
    }
    
    if (file.type === 'swagger') return 1;
    
    // Models, schemas, interfaces, DTOs
    if (
      lowerPath.includes('model') ||
      lowerPath.includes('schema') ||
      lowerPath.includes('interface') ||
      lowerPath.includes('type') ||
      lowerPath.includes('dto')
    ) {
      return 2;
    }
    
    // Routes and controllers
    if (
      lowerPath.includes('route') ||
      lowerPath.includes('router') ||
      lowerPath.includes('controller')
    ) {
      return 3;
    }
    
    // Core entry points
    const baseName = lowerPath.split('/').pop() || '';
    if (
      baseName === 'index.ts' ||
      baseName === 'main.ts' ||
      baseName === 'app.ts' ||
      baseName === 'server.ts' ||
      baseName === 'index.js' ||
      baseName === 'main.js' ||
      baseName === 'app.js' ||
      baseName === 'server.js'
    ) {
      return 4;
    }
    
    return 5;
  };

  // Sort files by priority, then alphabetically
  filteredFiles.sort((a: any, b: any) => {
    const prioA = getFilePriority(a);
    const prioB = getFilePriority(b);
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    return a.path.localeCompare(b.path);
  });

  // Helper to format a single file section
  const formatFileSection = (file: any): string => {
    const fileLines: string[] = [];
    const lowerPath = file.path.toLowerCase();
    
    if (lowerPath === 'readme.md' || lowerPath.endsWith('/readme.md') || lowerPath.endsWith('\\readme.md')) {
      fileLines.push(`- [Project Documentation / README] ${file.path}`);
      if (file.summary) {
        fileLines.push(`  Content:\n${file.summary}`);
      }
    } else if (file.type === 'swagger') {
      fileLines.push(`- [OpenAPI Spec] ${file.path}`);
      if (file.summary) {
        fileLines.push(`  Summary: ${file.summary}`);
      }
      if (file.routes && file.routes.length > 0) {
        fileLines.push(`  Routes:`);
        file.routes.forEach((route: any) => {
          fileLines.push(`    - ${route.methods.join(',')} ${route.path}`);
        });
      }
    } else {
      fileLines.push(`- [Code File] ${file.path}`);
      if (file.summary) {
        fileLines.push(`  Summary: ${file.summary}`);
      }
      if (file.routes && file.routes.length > 0) {
        fileLines.push(`  Extracted Code Routes:`);
        file.routes.forEach((route: any) => {
          fileLines.push(`    - ${route.methods.join(',')} ${route.path}`);
        });
      }
      if (file.interfaces && file.interfaces.length > 0) {
        fileLines.push(`  Interfaces:`);
        file.interfaces.forEach((i: any) => {
          fileLines.push(`    interface ${i.name} { ${i.properties.join('; ')} }`);
        });
      }
      if (file.typeAliases && file.typeAliases.length > 0) {
        fileLines.push(`  Types:`);
        file.typeAliases.forEach((t: any) => {
          fileLines.push(`    type ${t.name} = ${t.type}`);
        });
      }
      if (file.enums && file.enums.length > 0) {
        fileLines.push(`  Enums:`);
        file.enums.forEach((e: any) => {
          fileLines.push(`    enum ${e.name} { ${e.members.join(', ')} }`);
        });
      }
      if (file.functions && file.functions.length > 0) {
        fileLines.push(`  Functions:`);
        file.functions.forEach((f: any) => {
          fileLines.push(`    ${f.name}(${f.params.join(', ')}): ${f.returnType}`);
        });
      }
    }
    
    return fileLines.join('\n');
  };

  // Budgeting logic (1 token ≈ 4 characters)
  let currentTokens = Math.ceil(sections.join('\n').length / 4);
  const budgetLines: string[] = [];
  let includedCount = 0;
  let skippedCount = 0;

  for (const file of filteredFiles) {
    const formatted = formatFileSection(file);
    const fileTokens = Math.ceil(formatted.length / 4);
    
    if (currentTokens + fileTokens <= maxTokens) {
      budgetLines.push(formatted);
      currentTokens += fileTokens;
      includedCount++;
    } else {
      skippedCount++;
    }
  }

  sections.push(`\n## Code Structure (Priority Sorted & Budgeted - Included: ${includedCount}, Omitted: ${skippedCount})\n`);
  sections.push(budgetLines.join('\n\n'));

  return sections.join('\n');
}

/**
 * Builds a complete prompt for OpenRouter API
 * 
 * Combines system prompt, GitHub context, and user input into
 * a structured message array ready for OpenRouter API call
 * 
 * @param projectId - The project ID to load context for
 * @param userInput - The user's request/requirements for the mock API
 * @param options - Optional configuration
 * @returns OpenRouter message array with system, context, and user messages
 * @throws AppError if project not found or context unavailable
 */
export async function buildPrompt(
  projectId: string,
  userInput: string,
  options?: {
    contextBudgetOverride?: number;
    includeSystemPrompt?: boolean;
  }
): Promise<OpenRouterMessage[]> {
  // Verify project exists (by ID or Slug)
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectId);
  let project;
  
  if (isValidObjectId) {
    project = await ProjectModel.findById(projectId);
  }
  
  if (!project) {
    project = await ProjectModel.findOne({ slug: projectId });
  }

  if (!project) {
    throw new AppError(
      'Project not found',
      ErrorCode.NOT_FOUND,
      404
    );
  }

  // Use the real _id for subsequent operations
  const realProjectId = project._id.toString();

  // Budget context
  const contextBudget =
    options?.contextBudgetOverride || TOKEN_LIMITS.contextBudget;

  // Load GitHub context
  let contextString = '';
  let hasContext = false;
  try {
    const context = await getProjectContext(realProjectId);
    if (context && (context.files?.length > 0 || context.repoName || context.summary)) {
      contextString = formatGitHubContext(context, contextBudget);
      hasContext = true;
    } else {
      contextString = `## Project: ${project.title}\nDescription: ${project.description || 'A software application'}\nNo GitHub context available yet.`;
    }
  } catch (error) {
    // Context might not exist yet, proceed with empty context
    console.warn(`No GitHub context found for project ${realProjectId}`);
    contextString = `## Project: ${project.title}\nDescription: ${project.description || 'A software application'}\nNo GitHub context available yet.`;
  }

  // Truncate context to fit budget
  const truncatedContext = truncateContext(contextString, contextBudget);

  // Build messages array
  const messages: OpenRouterMessage[] = [];

  // System prompt (if not disabled)
  if (options?.includeSystemPrompt !== false) {
    messages.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
  }

  // Context message
  messages.push({
    role: 'user',
    content: `## GitHub Repository Context\n\n${truncatedContext}`,
  });

  const contextInstructions = hasContext
    ? `IMPORTANT: First, read the "Project Documentation / README" section in the GitHub context to fully understand the application's domain, core business logic, and main entities.
    
Based EXCLUSIVELY on the project description, README documentation, and the actual code files (interfaces, types, functions, and routes) found in the repository context provided above, generate a comprehensive mock API specification that perfectly matches the business domain of this application for the following requirement:

${userInput}

Rules for EXCELLENCE:
1. **IDENTIFY THE CORE**: First, identify the primary purpose of the application (e.g., if it's a restaurant app, the "heart" is the menu and dishes, not just users). Prioritize endpoints for these core entities.
2. **USE EXACT TYPES**: Use the EXACT property names and types from the repository's interfaces.
3. **LOGICAL ENDPOINTS**: Generate between 5 and 10 logical endpoints. Quality over quantity.
4. **REALISTIC MOCK DATA**: Include RICH, REALISTIC MOCK DATA in the examples (e.g., actual dish names like "Spaghetti Carbonara", realistic prices, valid IDs) that a frontend developer can use directly.
5. **NO GENERIC BIAS**: DO NOT generate generic "orders" or "products" unless they are explicitly present in the repository context.
6. **RESPONSE FIDELITY**: Ensure response examples match the schema and are realistic but concise.
7. **JSON ONLY**: Return ONLY valid JSON. No markdown blocks.
8. **EMPTY CONTEXT FALLBACK**: If the repository context provided above is empty, contains no files, or has no parsed interfaces/routes, you MUST NOT return empty endpoints. In that case, ignore the "EXCLUSIVELY" and "NO GENERIC BIAS" rules. Instead, use maximum creative freedom to generate beautiful mock endpoints based on the repository name, project context, and user requirements.`
    : `There is NO repository context connected yet. Therefore, you have MAXIMUM CREATIVE FREEDOM!

Based on the Project Name ("${project.title}") and Description ("${project.description || 'A custom web application'}"), generate a beautiful, comprehensive, and highly realistic mock API specification for the following requirement:

${userInput}

Rules for EXCELLENCE:
1. **INVENT DYNAMIC DOMAINS**: Fully invent realistic resources and schemas suited to the project name (e.g., if the project is a "Task Tracker", create "/api/tasks", "/api/categories", "/api/comments"; if it's a "Gym Tracker", create "/api/workouts", "/api/exercises", "/api/members").
2. **BE CREATIVE & DIVERSE**: DO NOT return generic "Example" or "123" text. DO NOT reuse the same names. Generate highly diverse and real-looking mock data (e.g., actual user names, dynamic task descriptions like "Fix header alignment on mobile", actual product names, realistic prices, and recent ISO dates).
3. **LOGICAL ENDPOINTS**: Generate between 5 and 10 logical REST endpoints (GET list, GET by ID, POST, PUT, DELETE).
4. **NO DUPLICATES**: Ensure all example objects have unique IDs, unique names, and realistic varied values.
5. **RESPONSE FIDELITY**: Ensure response examples match the schema.
6. **JSON ONLY**: Return ONLY valid JSON. No markdown blocks.`;

  // User request message
  messages.push({
    role: 'user',
    content: `## Your Task\n\n${contextInstructions}`,
  });

  return messages;
}

/**
 * Validates that a response from OpenRouter is valid JSON
 * 
 * @param response - The response string from OpenRouter
 * @returns Parsed JSON if valid
 * @throws AppError if JSON is invalid
 */
export function validateJsonResponse(response: string): MockAPIOutput {
  try {
    const parsed = JSON.parse(response) as MockAPIOutput;
    
    // Basic structure validation
    if (!parsed.endpoints || !Array.isArray(parsed.endpoints)) {
      throw new Error('Missing or invalid "endpoints" array');
    }

    return parsed;
  } catch (error) {
    throw new AppError(
      `Invalid JSON response from AI: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Extracts the mock API specification from an OpenRouter response
 * 
 * @param responseContent - The content string from OpenRouter response
 * @returns Validated mock API output
 * @throws AppError if response is not valid JSON
 */
export function extractMockAPIFromResponse(
  responseContent: string
): MockAPIOutput {
  // Try to extract JSON if wrapped in markdown code blocks
  let jsonString = responseContent;
  const jsonMatch = responseContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonString = jsonMatch[1].trim();
  }

  return validateJsonResponse(jsonString);
}
