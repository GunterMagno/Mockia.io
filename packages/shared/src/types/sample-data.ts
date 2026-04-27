/**
 * Sample Data Types
 * Types for AI-generated sample data structures
 */

/**
 * Represents a sample user for API reference
 */
export interface SampleUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}

/**
 * Represents a sample product for API reference
 */
export interface SampleProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  inStock: boolean;
}

/**
 * Represents a sample order item
 */
export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

/**
 * Represents a sample order for API reference
 */
export interface SampleOrder {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents pagination metadata
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/**
 * Complete sample data structure for API reference
 * Used in AI prompts to guide LLM generation
 */
export interface SampleData {
  users: SampleUser[];
  products: SampleProduct[];
  orders: SampleOrder[];
  pagination: PaginationMetadata;
}
