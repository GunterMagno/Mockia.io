import { useState, useEffect, useRef } from 'react';
import { Notification } from '@mockia/shared';
import { getNotifications } from '../services/notificationService';
import { playNotificationSound } from '../utils/audio';

/** How often an open, visible tab asks for new notifications. */
export const POLL_INTERVAL_MS = 10_000;

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeToast, setActiveToast] = useState<Notification | null>(null);
  const prevNotificationsRef = useRef<Notification[]>([]);
  const isFirstFetchRef = useRef(true);

  const fetchNotifications = async () => {
    try {
      const data = await getNotifications();
      
      if (isFirstFetchRef.current) {
        isFirstFetchRef.current = false;
      } else {
        const prevUnreadIds = new Set(prevNotificationsRef.current.filter(n => !n.isRead).map(n => n.id));
        const newUnread = data.find(n => !n.isRead && !prevUnreadIds.has(n.id));

        if (newUnread) {
          setActiveToast(newUnread);
          playNotificationSound();
        }
      }

      setNotifications(data);
      prevNotificationsRef.current = data;
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Polling every POLL_INTERVAL_MS only while the tab is visible: a hidden tab does not poll at all and catches up
  // with one request when it is shown again (every request counts toward the per-IP API limiter).
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        fetchNotifications();
        start();
      }
    };

    fetchNotifications();
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
