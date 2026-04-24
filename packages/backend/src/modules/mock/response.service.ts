/**
 * Response Service
 * Service for managing and retrieving mock API responses
 */

import { ResponseModel, ResponseDocument } from '../../models/MockAPI';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';
import { Types } from 'mongoose';

/**
 * Gets the default response for an endpoint
 * 
 * @param endpointId - The endpoint ID
 * @returns The default response document, or null if not found
 * @throws AppError if database query fails
 */
export async function getDefaultResponseForEndpoint(
  endpointId: string | Types.ObjectId
): Promise<ResponseDocument | null> {
  try {
    const response = await ResponseModel.findOne({
      _id: new Types.ObjectId(endpointId),
      is_default: true,
    });

    return response || null;
  } catch (error) {
    throw new AppError(
      'Failed to fetch default response for endpoint',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}

/**
 * Gets the default response by endpoint ID from responses array
 * This is useful when you have an endpoint object with responses array
 * 
 * @param responseIds - Array of response IDs from endpoint.responses
 * @returns The default response document, or null if not found
 * @throws AppError if database query fails
 */
export async function getDefaultResponseFromArray(
  responseIds: (string | Types.ObjectId)[]
): Promise<ResponseDocument | null> {
  if (!responseIds || responseIds.length === 0) {
    return null;
  }

  try {
    const response = await ResponseModel.findOne({
      _id: { $in: responseIds },
      is_default: true,
    });

    return response || null;
  } catch (error) {
    throw new AppError(
      'Failed to fetch default response from array',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}
