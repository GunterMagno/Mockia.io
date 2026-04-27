/**
 * Fake Data Provider for Mockia AI
 * 
 * Generates realistic sample data using Faker.js
 * These samples are injected into prompts to guide the LLM toward
 * generating coherent and realistic mock API specifications
 */

import { faker } from '@faker-js/faker';
import type { SampleData } from '@mockia/shared';

/**
 * Builds realistic sample data using Faker.js
 * 
 * Generates:
 * - User profiles with name, email, phone
 * - Product catalog with prices and stock
 * - Order history with items and status
 * - Pagination metadata
 * 
 * @param options - Optional configuration
 * @returns Structured sample data object
 */
export function buildSampleData(options?: {
  userCount?: number;
  productCount?: number;
  orderCount?: number;
}): SampleData {
  const userCount = options?.userCount ?? 3;
  const productCount = options?.productCount ?? 4;
  const orderCount = options?.orderCount ?? 2;

  // Generate sample users
  const users = Array.from({ length: userCount }, () => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    createdAt: faker.date.past().toISOString(),
  }));

  // Generate sample products
  const products = Array.from({ length: productCount }, () => ({
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    price: parseFloat(faker.commerce.price()),
    category: faker.commerce.department(),
    inStock: faker.datatype.boolean(),
  }));

  // Generate sample orders
  const orders = Array.from({ length: orderCount }, () => {
    const userId = faker.helpers.arrayElement(users).id;
    const items = Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => ({
      productId: faker.helpers.arrayElement(products).id,
      quantity: faker.number.int({ min: 1, max: 10 }),
      price: parseFloat(faker.commerce.price()),
    }));

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      id: faker.string.uuid(),
      userId,
      items,
      total: parseFloat(total.toFixed(2)),
      status: faker.helpers.arrayElement(['pending', 'confirmed', 'shipped', 'delivered'] as const),
      createdAt: faker.date.past().toISOString(),
      updatedAt: faker.date.recent().toISOString(),
    };
  });

  // Generate pagination metadata
  const pagination = {
    page: 1,
    limit: 20,
    total: faker.number.int({ min: 50, max: 500 }),
    hasMore: true,
  };

  return {
    users,
    products,
    orders,
    pagination,
  };
}

/**
 * Formats sample data into a readable string for prompt injection
 * 
 * @param sampleData - The sample data to format
 * @returns Formatted string suitable for inclusion in prompts
 */
export function formatSampleDataForPrompt(sampleData: SampleData): string {
  return `SAMPLE DATA FOR REFERENCE:

Use these examples to understand the expected response format and data structure:

\`\`\`json
{
  "users": ${JSON.stringify(sampleData.users.slice(0, 2), null, 2)},
  "products": ${JSON.stringify(sampleData.products.slice(0, 2), null, 2)},
  "orders": ${JSON.stringify(sampleData.orders.slice(0, 1), null, 2)},
  "pagination": ${JSON.stringify(sampleData.pagination, null, 2)}
}
\`\`\`

**Key Points:**
- User IDs and Product IDs are UUIDs
- Prices are numeric values (e.g., 19.99)
- Timestamps are ISO 8601 format
- Status fields use predefined enum values (pending, confirmed, shipped, delivered)
- Arrays include pagination metadata for list endpoints
- Response structure follows REST conventions`;
}
