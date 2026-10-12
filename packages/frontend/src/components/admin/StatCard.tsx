import React from 'react';
import styles from './Charts.module.scss';

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Pista bajo la cifra (p. ej. "estimacion, consulta Stripe"). */
  note?: React.ReactNode;
  testId: string;
  /** Texto en lugar de una cifra (p. ej. "Sin precios configurados"): tipografia mas pequena. */
  textValue?: boolean;
  children?: React.ReactNode;
}

/** Tarjeta de una cifra del panel. */
const StatCard: React.FC<StatCardProps> = ({ label, value, note, testId, textValue, children }) => (
  <article className={styles.stat} data-testid={testId}>
    <h3 className={styles.statLabel}>{label}</h3>
    <p className={`${styles.statValue} ${textValue ? styles.statText : ''}`}>{value}</p>
    {note && <p className={styles.statNote}>{note}</p>}
    {children}
  </article>
);

export default StatCard;
