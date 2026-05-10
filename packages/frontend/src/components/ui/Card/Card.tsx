import React from 'react';
import styles from './Card.module.scss';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export const Card: React.FC<CardProps> = ({ title, children, ...rest }) => {
  return (
    <section className={styles.card} {...rest}>
      {title && <header className={styles.header}>{title}</header>}
      <div className={styles.content}>{children}</div>
    </section>
  );
};

export default Card;
