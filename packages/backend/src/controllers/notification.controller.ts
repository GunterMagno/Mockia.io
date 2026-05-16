import { Request, Response, NextFunction } from 'express';
import * as NotificationService from '../services/notification.service.js';

/**
 * Get all notifications for the authenticated user
 */
export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const notifications = await NotificationService.getUserNotifications(userId);
    res.json({ data: notifications });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark notifications as read
 */
export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const { notificationIds } = req.body;
    await NotificationService.markNotificationsAsRead(userId, notificationIds);
    res.status(200).json({ message: 'Notifications marked as read' });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    await NotificationService.deleteNotification(userId, id);
    res.status(200).json({ message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
}
