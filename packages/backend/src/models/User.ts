import { Schema, model, Document } from 'mongoose';

/**
 * Internal interface for user document in MongoDB
 * Extends Mongoose Document to access instance methods and properties
 */
interface UserDocument extends Document {
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User schema
 * Defines the structure and validations of the document in MongoDB
 */
const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * User model for CRUD operations in MongoDB
 * Will be mapped to API types in the service layer
 */
export const UserModel = model<UserDocument>('User', userSchema);

export type { UserDocument };
