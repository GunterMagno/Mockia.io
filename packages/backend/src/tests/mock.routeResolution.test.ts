import { resolveRoute, getProjectEndpoints } from '../modules/mock/routeResolution.service.js';
import { ProjectModel } from '../models/Project.js';
import { MockAPIModel, EndpointModel } from '../models/MockAPI.js';
import { AppError } from '../middlewares/errorHandler.js';
import { mockCache } from '../modules/mock/mockCache.service.js';

jest.mock('../models/Project');
jest.mock('../models/MockAPI', () => ({
  MockAPIModel: { findOne: jest.fn() },
  EndpointModel: { find: jest.fn() }
}));

describe('Route Resolution Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.clearAll();
  });

  describe('resolveRoute', () => {
    const mockProject = { _id: '123456789012345678901234', slug: 'my-project' };
    const mockApi = { _id: 'api-123' };

    it('should resolve a static route', async () => {
      const mockEndpoints = [
        { 
          path: '/users', 
          method: 'GET'
        },
        { path: '/users/:id', method: 'GET' }
      ];

      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue(mockEndpoints);

      const result = await resolveRoute('my-project', 'GET', '/users');

      expect(result).not.toBeNull();
      expect(result?.endpoint.path).toBe('/users');
    });

    it('should resolve by ID if slug is a valid ObjectId', async () => {
      const id = '123456789012345678901234';
      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue([{ path: '/', method: 'GET' }]);

      await resolveRoute(id, 'GET', '/');

      expect(ProjectModel.findById).toHaveBeenCalledWith(id);
    });

    it('should throw 404 if project not found', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(resolveRoute('wrong', 'GET', '/')).rejects.toThrow(AppError);
    });

    it('should throw 404 if MockAPI not found', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(resolveRoute('my-project', 'GET', '/')).rejects.toThrow(AppError);
    });

    it('should return null if no endpoints found for method', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue([]);

      const result = await resolveRoute('my-project', 'POST', '/');
      expect(result).toBeNull();
    });

    it('should sort wildcard routes by specificity', async () => {
      const mockEndpoints = [
        { path: '/users/:id/posts/:postId', method: 'GET' },
        { path: '/users/:id', method: 'GET' }
      ];

      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue(mockEndpoints);

      const result = await resolveRoute('my-project', 'GET', '/users/123/posts/456');
      expect(result?.endpoint.path).toBe('/users/:id/posts/:postId');
    });

    it('should sort static routes by specificity', async () => {
      const mockEndpoints = [
        { path: '/a/b', method: 'GET' },
        { path: '/a/b/c', method: 'GET' }
      ];
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue(mockEndpoints);

      const result = await resolveRoute('my-project', 'GET', '/a/b/c');
      expect(result?.endpoint.path).toBe('/a/b/c');
    });

    it('should handle generic errors', async () => {
      (ProjectModel.findOne as jest.Mock).mockRejectedValue(new Error('DB Error'));
      await expect(resolveRoute('my-project', 'GET', '/')).rejects.toThrow('Failed to resolve route');
    });
  });

  describe('getProjectEndpoints', () => {
    const mockProject = { _id: '123456789012345678901234', slug: 'my-project' };
    const mockApi = { _id: 'api-123' };

    it('should return all endpoints for a project by ID', async () => {
      const id = '123456789012345678901234';
      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue([{ path: '/test', method: 'GET' }])
      };
      (EndpointModel.find as jest.Mock).mockReturnValue(mockFind);

      await getProjectEndpoints(id);
      expect(ProjectModel.findById).toHaveBeenCalledWith(id);
    });

    it('should filter by method in getProjectEndpoints', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue([])
      };
      (EndpointModel.find as jest.Mock).mockReturnValue(mockFind);

      await getProjectEndpoints('my-project', 'GET');
      expect(EndpointModel.find).toHaveBeenCalledWith({ mockApiId: 'api-123', method: 'GET' });
    });

    it('should handle AppError in getProjectEndpoints', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(null);
      await expect(getProjectEndpoints('my-project')).rejects.toThrow(AppError);
    });

    it('should throw if MockAPI is missing in getProjectEndpoints', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(null);
      await expect(getProjectEndpoints('my-project')).rejects.toThrow('No Mock API found');
    });

    it('should return null if route reaches end of resolveRoute', async () => {
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(mockProject);
      (MockAPIModel.findOne as jest.Mock).mockResolvedValue(mockApi);
      (EndpointModel.find as jest.Mock).mockResolvedValue([{ path: '/other', method: 'GET' }]);
      const result = await resolveRoute('my-project', 'GET', '/nomatch');
      expect(result).toBeNull();
    });
  });
});
