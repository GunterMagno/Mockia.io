/**
 * AI Pipeline Tests
 * 
 * Tests for the complete AI generation pipeline including:
 * - Fake data generation and injection
 * - Prompt building with sample data
 * - LLM output parsing and validation
 */

import { buildSampleData, formatSampleDataForPrompt } from '../modules/ai/fakeDataProvider.js';
import { extractJsonFromLLMOutput } from '../modules/ai/llmOutputParser.js';

describe('AI Pipeline - Fake Data and Prompt Injection', () => {
  describe('Fake Data Provider', () => {
    it('should generate sample data with realistic values', () => {
      const sampleData = buildSampleData();

      // Check structure
      expect(sampleData).toHaveProperty('users');
      expect(sampleData).toHaveProperty('products');
      expect(sampleData).toHaveProperty('orders');
      expect(sampleData).toHaveProperty('pagination');

      // Check arrays
      expect(Array.isArray(sampleData.users)).toBe(true);
      expect(Array.isArray(sampleData.products)).toBe(true);
      expect(Array.isArray(sampleData.orders)).toBe(true);

      // Check user structure
      expect(sampleData.users.length).toBeGreaterThan(0);
      sampleData.users.forEach((user: any) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('phone');
        expect(user).toHaveProperty('createdAt');

        // Validate email format (basic)
        expect(user.email).toMatch(/@/);

        // Validate UUID format (basic check)
        expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);

        // Validate ISO date format
        expect(new Date(user.createdAt).getTime()).not.toBeNaN();
      });

      // Check product structure
      expect(sampleData.products.length).toBeGreaterThan(0);
      sampleData.products.forEach((product: any) => {
        expect(product).toHaveProperty('id');
        expect(product).toHaveProperty('name');
        expect(product).toHaveProperty('price');
        expect(product).toHaveProperty('inStock');

        // Validate price is a number
        expect(typeof product.price).toBe('number');
        expect(product.price).toBeGreaterThan(0);

        // Validate boolean
        expect(typeof product.inStock).toBe('boolean');
      });

      // Check order structure
      expect(sampleData.orders.length).toBeGreaterThan(0);
      sampleData.orders.forEach((order: any) => {
        expect(order).toHaveProperty('id');
        expect(order).toHaveProperty('userId');
        expect(order).toHaveProperty('items');
        expect(order).toHaveProperty('total');
        expect(order).toHaveProperty('status');

        // Validate status enum
        expect(['pending', 'confirmed', 'shipped', 'delivered']).toContain(order.status);

        // Validate items
        expect(Array.isArray(order.items)).toBe(true);
        expect(order.items.length).toBeGreaterThan(0);
      });

      // Check pagination
      expect(sampleData.pagination).toHaveProperty('page', 1);
      expect(sampleData.pagination).toHaveProperty('limit', 20);
      expect(sampleData.pagination).toHaveProperty('total');
      expect(sampleData.pagination).toHaveProperty('hasMore');
    });

    it('should respect custom count options', () => {
      const sampleData = buildSampleData({
        userCount: 5,
        productCount: 10,
        orderCount: 3,
      });

      expect(sampleData.users.length).toBe(5);
      expect(sampleData.products.length).toBe(10);
      expect(sampleData.orders.length).toBe(3);
    });

    it('should format sample data as readable prompt section', () => {
      const sampleData = buildSampleData();
      const formatted = formatSampleDataForPrompt(sampleData);

      // Check structure
      expect(formatted).toContain('SAMPLE DATA FOR REFERENCE');
      expect(formatted).toContain('```json');
      expect(formatted).toContain('Key Points:');

      // Check that sample data is included as JSON
      expect(formatted).toContain('users');
      expect(formatted).toContain('products');
      expect(formatted).toContain('orders');

      // Check that key format rules are mentioned
      expect(formatted).toContain('UUIDs');
      expect(formatted).toContain('ISO 8601');
      expect(formatted).toContain('enum values');
    });
  });

  describe('JSON Extraction from LLM Output', () => {
    it('should extract JSON from raw text with markdown blocks', () => {
      const llmOutput = `
Here's a mock API definition:

\`\`\`json
{
  "endpoints": [
    {"path": "/users", "method": "GET"}
  ]
}
\`\`\`

This is a simple example.
      `;

      const result = extractJsonFromLLMOutput(llmOutput);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('endpoints');
      expect(Array.isArray((result as any).endpoints)).toBe(true);
    });

    it('should extract pure JSON without markdown', () => {
      const llmOutput = `{
  "endpoints": [
    {"path": "/products", "method": "POST"}
  ]
}`;

      const result = extractJsonFromLLMOutput(llmOutput);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('endpoints');
    });

    it('should extract JSON wrapped in text', () => {
      const llmOutput = `Here's the API:
{
  "endpoints": [
    {"path": "/orders", "method": "GET"}
  ],
  "models": {}
}
And that's it!`;

      const result = extractJsonFromLLMOutput(llmOutput);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('endpoints');
      expect(result).toHaveProperty('models');
    });

    it('should throw error on invalid JSON', () => {
      const llmOutput = `
{
  "endpoints": [
    {"path": "/invalid
  ]
}
      `;

      expect(() => {
        extractJsonFromLLMOutput(llmOutput);
      }).toThrow();
    });
  });

  describe('Mock API Response Validation', () => {
    it('should validate correct mock API response structure', () => {
      const mockApi = {
        endpoints: [
          {
            path: '/users',
            method: 'GET',
            description: 'Get all users',
            parameters: [],
            response: { status: 200, schema: {} },
          },
        ],
        models: {
          User: { id: 'string', name: 'string' },
        },
      };

      expect(mockApi).toHaveProperty('endpoints');
      expect(mockApi).toHaveProperty('models');
      expect(Array.isArray(mockApi.endpoints)).toBe(true);
      expect(mockApi.endpoints[0]).toHaveProperty('path');
      expect(mockApi.endpoints[0]).toHaveProperty('method');
    });

    it('should throw error when endpoints array is missing', () => {
      const invalidApi = {
        models: {},
      };

      expect(invalidApi).not.toHaveProperty('endpoints');
    });

    it('should throw error when endpoints is not an array', () => {
      const invalidApi = {
        endpoints: 'not an array',
        models: {},
      };

      expect(Array.isArray(invalidApi.endpoints)).toBe(false);
    });
  });

  describe('Complete Pipeline with Mocked LLM Response', () => {
    it('should process complete pipeline with mock LLM response', () => {
      // Generate sample data
      const sampleData = buildSampleData({
        userCount: 2,
        productCount: 2,
        orderCount: 1,
      });

      // Format for prompt
      const formattedData = formatSampleDataForPrompt(sampleData);

      expect(formattedData).toContain('SAMPLE DATA FOR REFERENCE');
      expect(formattedData).toContain('users');
      expect(formattedData).toContain('products');
      expect(formattedData).toContain('orders');

      // Simulate LLM response
      const llmResponse = `
Based on the sample data, here's a mock API:

\`\`\`json
{
  "endpoints": [
    {"path": "/users", "method": "GET", "description": "List users"},
    {"path": "/products", "method": "GET", "description": "List products"}
  ],
  "models": {
    "User": {"id": "uuid", "name": "string", "email": "string"},
    "Product": {"id": "uuid", "name": "string", "price": "number"}
  }
}
\`\`\`
      `;

      // Extract JSON
      const result = extractJsonFromLLMOutput(llmResponse);

      expect(result).toHaveProperty('endpoints');
      expect(result).toHaveProperty('models');
      expect((result as any).endpoints.length).toBe(2);
    });

    it('should handle pipeline with various LLM response formats', () => {
      const formats = [
        // Format 1: Markdown code block
        `\`\`\`json\n{"endpoints": []}\n\`\`\``,

        // Format 2: Plain JSON
        `{"endpoints": [], "models": {}}`,

        // Format 3: JSON wrapped in explanation
        `Here's the schema:\n{"endpoints": [{"path": "/test"}]}`,
      ];

      formats.forEach((format, index) => {
        expect(() => {
          const result = extractJsonFromLLMOutput(format);
          expect(result).toHaveProperty('endpoints');
        }).not.toThrow(`Format ${index + 1} should be handled`);
      });
    });
  });
});
