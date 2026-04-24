/**
 * Mock API Models
 * Mongoose schemas for MockAPI, Endpoint, and Response documents
 */

import { Schema, model, Document, Types } from 'mongoose';

/**
 * Response document interface
 * Represents a possible response for an endpoint (e.g., 200, 400, 500)
 */
interface ResponseDocument extends Document {
  statusCode: number;
  description: string;
  schema: any;
  examples: any[];
  json_body?: Record<string, any>;
  is_default: boolean;
  createdAt: Date;
}

/**
 * Endpoint document interface
 * Represents a single endpoint with its method, path, and possible responses
 */
interface EndpointDocument extends Document {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  requestSchema: Record<string, unknown>;
  responses: Types.ObjectId[];
  mockApiId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mock API document interface
 * Represents a complete mock API specification with multiple endpoints
 */
interface MockAPIDocument extends Document {
  projectId: Types.ObjectId;
  title: string;
  description: string;
  apiVersion: string;
  endpoints: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Response schema - subdocument for storing response information
 */
const responseSchema = new Schema<ResponseDocument>(
  {
    statusCode: {
      type: Number,
      required: true,
      min: 100,
      max: 599,
    },
    description: {
      type: String,
      required: true,
    },
    examples: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    json_body: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    is_default: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

/**
 * Endpoint schema - stores individual endpoint definitions
 */
const endpointSchema = new Schema<EndpointDocument>(
  {
    path: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    requestSchema: {
      type: Schema.Types.Mixed,
      required: false,
      default: {},
    },
    responses: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Response',
      },
    ],
    mockApiId: {
      type: Schema.Types.ObjectId,
      ref: 'MockAPI',
      required: true,
    },
  },
  { timestamps: true }
);

/**
 * Mock API schema - represents a complete API specification
 */
const mockApiSchema = new Schema<MockAPIDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    apiVersion: {
      type: String,
      required: true,
      default: '1.0.0',
    },
    endpoints: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Endpoint',
      },
    ],
  },
  { timestamps: true }
);

// Indexes for common queries
mockApiSchema.index({ projectId: 1, createdAt: -1 });
endpointSchema.index({ mockApiId: 1, method: 1 });

export const ResponseModel = model<ResponseDocument>('Response', responseSchema);
export const EndpointModel = model<EndpointDocument>('Endpoint', endpointSchema);
export const MockAPIModel = model<MockAPIDocument>('MockAPI', mockApiSchema);

export type { ResponseDocument, EndpointDocument, MockAPIDocument };
