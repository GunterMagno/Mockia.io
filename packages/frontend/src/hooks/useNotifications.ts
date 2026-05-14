import { useState, useEffect, useRef } from 'react';
import { Notification } from '@mockia/shared';
import { getNotifications } from '../services/notificationService';
import { playNotificationSound } from '../utils/audio';

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeToast, setActiveToast] = useState<Notification | null>(null);
  const prevNotificationsRef = useRef<Notification[]>([]);

  const fetchNotifications = async () => {
    try {
      const data = await getNotifications();
      
      // Detect new unread notifications
      const prevUnreadIds = new Set(prevNotificationsRef.current.filter(n => !n.isRead).map(n => n.id));
      const newUnread = data.find(n => !n.isRead && !prevUnreadIds.has(n.id));

      if (newUnread) {
        setActiveToast(newUnread);
        playNotificationSound();
      }

      setNotifications(data);
      prevNotificationsRef.current = data;
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 2500);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return {
    notifications,
    activeToast,
    unreadCount,
    fetchNotifications,
    clearToast: () => setActiveToast(null)
  };
};
