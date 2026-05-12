import { Schema, model, Document, Types } from 'mongoose';

/**
 * File information within GitHub context
 */
interface FileInfoDocument {
  path: string;
  type: 'typescript' | 'swagger' | 'other';
  interfaces?: Array<{ name: string; properties: string[] }>;
  functions?: Array<{ name: string; params: string[]; returnType?: string }>;
  enums?: Array<{ name: string; members: string[] }>;
  typeAliases?: Array<{ name: string; type: string }>;
  routes?: Array<{ path: string; methods: string[] }>;
  summary?: string;
}

/**
 * Internal interface for GitHub context document in MongoDB
 * Extends Mongoose Document to access instance methods and properties
 */
interface GitHubContextDocument extends Document {
  projectId: Types.ObjectId;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  summary: string;
  files: FileInfoDocument[];
  stats: {
    totalFiles: number;
    totalInterfaces: number;
    totalFunctions: number;
    totalRoutes: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * File info subdocument schema
 */
const interfaceSchema = new Schema({
  name: { type: String, required: true },
  properties: [{ type: String }],
}, { _id: false });

const functionSchema = new Schema({
  name: { type: String, required: true },
  params: [{ type: String }],
  returnType: { type: String },
}, { _id: false });

const enumSchema = new Schema({
  name: { type: String, required: true },
  members: [{ type: String }],
}, { _id: false });

const typeAliasSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
}, { _id: false });

/**
 * File info subdocument schema
 */
const fileInfoSchema = new Schema<FileInfoDocument>(
  {
    path: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['typescript', 'swagger', 'other'],
      required: true,
    },
    interfaces: [interfaceSchema],
    functions: [functionSchema],
    enums: [enumSchema],
    typeAliases: [typeAliasSchema],
    routes: [
      {
        _id: false,
        path: String,
        methods: [String],
      },
    ],
    summary: String,
  },
  { _id: false }
);

/**
 * GitHub context schema
 * Stores parsed context from a GitHub repository linked to a project
 * 
 * Note: Documents are automatically deleted 30 days after creation via TTL index on createdAt
 */
const githubContextSchema = new Schema<GitHubContextDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    repoUrl: {
      type: String,
      required: true,
    },
    repoOwner: {
      type: String,
      required: true,
    },
    repoName: {
      type: String,
      required: true,
    },
    branch: {
      type: String,
      default: 'main',
    },
    summary: {
      type: String,
      default: '',
    },
    files: {
      type: [fileInfoSchema],
      default: [],
    },
    stats: {
      _id: false,
      totalFiles: {
        type: Number,
        default: 0,
      },
      totalInterfaces: {
        type: Number,
        default: 0,
      },
      totalFunctions: {
        type: Number,
        default: 0,
      },
      totalRoutes: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// TTL Index: automatically delete documents 30 days (2592000 seconds) after creation
githubContextSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

/**
 * GitHub context model for CRUD operations in MongoDB
 */
export const GitHubContextModel = model<GitHubContextDocument>(
  'GitHubContext',
  githubContextSchema
);

export type { GitHubContextDocument, FileInfoDocument };
