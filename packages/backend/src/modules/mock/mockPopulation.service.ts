/**
 * Mock Population Service
 * Handles saving generated endpoints and responses to MongoDB
 */

import { MockAPIOutput } from '@mockia/shared';
import { MockAPIModel, EndpointModel, ResponseModel } from '../../models/MockAPI';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import { Types } from 'mongoose';

/**
 * Converts OpenAPI format paths {paramName} to Express format :paramName
 * Example: /users/{id}/posts/{postId} -> /users/:id/posts/:postId
 */
function convertOpenAPIPathToExpress(path: string): string {
  return path.replace(/{([a-zA-Z_]\w*)}/g, ':$1');
}

/**
 * Population result metadata
 */
export interface PopulationResult {
  mockApiId: string;
  endpointsCreated: number;
  responsesCreated: number;
  timestamp: string;
}

/**
 * Populates the database with endpoints and responses from a generated API specification
 * 
 * Steps:
 * 1. Create or update MockAPI document
 * 2. Delete any existing endpoints for this MockAPI (to avoid duplicates)
 * 3. Create Endpoint documents for each endpoint in the specification
 * 4. Create Response documents for each endpoint's responses
 * 5. Link endpoints to MockAPI
 * 
 * @param projectId - The project ID this MockAPI belongs to
 * @param specification - The generated API specification from AI
 * @returns Metadata about what was created
 * @throws AppError if any database operation fails
 */
export async function populateEndpointsFromLLM(
  projectId: string,
  specification: MockAPIOutput
): Promise<PopulationResult> {
  try {

    // Resolve projectId if it's a slug
    let projectObjectId: Types.ObjectId;
    
    if (Types.ObjectId.isValid(projectId)) {
      projectObjectId = new Types.ObjectId(projectId);
    } else {
      // Try to find project by slug
      const { ProjectModel } = await import('../../models/Project');
      const project = await ProjectModel.findOne({ slug: projectId });
      if (!project) {
        throw new AppError(
          'Project not found (invalid ID or slug)',
          ErrorCode.NOT_FOUND,
          404
        );
      }
      projectObjectId = project._id as Types.ObjectId;
    }

    // 1. Find or create MockAPI document
    let mockApi = await MockAPIModel.findOne({ projectId: projectObjectId });

    if (mockApi) {
      // Update existing
      mockApi.title = specification.title;
      mockApi.description = specification.description;
      mockApi.apiVersion = specification.apiVersion;
      await mockApi.save();
      console.log('[PopulationService] ✓ MockAPI updated');
    } else {
      // Create new
      mockApi = new MockAPIModel({
        projectId: projectObjectId,
        title: specification.title,
        description: specification.description,
        apiVersion: specification.apiVersion,
        endpoints: [],
      });
      await mockApi.save();
      console.log('[PopulationService] ✓ MockAPI created');
    }

    // 2. [DEPRECATED] We no longer delete existing endpoints to allow appending
    // await EndpointModel.deleteMany({ mockApiId: mockApi._id });

    // 3. Track what we create
    let endpointsCreated = 0;
    let responsesCreated = 0;
    const endpointIds: Types.ObjectId[] = [...(mockApi.endpoints as Types.ObjectId[])];

    // 4. Create endpoints and their responses
    for (const endpointSpec of specification.endpoints) {
      // Convert OpenAPI format paths {paramName} to Express format :paramName
      const normalizedPath = convertOpenAPIPathToExpress(endpointSpec.path);
      // Create endpoint
      const endpoint = new EndpointModel({
        mockApiId: mockApi._id,
        path: normalizedPath,
        method: endpointSpec.method,
        description: endpointSpec.description,
        requestSchema: endpointSpec.requestSchema || {},
        responses: [],
      });
      const responseIds: Types.ObjectId[] = [];
      // Create responses for this endpoint
      if (endpointSpec.examples && endpointSpec.examples.length > 0) {
        for (const example of endpointSpec.examples) {
          const response = new ResponseModel({
            statusCode: extractStatusCode(example),
            description: `${endpointSpec.method} ${normalizedPath} response`,
            // Prefer the example response data over the abstract schema for usability
            schema: example.response || endpointSpec.responseSchema || {},
            examples: [example.response || {}],
          });
          await response.save();
          responseIds.push(response._id);
          responsesCreated++;
        }
      } else {
        // Create a default successful response
        const defaultResponse = new ResponseModel({
          statusCode: 200,
          description: `${endpointSpec.method} ${normalizedPath} successful response`,
          schema: endpointSpec.responseSchema || {},
          examples: [{}],
        });
        await defaultResponse.save();
        responseIds.push(defaultResponse._id);
        responsesCreated++;
      }
      // Link responses to endpoint
      endpoint.responses = responseIds;
      await endpoint.save();
      endpointIds.push(endpoint._id as Types.ObjectId);
      endpointsCreated++;
    }

    // 5. Update MockAPI with endpoint references (appended)
    mockApi.endpoints = endpointIds;
    await mockApi.save();
    console.log(`[PopulationService] ✓ All endpoints saved (${endpointsCreated})`);

    return {
      mockApiId: mockApi._id.toString(),
      endpointsCreated,
      responsesCreated,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[PopulationService] ✗ Error populating endpoints:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      `Failed to populate endpoints in database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Extracts HTTP status code from an example response
 * 
 * Looks for:
 * 1. Explicit statusCode field
 * 2. status field
 * 3. Defaults to 200 if not found
 * 
 * @param example - The example object from the API specification
 * @returns The HTTP status code
 */
function extractStatusCode(example: Record<string, unknown>): number {
  if (example.statusCode && typeof example.statusCode === 'number') {
    return example.statusCode;
  }

  if (example.status && typeof example.status === 'number') {
    return example.status;
  }

  // Default to 200 (OK)
  return 200;
}

/**
 * Deletes all endpoints and responses for a MockAPI
 * 
 * @param mockApiId - The ID of the MockAPI to delete from
 * @returns Number of endpoints deleted
 */
export async function deleteAllEndpointsForMockAPI(
  mockApiId: string
): Promise<number> {
  try {
    if (!Types.ObjectId.isValid(mockApiId)) {
      throw new AppError(
        'Invalid MockAPI ID format',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const objectId = new Types.ObjectId(mockApiId);

    // Get all endpoint IDs first
    const endpoints = await EndpointModel.find({ mockApiId: objectId });

    // Delete all responses for these endpoints
    for (const endpoint of endpoints) {
      await ResponseModel.deleteMany({ _id: { $in: endpoint.responses } });
    }

    // Delete all endpoints
    const result = await EndpointModel.deleteMany({ mockApiId: objectId });

    return result.deletedCount || 0;
  } catch (error) {
    console.error('Error deleting endpoints:', error);
    throw new AppError(
      'Failed to delete endpoints',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Retrieves all endpoints for a MockAPI
 * 
 * @param mockApiId - The ID of the MockAPI
 * @returns Array of endpoints with their responses
 */
export async function getEndpointsForMockAPI(mockApiId: string) {
  try {
    if (!Types.ObjectId.isValid(mockApiId)) {
      throw new AppError(
        'Invalid MockAPI ID format',
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }

    const endpoints = await EndpointModel.find({
      mockApiId: new Types.ObjectId(mockApiId),
    })
      .populate('responses')
      .sort({ createdAt: -1 });

    return endpoints;
  } catch (error) {
    console.error('Error retrieving endpoints:', error);
    throw new AppError(
      'Failed to retrieve endpoints',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}
