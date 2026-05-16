import { NotificationModel } from '../models/Notification.js';
import type { Notification as NotificationDTO, NotificationType } from '@mockia/shared';
import { AppError } from '../middlewares/errorHandler.js';
import { ErrorCode } from '@mockia/shared';

/**
 * Maps a MongoDB NotificationDocument to a NotificationDTO
 */
function mapNotificationToDTO(doc: any): NotificationDTO {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    type: doc.type as NotificationType,
    title: doc.title,
    message: doc.message,
    link: doc.link,
    isRead: doc.isRead,
    projectId: doc.projectId?.toString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Retrieves notifications for a user
 */
export async function getUserNotifications(userId: string): Promise<NotificationDTO[]> {
  try {
    const notifications = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return notifications.map(mapNotificationToDTO);
  } catch (error) {
    console.error('Error retrieving notifications:', error);
    throw new AppError('Failed to retrieve notifications', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Creates a new notification
 */
export async function createNotification(data: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  projectId?: string;
}): Promise<NotificationDTO> {
  try {
    const notification = new NotificationModel(data);
    const savedNotification = await notification.save();
    return mapNotificationToDTO(savedNotification);
  } catch (error) {
    console.error('Error creating notification:', error);
    throw new AppError('Failed to create notification', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Marks notifications as read
 */
export async function markNotificationsAsRead(userId: string, notificationIds: string[]): Promise<void> {
  try {
    await NotificationModel.updateMany(
      { _id: { $in: notificationIds }, userId },
      { $set: { isRead: true } }
    );
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    throw new AppError('Failed to update notifications', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Deletes a notification
 */
export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  try {
    await NotificationModel.deleteOne({ _id: notificationId, userId });
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw new AppError('Failed to delete notification', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}
