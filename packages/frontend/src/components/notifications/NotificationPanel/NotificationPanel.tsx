import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Notification, NotificationType } from '@mockia/shared';
import { markAsRead, deleteNotification } from '../../../services/notificationService';
import styles from './NotificationPanel.module.scss';
import { useI18n } from '../../../i18n/I18nProvider';
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
  const { t, formatDate: format } = useI18n();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLElement>(null);

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
      case NotificationType.PROJECT_LEAVE:
        return warningIcon;
      default:
        return bellIcon;
    }
  };

  const formatDate = (dateString: string) => {
    return format(dateString, { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <aside className={styles.panel} ref={panelRef}>
      <header className={styles.header}>
        <h3>{t('notifications.title')}</h3>
        {notifications.some(n => !n.isRead) && (
          <button onClick={handleMarkAllAsRead} className={styles.markAllBtn}>
            {t('notifications.markAllRead')}
          </button>
        )}
      </header>
      <section className={styles.list}>
        {notifications.length === 0 ? (
          <article className={styles.empty}>{t('notifications.empty')}</article>
        ) : (
          notifications.map(notification => (
            <article 
              key={notification.id} 
              className={`${styles.item} ${!notification.isRead ? styles.unread : ''}`}
              onClick={() => handleNotificationClick(notification)}
            >
              <figure className={styles.iconContainer}>
                <Icon src={getIcon(notification.type)} size={20} />
              </figure>
              <section className={styles.content}>
                <span className={styles.title}>{notification.title}</span>
                <span className={styles.message}>{notification.message}</span>
                <span className={styles.date}>{formatDate(notification.createdAt)}</span>
              </section>
              {!notification.isRead && <span className={styles.unreadDot} />}
              <button 
                className={styles.deleteBtn} 
                onClick={(e) => handleDelete(e, notification.id)}
                title={t('notifications.delete')}
                aria-label={t('notifications.delete')}
              >
                ×
              </button>
            </article>
          ))
        )}
      </section>
    </aside>
  );
};

export default NotificationPanel;
