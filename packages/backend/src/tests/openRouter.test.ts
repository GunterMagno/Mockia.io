import axios from 'axios';
import { 
  sleep, 
  calculateBackoffDelay, 
  callOpenRouterWithRetry, 
  generateWithOpenRouter 
} from '../services/openRouter.service.js';
import * as aiConfig from '../config/ai.js';
import { AppError } from '../middlewares/errorHandler.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OpenRouter Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(aiConfig, 'getOpenRouterApiKey').mockReturnValue('test-key');
    jest.spyOn(aiConfig, 'getOpenRouterModel').mockReturnValue('test-model');
    jest.spyOn(aiConfig, 'getOpenRouterBaseUrl').mockReturnValue('https://api.test');
    // Speed up tests by mocking sleep
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => cb());
  });

  describe('sleep', () => {
    it('should resolve after timeout', async () => {
      const promise = sleep(10);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should increase delay exponentially', () => {
      const base = 1000;
      const max = 30000;
      
      const delay0 = calculateBackoffDelay(0, base, max);
      const delay1 = calculateBackoffDelay(1, base, max);
      const delay2 = calculateBackoffDelay(2, base, max);
      
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeGreaterThanOrEqual(4000);
    });

    it('should cap delay at maxDelayMs', () => {
      const delay = calculateBackoffDelay(10, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(6000); // 5000 + 20% jitter
    });
  });

  describe('callOpenRouterWithRetry', () => {
    const mockMessages = [{ role: 'user', content: 'hello' }] as any;

    it('should return data on successful first attempt', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { id: '123', choices: [] } });

      const result = await callOpenRouterWithRetry(mockMessages);

      expect(result).toEqual({ id: '123', choices: [] });
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 error and eventually succeed', async () => {
      const error429 = { response: { status: 429 } };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.post
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ data: { id: 'success' } });

      const result = await callOpenRouterWithRetry(mockMessages);

      expect(result).toEqual({ id: 'success' });
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should throw AppError if max retries reached', async () => {
      const error503 = { response: { status: 503 }, message: 'Unavailable' };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(error503);

      await expect(callOpenRouterWithRetry(mockMessages)).rejects.toThrow(AppError);
      // Default maxRetries is 3
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should handle token limit error by reducing max_tokens', async () => {
      const tokenError = { 
        response: { 
          status: 400, 
          data: { error: { message: 'requires more credits, or fewer max_tokens. can only afford 500' } } 
        } 
      };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.post
        .mockRejectedValueOnce(tokenError)
        .mockResolvedValueOnce({ data: { id: 'success' } });

      const result = await callOpenRouterWithRetry(mockMessages, { max_tokens: 1000 });

      expect(result).toEqual({ id: 'success' });
      // Verify second call used reduced tokens
      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ max_tokens: 500 }),
        expect.any(Object)
      );
    });

    it('should throw immediately on non-retryable error', async () => {
      const error400 = { response: { status: 400, data: { error: { message: 'Bad request' } } } };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(error400);

      await expect(callOpenRouterWithRetry(mockMessages)).rejects.toThrow('OpenRouter API error: Bad request');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('should throw authentication error on 401', async () => {
      const error401 = { response: { status: 401 } };
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.post.mockRejectedValue(error401);

      await expect(callOpenRouterWithRetry(mockMessages)).rejects.toThrow('OpenRouter API authentication failed');
    });

    it('should handle generic non-axios errors', async () => {
      mockedAxios.isAxiosError.mockReturnValue(false);
      mockedAxios.post.mockRejectedValue(new Error('Fatal'));

      await expect(callOpenRouterWithRetry(mockMessages)).rejects.toThrow('OpenRouter API error: Fatal');
    });
  });

  describe('generateWithOpenRouter', () => {
    it('should extract content from the first choice', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Generated text' } }]
      };
      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

      const result = await generateWithOpenRouter('system prompt', 'user message');

      expect(result).toBe('Generated text');
    });

    it('should throw error if no choices returned', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { choices: [] } });

      await expect(generateWithOpenRouter('s', 'u')).rejects.toThrow('No response received');
    });
  });
});
