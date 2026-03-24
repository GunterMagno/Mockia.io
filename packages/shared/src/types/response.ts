/**
 * Standard success response with typed data
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Pagination info
 */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Paginated response with data array and pagination metadata
 */
export interface PaginatedResponse<T = any> {
  success: true;
  data: T[];
  pagination: PaginationInfo;
  timestamp: string;
}

/**
 * Creates a standard success response
 * @param data - The data to include in response
 * @returns SuccessResponse object
 */
export const createSuccessResponse = <T>(data: T): SuccessResponse<T> => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});

/**
 * Creates a paginated response
 * @param data - Array of items
 * @param page - Current page number
 * @param limit - Items per page
 * @param total - Total items in database
 * @returns PaginatedResponse object
 */
export const createPaginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  total: number
): PaginatedResponse<T> => ({
  success: true,
  data,
  pagination: {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    hasNext: page < Math.ceil(total / limit),
    hasPrev: page > 1,
  },
  timestamp: new Date().toISOString(),
});
