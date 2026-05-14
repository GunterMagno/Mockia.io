import React, { useState } from 'react';
import { Icon } from '../../ui/Icon/Icon';
import bellIcon from '../../../assets/bell.svg';
import NotificationPanel from '../NotificationPanel/NotificationPanel';
import NotificationToast from '../NotificationToast/NotificationToast';
import { useNotifications } from '../../../hooks/useNotifications';
import styles from './NotificationBell.module.scss';

interface NotificationBellProps {
  className?: string;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { 
    notifications, 
    activeToast, 
    unreadCount, 
    fetchNotifications, 
    clearToast 
  } = useNotifications();

  return (
    <div className={`${styles.wrapper} ${className || ''}`}>
      <button 
        className={`${styles.bellBtn} ${unreadCount > 0 ? styles.hasUnread : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
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
    </div>
  );
};

export default NotificationBell;
