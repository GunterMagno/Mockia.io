import React from 'react';
import styles from './Modal.module.scss';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <dialog open className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ margin: 0, padding: 0, border: 'none' }}>
        {title && <header className={styles.title}>{title}</header>}
        <section className={styles.body}>{children}</section>
      </dialog>
    </div>
  );
};

export default Modal;
