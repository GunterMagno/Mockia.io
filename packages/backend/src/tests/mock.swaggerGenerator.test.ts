import { generateSwaggerForProject } from '../modules/mock/swaggerGenerator.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel } from '../models/MockAPI.js';
import * as mockPopulationService from '../modules/mock/mockPopulation.service.js';
import { Types } from 'mongoose';

jest.mock('../models/Project');
jest.mock('../models/MockAPI');
jest.mock('../modules/mock/mockPopulation.service');

describe('Swagger Generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateSwaggerForProject', () => {
    it('should generate swagger spec for project endpoints', async () => {
      const projectId = new Types.ObjectId().toString();
      const mockProject = { title: 'Test API', description: 'Desc' };
      const mockApi = { _id: new Types.ObjectId() };
      const mockEndpoints = [
        {
          path: '/users/:id',
          method: 'GET',
          description: 'Get user',
          responses: [{ statusCode: 200, schema: { type: 'object' } }]
        }
      ];

      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      jest.spyOn(mockPopulationService, 'getEndpointsForMockAPI').mockResolvedValue(mockEndpoints as any);

      const swagger = await generateSwaggerForProject(projectId);

      expect(swagger.openapi).toBe('3.0.0');
      expect(swagger.info.title).toBe('Test API API');
      expect(swagger.paths).toHaveProperty('/users/{id}');
      expect(swagger.paths['/users/{id}']).toHaveProperty('get');
    });

    it('should throw an error for invalid projectId', async () => {
      await expect(generateSwaggerForProject('invalid')).rejects.toThrow('Invalid projectId');
    });

    it('should throw if project not found', async () => {
      const projectId = new Types.ObjectId().toString();
      (ProjectModel.findById as jest.Mock).mockResolvedValue(null);
      await expect(generateSwaggerForProject(projectId)).rejects.toThrow('Project not found');
    });

    it('should handle endpoints with no responses and endpoints with requestSchema', async () => {
      const projectId = new Types.ObjectId().toString();
      const mockProject = { title: 'Test API', description: 'Desc' };
      const mockApi = { _id: new Types.ObjectId() };
      const mockEndpoints = [
        {
          path: '/posts',
          method: 'POST',
          description: 'Create post',
          responses: [], // Test line 58
          requestSchema: { type: 'object', properties: { title: { type: 'string' } } } // Test line 74
        }
      ];

      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      jest.spyOn(mockPopulationService, 'getEndpointsForMockAPI').mockResolvedValue(mockEndpoints as any);

      const swagger = await generateSwaggerForProject(projectId);
      
      expect(swagger.paths['/posts'].post.responses).toHaveProperty('200');
      expect(swagger.paths['/posts'].post).toHaveProperty('requestBody');
    });
  });
});
