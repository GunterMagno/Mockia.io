import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authenticateToken.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { EndpointModel } from '../models/MockAPI.js';

export const updateEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { path, method, description, requestSchema, responseBody, statusCode } = req.body;

    const endpoint = await EndpointModel.findById(id).populate({
      path: 'mockApiId',
      populate: { path: 'projectId' }
    });
    
    if (!endpoint) {
      res.status(404).json({ success: false, error: { message: 'Endpoint not found' } });
      return;
    }

    // Check permissions
    const mockApi = endpoint.mockApiId as any;
    const project = mockApi?.projectId;
    const userId = req.user?.id;

    if (!project || !userId) {
      res.status(403).json({ success: false, error: { message: 'Project context not found' } });
      return;
    }

    const member = project.members.find((m: any) => m.userId.toString() === userId);
    const userRole = member?.role?.toUpperCase();
    
    if (userRole !== 'OWNER' && userRole !== 'EDITOR') {
      res.status(403).json({ success: false, error: { message: 'Only owners and editors can modify endpoints' } });
      return;
    }

    // Check for duplicates
    if (path || method) {
      const targetPath = path || endpoint.path;
      const targetMethod = method || endpoint.method;

      const duplicate = await EndpointModel.findOne({
        mockApiId: endpoint.mockApiId,
        path: targetPath,
        method: targetMethod,
        _id: { $ne: id } // Exclude current endpoint
      });

      if (duplicate) {
        res.status(400).json({ 
          success: false, 
          error: { 
            message: `An endpoint with path "${targetPath}" and method "${targetMethod}" already exists in this project.` 
          } 
        });
        return;
      }
    }

    if (path) endpoint.path = path;
    if (method) endpoint.method = method;
    if (description !== undefined) endpoint.description = description;
    if (requestSchema !== undefined) endpoint.requestSchema = requestSchema;

    // Handle response updates
    if (responseBody !== undefined || statusCode !== undefined) {
      const { ResponseModel } = await import('../models/MockAPI.js');
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
        if (responseBody !== undefined) {
          responseDoc.schema = responseBody;
          responseDoc.examples = [responseBody];
        }
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

    const { ProjectModel } = await import('../models/Project.js');
    const { MockAPIModel, ResponseModel } = await import('../models/MockAPI.js');

    let project;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectSlug);
    if (isValidObjectId) {
      project = await ProjectModel.findById(projectSlug);
    }
    if (!project) {
      project = await ProjectModel.findOne({ slug: projectSlug });
    }

    if (!project) {
      res.status(404).json({ success: false, error: { message: 'Project not found' } });
      return;
    }

    // Check permissions
    const userId = req.user?.id;
    const member = project.members.find((m: any) => m.userId.toString() === userId);
    const userRole = member?.role?.toUpperCase();

    if (userRole !== 'OWNER' && userRole !== 'EDITOR') {
      res.status(403).json({ success: false, error: { message: 'Only owners and editors can create endpoints' } });
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

    const baseDefaultPath = '/new-endpoint';
    const defaultMethod = method || 'GET';
    let uniquePath = path || baseDefaultPath;
    
    // Check if we need to find a unique path
    // We query ALL endpoints for this MockAPI to find the next available path-counter
    const existingEndpoints = await EndpointModel.find({ 
      mockApiId: mockAPI._id,
      method: defaultMethod
    });

    const paths = existingEndpoints.map(e => e.path);
    
    if (paths.includes(uniquePath)) {
      let counter = 1;
      // If the path is precisely '/new-endpoint', we try '/new-endpoint-1', etc.
      // If it's something else, we try 'path-1', etc.
      const basePath = path || baseDefaultPath;
      while (paths.includes(`${basePath}-${counter}`)) {
        counter++;
      }
      uniquePath = `${basePath}-${counter}`;
    }

    const endpoint = new EndpointModel({
      path: uniquePath,
      method: defaultMethod,
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

export const deleteEndpointHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const endpoint = await EndpointModel.findById(id).populate({
      path: 'mockApiId',
      populate: { path: 'projectId' }
    });
    
    if (!endpoint) {
      res.status(404).json({ success: false, error: { message: 'Endpoint not found' } });
      return;
    }

    // Check permissions
    const mockApi = endpoint.mockApiId as any;
    const project = mockApi?.projectId;
    const userId = req.user?.id;

    if (!project || !userId) {
      res.status(403).json({ success: false, error: { message: 'Project context not found' } });
      return;
    }

    const member = project.members.find((m: any) => m.userId.toString() === userId);
    const userRole = member?.role?.toUpperCase();
    
    if (userRole !== 'OWNER' && userRole !== 'EDITOR') {
      res.status(403).json({ success: false, error: { message: 'Only owners and editors can delete endpoints' } });
      return;
    }

    // 1. Delete associated responses
    const { ResponseModel } = await import('../models/MockAPI.js');
    if (endpoint.responses && endpoint.responses.length > 0) {
      await ResponseModel.deleteMany({ _id: { $in: endpoint.responses } });
    }

    // 2. Remove reference from MockAPI
    mockApi.endpoints = mockApi.endpoints.filter((eId: any) => eId.toString() !== id);
    await mockApi.save();

    // 3. Delete the endpoint document
    await EndpointModel.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Endpoint deleted successfully'
    });
  }
);
