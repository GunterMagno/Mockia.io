import { buildPrompt, validateJsonResponse, extractMockAPIFromResponse } from '../modules/ai/prompt.service.js';
import { ProjectModel } from '../models/Project.js';
import { getProjectContext } from '../services/github-context.service.js';
import { AppError } from '../middlewares/errorHandler.js';

jest.mock('../models/Project');
jest.mock('../services/github-context.service');

describe('AI Prompt Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildPrompt', () => {
    const mockProject = { _id: '123456789012345678901234', title: 'Test Project', slug: 'test-project' };

    it('should build a prompt with GitHub context', async () => {
      const mockContext = {
        repoName: 'test-repo',
        repoUrl: 'https://github.com/test/repo',
        repoOwner: 'test',
        summary: 'A test repo',
        branch: 'main',
        stats: { totalFiles: 1, totalInterfaces: 1 },
        files: [
          {
            path: 'src/types.ts',
            type: 'typescript',
            summary: 'Core types',
            interfaces: [{ name: 'User', properties: ['id: string', 'name: string'] }],
            typeAliases: [{ name: 'ID', type: 'string' }],
            enums: [{ name: 'Role', members: ['ADMIN', 'USER'] }],
            functions: [{ name: 'getUser', params: ['id: string'], returnType: 'User' }],
            routes: [{ methods: ['GET'], path: '/api/users' }]
          },
          {
            path: 'swagger.yaml',
            type: 'swagger',
            summary: 'API Spec'
          }
        ]
      } as any;

      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (getProjectContext as jest.Mock).mockResolvedValue(mockContext);

      const messages = await buildPrompt('123456789012345678901234', 'Generate users API');

      expect(messages).toHaveLength(3); // System, Context, Task
      expect(messages[1].content).toContain('test-repo');
      expect(messages[1].content).toContain('interface User');
      expect(messages[1].content).toContain('Branch: main');
    });

    it('should truncate long context', async () => {
      const longString = 'a'.repeat(30000); // Exceeds default budget (6000 * 4 = 24000 chars)
      const mockContext = {
        repoName: 'test-repo',
        summary: longString,
        stats: { totalFiles: 1 },
        files: []
      } as any;

      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (getProjectContext as jest.Mock).mockResolvedValue(mockContext);

      const messages = await buildPrompt(mockProject._id, 'test');
      expect(messages[1].content).toContain('[Context truncated due to length]');
    });

    it('should build prompt without system message if requested', async () => {
      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (getProjectContext as jest.Mock).mockResolvedValue({});

      const messages = await buildPrompt(mockProject._id, 'test', { includeSystemPrompt: false });
      expect(messages[0].role).not.toBe('system');
    });

    it('should throw 404 if project not found', async () => {
      (ProjectModel.findById as jest.Mock).mockResolvedValue(null);
      (ProjectModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(buildPrompt('wrong', 'test')).rejects.toThrow(AppError);
    });

    it('should handle missing GitHub context gracefully', async () => {
      (ProjectModel.findById as jest.Mock).mockResolvedValue(mockProject);
      (getProjectContext as jest.Mock).mockRejectedValue(new Error('Not found'));

      const messages = await buildPrompt(mockProject._id, 'test');
      expect(messages[1].content).toContain('No GitHub context available yet');
    });
  });

  describe('validateJsonResponse', () => {
    it('should parse valid JSON', () => {
      const validJson = JSON.stringify({ endpoints: [] });
      const result = validateJsonResponse(validJson);
      expect(result).toEqual({ endpoints: [] });
    });

    it('should throw AppError for invalid JSON', () => {
      expect(() => validateJsonResponse('invalid')).toThrow(AppError);
    });

    it('should throw AppError if endpoints array is missing', () => {
      expect(() => validateJsonResponse('{}')).toThrow('Missing or invalid "endpoints" array');
    });
  });

  describe('extractMockAPIFromResponse', () => {
    it('should extract JSON from markdown code blocks', () => {
      const content = 'Here is your API:\n```json\n{"endpoints": []}\n```\nEnjoy!';
      const result = extractMockAPIFromResponse(content);
      expect(result).toEqual({ endpoints: [] });
    });

    it('should parse raw JSON string', () => {
      const content = '{"endpoints": []}';
      const result = extractMockAPIFromResponse(content);
      expect(result).toEqual({ endpoints: [] });
    });
  });
});
