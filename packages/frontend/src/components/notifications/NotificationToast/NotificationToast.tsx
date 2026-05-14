import React, { useEffect, useState } from 'react';
import { Notification } from '@mockia/shared';
import styles from './NotificationToast.module.scss';
import { Icon } from '../../ui/Icon/Icon';
import bellIcon from '../../../assets/bell.svg';
import warningIcon from '../../../assets/warning.svg';

interface NotificationToastProps {
  notification: Notification;
  onClose: () => void;
}

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Entrance animation
    setIsVisible(true);

    // Auto-close after 2 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for exit animation
    }, 2000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const getIcon = () => {
    if (notification.type === 'PROJECT_REMOVAL') return warningIcon;
    return bellIcon;
  };

  return (
    <div className={`${styles.toast} ${isVisible ? styles.visible : ''}`}>
      <div className={styles.iconContainer}>
        <Icon src={getIcon()} size={20} />
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{notification.title}</div>
        <div className={styles.message}>{notification.message}</div>
      </div>
    </div>
  );
};

export default NotificationToast;
