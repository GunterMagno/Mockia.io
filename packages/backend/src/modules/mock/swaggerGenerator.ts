import { MockAPIModel } from '../../models/MockAPI';
import { ProjectModel } from '../../models/Project';
import { getEndpointsForMockAPI } from './mockPopulation.service';
import { Types } from 'mongoose';

/**
 * Generate a OpenAPI 3.0 specification for a given project.
 * @param projectId - MongoDB ObjectId string of the project
 */
export async function generateSwaggerForProject(projectId: string) {
  // Basic validation
  if (!projectId || !Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid projectId');
  }

  // Load project to attach metadata
  const project = await ProjectModel.findById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  // Find the MockAPI for this project
  const mockApi = await MockAPIModel.findOne({ projectId: new Types.ObjectId(projectId) });
  let endpoints: any[] = [];
  if (mockApi) {
    endpoints = await getEndpointsForMockAPI(mockApi._id.toString());
  }

  // Build OpenAPI paths: convert Express style ':param' to '{param}'
  const paths: Record<string, any> = {};

  const addPath = (path: string, method: string, operation: any) => {
    const openapiPath = path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    if (!paths[openapiPath]) paths[openapiPath] = {};
    paths[openapiPath][method.toLowerCase()] = operation;
  };

  // Iterate endpoints to populate operations
  for (const ep of endpoints) {
    // Resolve responses
    const responses = (ep.responses || []) as any[];
    const responsesObj: Record<string, any> = {};
    if (responses.length > 0) {
      for (const resp of responses) {
        const statusCode = (resp.statusCode ?? 200).toString();
        const description = resp.description ?? 'Response';
        const schema = resp.schema ?? { type: 'object' };
        responsesObj[statusCode] = {
          description,
          content: {
            'application/json': {
              schema,
            },
          },
        };
      }
    } else {
      responsesObj['200'] = {
        description: 'Default response',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      };
    }

    const operation: any = {
      summary: ep.description,
      responses: responsesObj,
    };

    if (ep.requestSchema && Object.keys(ep.requestSchema).length > 0) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: ep.requestSchema,
          },
        },
      };
    }

    addPath(ep.path, ep.method, operation);
  }

  const swagger = {
    openapi: '3.0.0',
    info: {
      title: project.title ? `${project.title} API` : 'API',
      version: '1.0.0',
      description: project.description ?? '',
    },
    paths,
    components: {
      schemas: {},
    },
  } as any;

  return swagger;
}
