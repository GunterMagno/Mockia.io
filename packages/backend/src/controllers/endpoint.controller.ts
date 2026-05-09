import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken';
import { asyncHandler } from '../middlewares/errorHandler';
import { EndpointModel } from '../models/MockAPI';

export const updateEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { path, method, description, requestSchema, responseBody, statusCode } = req.body;

    const endpoint = await EndpointModel.findById(id);
    if (!endpoint) {
      res.status(404).json({ success: false, error: { message: 'Endpoint not found' } });
      return;
    }

    if (path) endpoint.path = path;
    if (method) endpoint.method = method;
    if (description !== undefined) endpoint.description = description;
    if (requestSchema !== undefined) endpoint.requestSchema = requestSchema;

    // Handle response updates
    if (responseBody !== undefined || statusCode !== undefined) {
      const { ResponseModel } = await import('../models/MockAPI');
      let responseDoc;
      
      if (endpoint.responses && endpoint.responses.length > 0) {
        responseDoc = await ResponseModel.findById(endpoint.responses[0]);
      }
      
      if (!responseDoc) {
        responseDoc = new ResponseModel({
          statusCode: statusCode || 200,
          description: 'Default response',
          schema: responseBody || {}
        });
        await responseDoc.save();
        endpoint.responses = [responseDoc._id];
      } else {
        if (statusCode !== undefined) responseDoc.statusCode = statusCode;
        if (responseBody !== undefined) responseDoc.schema = responseBody;
        await responseDoc.save();
      }
    }

    await endpoint.save();

    res.status(200).json({
      success: true,
      data: endpoint,
    });
  }
);

export const createEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { projectSlug } = req.params;
    const { path, method, description } = req.body;

    const { ProjectModel } = await import('../models/Project');
    const { MockAPIModel, ResponseModel } = await import('../models/MockAPI');

    const project = await ProjectModel.findOne({ slug: projectSlug });
    if (!project) {
      res.status(404).json({ success: false, error: { message: 'Project not found' } });
      return;
    }

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

    const responseDoc = new ResponseModel({
      statusCode: 200,
      description: 'Default response',
      schema: {}
    });
    await responseDoc.save();

    const endpoint = new EndpointModel({
      path: path || '/new-endpoint',
      method: method || 'GET',
      description: description || '',
      requestSchema: {},
      responses: [responseDoc._id],
      mockApiId: mockAPI._id
    });
    await endpoint.save();

    mockAPI.endpoints.push(endpoint._id as any);
    await mockAPI.save();

    // Populate responses before returning so frontend gets the full object
    await endpoint.populate('responses');

    res.status(201).json({
      success: true,
      data: endpoint,
    });
  }
);
