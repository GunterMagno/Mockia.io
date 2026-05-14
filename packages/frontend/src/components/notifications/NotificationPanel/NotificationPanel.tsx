import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Notification, NotificationType } from '@mockia/shared';
import { markAsRead, deleteNotification } from '../../../services/notificationService';
import styles from './NotificationPanel.module.scss';
import { Icon } from '../../ui/Icon/Icon';
import bellIcon from '../../../assets/bell.svg';
import warningIcon from '../../../assets/warning.svg';

interface NotificationPanelProps {
  notifications: Notification[];
  onClose: () => void;
  onRefresh: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ 
  notifications, 
  onClose,
  onRefresh 
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await markAsRead([notification.id]);
      onRefresh();
    }
    
    if (notification.link) {
      navigate(notification.link);
    }
    onClose();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Don't trigger the click on the item
    try {
      await deleteNotification(id);
      onRefresh();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.isRead).map(n => n.id);
    if (unreadIds.length > 0) {
      await markAsRead(unreadIds);
      onRefresh();
    }
  };

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case NotificationType.PROJECT_INVITE:
        return bellIcon;
      case NotificationType.PROJECT_REMOVAL:
        return warningIcon;
      case NotificationType.PROJECT_UPDATE:
        return bellIcon;
      default:
        return bellIcon;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={styles.panel} ref={panelRef}>
      <div className={styles.header}>
        <h3>Notifications</h3>
        {notifications.some(n => !n.isRead) && (
          <button onClick={handleMarkAllAsRead} className={styles.markAllBtn}>
            Mark all as read
          </button>
        )}
      </div>
      <div className={styles.list}>
        {notifications.length === 0 ? (
          <div className={styles.empty}>No notifications yet</div>
        ) : (
          notifications.map(notification => (
            <div 
              key={notification.id} 
              className={`${styles.item} ${!notification.isRead ? styles.unread : ''}`}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className={styles.iconContainer}>
                <Icon src={getIcon(notification.type)} size={20} />
              </div>
              <div className={styles.content}>
                <div className={styles.title}>{notification.title}</div>
                <div className={styles.message}>{notification.message}</div>
                <div className={styles.date}>{formatDate(notification.createdAt)}</div>
              </div>
              {!notification.isRead && <div className={styles.unreadDot} />}
              <button 
                className={styles.deleteBtn} 
                onClick={(e) => handleDelete(e, notification.id)}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationPanel;
