import { Schema, model, Document, Types } from 'mongoose';

/**
 * EndpointConfig document interface
 */
interface EndpointConfigDocument extends Document {
  endpointId: Types.ObjectId;
  force_status_code?: number;
  delay_ms?: number;
  jitter_ms?: number;
  headers?: Record<string, string>;
  override_response?: any;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * EndpointConfig schema
 * Stores override/intercept options for a given Endpoint
 */
const endpointConfigSchema = new Schema<EndpointConfigDocument>(
  {
    endpointId: {
      type: Schema.Types.ObjectId,
      ref: 'Endpoint',
      required: true,
      unique: true,
    },
    force_status_code: {
      type: Number,
      required: false,
    },
    delay_ms: {
      type: Number,
      required: false,
    },
    override_response: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    jitter_ms: {
      type: Number,
      required: false,
      min: 0,
      max: 30000,
    },
    // Headers de respuesta custom; se filtran otra vez al servirlos (mockBehavior.sanitizeHeaders)
    headers: {
      type: Schema.Types.Mixed,
      required: false,
    },
  },
  { timestamps: true }
);

export const EndpointConfigModel = model<EndpointConfigDocument>('EndpointConfig', endpointConfigSchema);

export type { EndpointConfigDocument };
