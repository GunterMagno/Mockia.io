import React from 'react';
import styles from './ModalErrorAlert.module.scss';
import Icon from '../Icon/Icon';
import errorAlertIcon from '../../../assets/error-alert.svg';

interface ModalErrorAlertProps {
  message?: string;
  className?: string;
}

export const ModalErrorAlert: React.FC<ModalErrorAlertProps> = ({ message, className = '' }) => {
  if (!message) return null;

  return (
    <article className={`${styles.alertContainer} ${className}`} role="alert">
      <figure className={styles.iconContainer}>
        <Icon
          src={errorAlertIcon}
          size={18}
          color="var(--support-02)"
          className={styles.icon}
        />
      </figure>
      <section className={styles.messageContainer}>
        <span className={styles.messageText}>{message}</span>
      </section>
    </article>
  );
};

export default ModalErrorAlert;
