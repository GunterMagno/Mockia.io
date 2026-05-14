import { Notification } from '@mockia/shared';
import api from './api';

/**
 * Get all notifications for the authenticated user
 */
export const getNotifications = async (): Promise<Notification[]> => {
  const response = await api.get('/notifications');
  return response.data.data;
};

/**
 * Mark notifications as read
 */
export const markAsRead = async (notificationIds: string[]): Promise<void> => {
  await api.post('/notifications/mark-read', { notificationIds });
};

/**
 * Delete a notification
 */
export const deleteNotification = async (id: string): Promise<void> => {
  await api.delete(`/notifications/${id}`);
};
