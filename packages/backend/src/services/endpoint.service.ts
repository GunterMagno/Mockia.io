import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { ProjectModel } from '../models/Project.js';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

/**
 * Service to manage mock API endpoints
 * Moves database and business logic away from the controller
 */

interface UpdateEndpointData {
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description?: string;
  requestSchema?: any;
  responseBody?: any;
  statusCode?: number;
}

interface CreateEndpointData {
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description?: string;
}

/**
 * Verify if user has owner or editor role in a project
 */
function verifyPermissions(project: any, userId: string, errorMessage: string): void {
  const member = project.members.find((m: any) => m.userId.toString() === userId);
  const userRole = member?.role?.toUpperCase();

  if (userRole !== 'OWNER' && userRole !== 'EDITOR') {
    throw new AppError(
      errorMessage,
      ErrorCode.FORBIDDEN,
      403
    );
  }
}

/**
 * Update an existing endpoint configuration and its default response
 */
export async function updateEndpoint(
  endpointId: string,
  userId: string,
  data: UpdateEndpointData
) {
  const endpoint = await EndpointModel.findById(endpointId).populate({
    path: 'mockApiId',
    populate: { path: 'projectId' }
  });

  if (!endpoint) {
    throw new AppError('Endpoint not found', ErrorCode.NOT_FOUND, 404);
  }

  const mockApi = endpoint.mockApiId as any;
  const project = mockApi?.projectId;

  if (!project || !userId) {
    throw new AppError('Project context not found', ErrorCode.VALIDATION_ERROR, 403);
  }

  // 1. Verify project permissions
  verifyPermissions(project, userId, 'Only owners and editors can modify endpoints');

  // 2. Check for duplicates if path or method is changing
  if (data.path || data.method) {
    const targetPath = data.path || endpoint.path;
    const targetMethod = data.method || endpoint.method;

    const duplicate = await EndpointModel.findOne({
      mockApiId: endpoint.mockApiId,
      path: targetPath,
      method: targetMethod,
      _id: { $ne: endpointId }
    });

    if (duplicate) {
      throw new AppError(
        `An endpoint with path "${targetPath}" and method "${targetMethod}" already exists in this project.`,
        ErrorCode.VALIDATION_ERROR,
        400
      );
    }
  }

  // 3. Apply updates to the Endpoint doc
  if (data.path) endpoint.path = data.path;
  if (data.method) endpoint.method = data.method;
  if (data.description !== undefined) endpoint.description = data.description;
  if (data.requestSchema !== undefined) endpoint.requestSchema = data.requestSchema;

  // 4. Update or create associated response doc
  if (data.responseBody !== undefined || data.statusCode !== undefined) {
    let responseDoc;

    if (endpoint.responses && endpoint.responses.length > 0) {
      responseDoc = await ResponseModel.findById(endpoint.responses[0]);
    }

    if (!responseDoc) {
      responseDoc = new ResponseModel({
        statusCode: data.statusCode || 200,
        description: 'Default response',
        schema: data.responseBody || {}
      });
      await responseDoc.save();
      endpoint.responses = [responseDoc._id as any];
    } else {
      if (data.statusCode !== undefined) responseDoc.statusCode = data.statusCode;
      if (data.responseBody !== undefined) {
        responseDoc.schema = data.responseBody;
        responseDoc.examples = [data.responseBody];
      }
      await responseDoc.save();
    }
  }

  await endpoint.save();
  return endpoint;
}

/**
 * Create a new endpoint with unique path and default 200 response
 */
export async function createEndpoint(
  projectSlug: string,
  userId: string,
  data: CreateEndpointData
) {
  let project;
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectSlug);
  if (isValidObjectId) {
    project = await ProjectModel.findById(projectSlug);
  }
  if (!project) {
    project = await ProjectModel.findOne({ slug: projectSlug });
  }

  if (!project) {
    throw new AppError('Project not found', ErrorCode.NOT_FOUND, 404);
  }

  // 1. Verify project permissions
  verifyPermissions(project, userId, 'Only owners and editors can create endpoints');

  // 2. Find or create MockAPI for this project
  let mockAPI = await MockAPIModel.findOne({ projectId: project._id });
  if (!mockAPI) {
    mockAPI = new MockAPIModel({
      projectId: project._id,
      title: project.title,
      description: project.description || 'Mock API',
      apiVersion: '1.0.0',
      endpoints: []
    });
    await mockAPI.save();
  }

  // 3. Create default Response document
  const responseDoc = new ResponseModel({
    statusCode: 200,
    description: 'Default response',
    schema: {}
  });
  await responseDoc.save();

  // 4. Calculate a unique path if duplicates exist
  const baseDefaultPath = '/new-endpoint';
  const defaultMethod = data.method || 'GET';
  let uniquePath = data.path || baseDefaultPath;

  const existingEndpoints = await EndpointModel.find({
    mockApiId: mockAPI._id,
    method: defaultMethod
  });

  const paths = existingEndpoints.map(e => e.path);

  if (paths.includes(uniquePath)) {
    let counter = 1;
    const basePath = data.path || baseDefaultPath;
    while (paths.includes(`${basePath}-${counter}`)) {
      counter++;
    }
    uniquePath = `${basePath}-${counter}`;
  }

  // 5. Create and save new Endpoint document
  const endpoint = new EndpointModel({
    path: uniquePath,
    method: defaultMethod,
    description: data.description || '',
    requestSchema: {},
    responses: [responseDoc._id],
    mockApiId: mockAPI._id
  });
  await endpoint.save();

  // 6. Push reference to MockAPI
  mockAPI.endpoints.push(endpoint._id as any);
  await mockAPI.save();

  // Populate responses before returning
  await endpoint.populate('responses');

  return endpoint;
}

/**
 * Delete a specific endpoint and all its associated responses
 */
export async function deleteEndpoint(
  endpointId: string,
  userId: string
) {
  const endpoint = await EndpointModel.findById(endpointId).populate({
    path: 'mockApiId',
    populate: { path: 'projectId' }
  });

  if (!endpoint) {
    throw new AppError('Endpoint not found', ErrorCode.NOT_FOUND, 404);
  }

  const mockApi = endpoint.mockApiId as any;
  const project = mockApi?.projectId;

  if (!project || !userId) {
    throw new AppError('Project context not found', ErrorCode.VALIDATION_ERROR, 403);
  }

  // 1. Verify project permissions
  verifyPermissions(project, userId, 'Only owners and editors can delete endpoints');

  // 2. Delete associated responses
  if (endpoint.responses && endpoint.responses.length > 0) {
    await ResponseModel.deleteMany({ _id: { $in: endpoint.responses } });
  }

  // 3. Remove reference from MockAPI
  if (mockApi) {
    mockApi.endpoints = mockApi.endpoints.filter((eId: any) => eId.toString() !== endpointId);
    await mockApi.save();
  }

  // 4. Delete the endpoint document itself
  await EndpointModel.findByIdAndDelete(endpointId);

  return { success: true };
}
