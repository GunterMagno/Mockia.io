import { EndpointModel, MockAPIModel } from '../../models/MockAPI.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';
import { mockCache } from './mockCache.service.js';
import { clampDelay, clampStatus, sanitizeHeaders } from './mockBehavior.js';

export interface EndpointConfigDto {
  force_status_code?: number | null;
  delay_ms?: number | null;
  jitter_ms?: number | null;
  headers?: Record<string, string> | null;
  override_response?: any;
}

export type NormalizedConfigDto = {
  [K in keyof EndpointConfigDto]: Exclude<EndpointConfigDto[K], null>;
};

/**
 * Valida y acota el DTO del interceptor: status 200-599 (0/null lo desactiva), latencias >= 0 acotadas
 * a MAX_DELAY_MS, headers filtrados. Lanza 400 ante valores no numericos o fuera de rango.
 */
export function normalizeConfigDto(dto: EndpointConfigDto): NormalizedConfigDto {
  const bad = (field: string) => new AppError(`Invalid value for ${field}`, ErrorCode.VALIDATION_ERROR, 400);
  const out: NormalizedConfigDto = {};
  if (dto.force_status_code !== undefined) {
    const n = dto.force_status_code === null ? 0 : Number(dto.force_status_code);
    if (n !== 0 && clampStatus(n, 0) === 0) throw bad('force_status_code');
    out.force_status_code = n;
  }
  for (const f of ['delay_ms', 'jitter_ms'] as const) {
    if (dto[f] === undefined) continue;
    const n = dto[f] === null ? 0 : Number(dto[f]);
    if (!Number.isFinite(n) || n < 0) throw bad(f);
    out[f] = clampDelay(n);
  }
  if (dto.headers !== undefined) out.headers = sanitizeHeaders(dto.headers);
  if (dto.override_response !== undefined) out.override_response = dto.override_response;
  return out;
}

/**
 * Sets or updates interceptor config for a given endpoint
 * Validates that the endpoint belongs to the provided project
 */
export async function setEndpointConfig(
  projectId: string,
  endpointId: string,
  rawDto: EndpointConfigDto
) {
  const dto = normalizeConfigDto(rawDto ?? {});
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
    if (dto.jitter_ms !== undefined) cfg.jitter_ms = dto.jitter_ms;
    if (dto.headers !== undefined) cfg.headers = dto.headers;
    if (dto.override_response !== undefined) cfg.override_response = dto.override_response;
  }
  await cfg.save();
  mockCache.invalidateEndpointConfig(endpointId);
  return cfg;
}

/**
 * Retrieves the interceptor config for a given endpoint
 */
export async function getEndpointConfig(endpointId: string) {
  const cfg = await EndpointConfigModel.findOne({ endpointId: endpointId as any });
  return cfg;
}
