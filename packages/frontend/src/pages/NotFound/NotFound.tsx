import React from 'react';
import { Link } from 'react-router-dom';
import styles from './NotFound.module.scss';
import warningIcon from '../../assets/warning.svg';
import { PATHS } from '../../routes/paths';
import { useI18n } from '../../i18n/I18nProvider';

const NotFound: React.FC = () => {
  const { t, rich } = useI18n();
  return (
    <main className={styles.notFound}>
      <section className={styles.container}>
        <header className={styles.header}>
          <figure className={styles.iconBox}>
            <img src={warningIcon} alt="" />
          </figure>
          <h1 className={styles.title}>404</h1>
          <h2 className={styles.subtitle}>
            {rich('notFound.title', { em: (chunk) => <span className={styles.gradientText}>{chunk}</span> })}
          </h2>
        </header>
        <article className={styles.content}>
          <p className={styles.description}>
            {t('notFound.text')}
          </p>
          <nav className={styles.actions}>
            <Link to={PATHS.home} className={styles.primaryBtn}>
              {t('notFound.home')}
            </Link>
          </nav>
        </article>
      </section>
    </main>
  );
};

export default NotFound;
