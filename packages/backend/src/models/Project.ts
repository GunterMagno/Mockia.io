import { Schema, model, Document, Types } from 'mongoose';

/**
 * Project Role enum - matches @mockia/shared ProjectRole
 */
enum ProjectRoleEnum {
  OWNER = 'owner',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

/**
 * Project member subdocument interface
 */
interface ProjectMemberDocument {
  userId: Types.ObjectId;
  role: ProjectRoleEnum;
  addedAt: Date;
}

/**
 * Internal interface for project document in MongoDB
 * Extends Mongoose Document to access instance methods and properties
 */
interface ProjectDocument extends Document {
  title: string;
  description?: string;
  slug: string;
  ownerId: Types.ObjectId;
  members: ProjectMemberDocument[];
  isArchived: boolean;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project member subdocument schema
 */
const projectMemberSchema = new Schema<ProjectMemberDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(ProjectRoleEnum),
      required: true,
      default: ProjectRoleEnum.VIEWER,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/**
 * Project schema
 * Defines the structure and validations of the document in MongoDB
 */
const projectSchema = new Schema<ProjectDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    members: [projectMemberSchema],
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Compound index for efficient querying of projects by member
 */
projectSchema.index({ 'members.userId': 1, isArchived: 1 });

/**
 * Project model for CRUD operations in MongoDB
 * Will be mapped to API types in the service layer
 */
export const ProjectModel = model<ProjectDocument>('Project', projectSchema);

export type { ProjectDocument, ProjectMemberDocument };
export { ProjectRoleEnum };
