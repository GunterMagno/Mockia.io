import { EndpointModel } from '../../models/MockAPI.js';
import { Types } from 'mongoose';
import { Document } from 'mongoose';

// Returns the default response document for a given endpoint
export async function getDefaultResponseForEndpoint(
  endpointId: string
): Promise<Document & any | null> {
  try {
    if (!Types.ObjectId.isValid(endpointId)) {
      return null;
    }

    // Load the endpoint and its related responses
    const endpoint = await EndpointModel.findById(endpointId).populate('responses');
    if (!endpoint) {
      return null;
    }

    const responses: any[] = endpoint.responses as any[];
    if (!responses || responses.length === 0) return null;

    const defaultResp = responses.find(r => r.is_default === true);
    return defaultResp ?? null;
  } catch {
    return null;
  }
}
