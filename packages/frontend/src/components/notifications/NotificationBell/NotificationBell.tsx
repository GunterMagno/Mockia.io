import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '../../ui/Icon/Icon';
import bellIcon from '../../../assets/bell.svg';
import NotificationPanel from '../NotificationPanel/NotificationPanel';
import NotificationToast from '../NotificationToast/NotificationToast';
import { useNotifications } from '../../../hooks/useNotifications';
import styles from './NotificationBell.module.scss';
import { useI18n } from '../../../i18n/I18nProvider';

interface NotificationBellProps {
  className?: string;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLElement>(null);
  const { t } = useI18n();
  const { 
    notifications, 
    activeToast, 
    unreadCount, 
    fetchNotifications, 
    clearToast 
  } = useNotifications();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking inside the wrapper
      if (wrapperRef.current && wrapperRef.current.contains(event.target as Node)) {
        return;
      }
      
      const target = event.target as HTMLElement;
      if (target.closest('[class*="mobileNotificationItem"]')) {
        return;
      }
      
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <section className={`${styles.wrapper} ${className || ''}`} ref={wrapperRef}>
      <button 
        className={`${styles.bellBtn} ${unreadCount > 0 ? styles.hasUnread : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
        title={t('notifications.title')}
        aria-label={unreadCount > 0 ? `${t('notifications.title')}: ${t('notifications.unread', { count: unreadCount })}` : t('notifications.title')}
        aria-expanded={isOpen}
      >
        <Icon src={bellIcon} />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>

      {isOpen && (
        <NotificationPanel 
          notifications={notifications} 
          onClose={() => setIsOpen(false)}
          onRefresh={fetchNotifications}
        />
      )}

      {activeToast && (
        <NotificationToast 
          notification={activeToast} 
          onClose={clearToast} 
        />
      )}
    </section>
  );
};

export default NotificationBell;
