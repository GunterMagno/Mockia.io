import { Types } from 'mongoose';
import { EndpointModel, MockAPIModel } from '../../models/MockAPI';
import { EndpointConfigModel } from '../../models/EndpointConfig';
import { AppError } from '../../middlewares/errorHandler';
import { ErrorCode } from '@mockia/shared';

/**
 * Sets or updates interceptor config for a given endpoint
 * Validates that the endpoint belongs to the provided project
 */
export async function setEndpointConfig(
  projectId: string,
  endpointId: string,
  dto: { force_status_code?: number; delay_ms?: number; override_response?: any }
) {
  // Load endpoint to verify ownership
  const endpoint = await EndpointModel.findById(endpointId as any);
  if (!endpoint) {
    throw new AppError('Endpoint not found', ErrorCode.NOT_FOUND, 404);
  }

  // Load mock API to verify project ownership
  const mockApi = await MockAPIModel.findById((endpoint as any).mockApiId);
  if (!mockApi) {
    // If not populated, try direct lookup from endpoint to mockApiId
    const endpointDoc = await EndpointModel.findById(endpointId).lean();
    if (!endpointDoc) throw new AppError('Endpoint not found', ErrorCode.NOT_FOUND, 404);
    const api = await MockAPIModel.findById((endpointDoc as any).mockApiId);
    if (!api || api.projectId.toString() !== projectId) {
      throw new AppError('Endpoint does not belong to the provided project', ErrorCode.FORBIDDEN, 403);
    }
  } else {
    if (mockApi.projectId.toString() !== projectId) {
      throw new AppError('Endpoint does not belong to the provided project', ErrorCode.FORBIDDEN, 403);
    }
  }

  // Upsert the config for this endpoint
  let cfg = await EndpointConfigModel.findOne({ endpointId: endpoint._id });
  if (!cfg) {
    cfg = new EndpointConfigModel({ endpointId: endpoint._id, ...dto } as any);
  } else {
    if (dto.force_status_code !== undefined) cfg.force_status_code = dto.force_status_code;
    if (dto.delay_ms !== undefined) cfg.delay_ms = dto.delay_ms;
    if (dto.override_response !== undefined) cfg.override_response = dto.override_response;
  }
  await cfg.save();
  return cfg;
}

/**
 * Retrieves the interceptor config for a given endpoint
 */
export async function getEndpointConfig(endpointId: string) {
  const cfg = await EndpointConfigModel.findOne({ endpointId: endpointId as any });
  return cfg;
}
