/**
 * Prompt Building Service for Mockia AI
 * 
 * Orchestrates the construction of prompts by combining:
 * - System prompt (role and rules)
 * - GitHub repository context
 * - User input and requirements
 */

import { SYSTEM_PROMPT } from './systemPrompt';
import { getProjectContext } from '../../services/github-context.service';
import { buildSampleData, formatSampleDataForPrompt } from './fakeDataProvider';
import { ProjectModel } from '../../models/Project';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode, type MockAPIOutput } from '@mockia/shared';
import type { OpenRouterMessage } from '../../types/ai';

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
 * 
 * @param context - Raw GitHub context data
 * @returns Formatted context string
 */
function formatGitHubContext(context: any): string {
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

  // File structure
  if (context.files && context.files.length > 0) {
    sections.push(`\n## Code Structure\n`);

    // Group files by type
    const filesByType = {
      typescript: context.files.filter((f: any) => f.type === 'typescript'),
      swagger: context.files.filter((f: any) => f.type === 'swagger'),
      other: context.files.filter((f: any) => f.type === 'other'),
    };

    if (filesByType.typescript.length > 0) {
      sections.push(`### TypeScript Files`);
      filesByType.typescript.forEach((file: any) => {
        sections.push(`- ${file.path}`);
        if (file.summary) {
          sections.push(`  Summary: ${file.summary}`);
        }
        if (file.interfaces && file.interfaces.length > 0) {
          sections.push(`  Interfaces:`);
          file.interfaces.forEach((i: any) => {
            sections.push(`    interface ${i.name} { ${i.properties.join('; ')} }`);
          });
        }
        if (file.typeAliases && file.typeAliases.length > 0) {
          sections.push(`  Types:`);
          file.typeAliases.forEach((t: any) => {
            sections.push(`    type ${t.name} = ${t.type}`);
          });
        }
        if (file.enums && file.enums.length > 0) {
          sections.push(`  Enums:`);
          file.enums.forEach((e: any) => {
            sections.push(`    enum ${e.name} { ${e.members.join(', ')} }`);
          });
        }
        if (file.functions && file.functions.length > 0) {
          sections.push(`  Functions:`);
          file.functions.forEach((f: any) => {
            sections.push(`    ${f.name}(${f.params.join(', ')}): ${f.returnType}`);
          });
        }
      });
    }

    if (filesByType.swagger.length > 0) {
      sections.push(`\n### OpenAPI/Swagger Files`);
      filesByType.swagger.forEach((file: any) => {
        sections.push(`- ${file.path}`);
        if (file.summary) {
          sections.push(`  ${file.summary}`);
        }
      });
    }

    if (filesByType.typescript.length > 0) {
      sections.push(`\n### Routes`);
      filesByType.typescript.forEach((file: any) => {
        if (file.routes && file.routes.length > 0) {
          file.routes.forEach((route: any) => {
            sections.push(`- ${route.methods.join(',')} ${route.path}`);
          });
        }
      });
    }
  }

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

  // Load GitHub context
  let contextString = '';
  try {
    const context = await getProjectContext(realProjectId);
    contextString = formatGitHubContext(context);
  } catch (error) {
    // Context might not exist yet, proceed with empty context
    console.warn(`No GitHub context found for project ${realProjectId}`);
    contextString = `## Project: ${project.title}\nNo GitHub context available yet.`;
  }

  // Truncate context to fit budget
  const contextBudget =
    options?.contextBudgetOverride || TOKEN_LIMITS.contextBudget;
  const truncatedContext = truncateContext(contextString, contextBudget);

  // Build sample data for prompt injection (DISABLED to avoid bias)
  /*
  const sampleData = buildSampleData({
    userCount: 3,
    productCount: 4,
    orderCount: 2,
  });
  const sampleDataSection = formatSampleDataForPrompt(sampleData);
  */

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

  /*
  // Sample data message
  messages.push({
    role: 'user',
    content: sampleDataSection,
  });
  */

  // User request message
  messages.push({
    role: 'user',
    content: `## Your Task

Based EXCLUSIVELY on the actual TypeScript interfaces, routes, and data models found in the repository context provided above, generate a comprehensive mock API specification for the following requirement:

${userInput}

Rules for EXCELLENCE:
1. **IDENTIFY THE CORE**: First, identify the primary purpose of the application (e.g., if it's a restaurant app, the "heart" is the menu and dishes, not just users). Prioritize endpoints for these core entities.
2. **USE EXACT TYPES**: Use the EXACT property names and types from the repository's interfaces.
3. **LOGICAL ENDPOINTS**: Generate between 5 and 10 logical endpoints. Quality over quantity.
4. **REALISTIC MOCK DATA**: Include RICH, REALISTIC MOCK DATA in the examples (e.g., actual dish names like "Spaghetti Carbonara", realistic prices, valid IDs) that a frontend developer can use directly.
5. **NO GENERIC BIAS**: DO NOT generate generic "orders" or "products" unless they are explicitly present in the repository context.
6. **RESPONSE FIDELITY**: Ensure response examples match the schema and are realistic but concise.
7. **JSON ONLY**: Return ONLY valid JSON. No markdown blocks.`,
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
