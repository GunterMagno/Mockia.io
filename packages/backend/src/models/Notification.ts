import { Schema, model, Document, Types } from 'mongoose';
import { NotificationType } from '@mockia/shared';

/**
 * Notification document interface
 */
interface NotificationDocument extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  projectId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification schema
 */
const notificationSchema = new Schema<NotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fetching unread notifications for a user
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const NotificationModel = model<NotificationDocument>('Notification', notificationSchema);

export type { NotificationDocument };
