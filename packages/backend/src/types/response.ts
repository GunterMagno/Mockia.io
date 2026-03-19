/**
 * Respuesta de éxito estándar
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Respuesta paginada
 */
export interface PaginatedResponse<T = any> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  timestamp: string;
}

/**
 * Crea una respuesta de éxito estándar
 */
export const createSuccessResponse = <T>(
  data: T
): SuccessResponse<T> => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});

/**
 * Crea una respuesta paginada
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
