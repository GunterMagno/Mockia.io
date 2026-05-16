import React from 'react';
import { Link } from 'react-router-dom';
import styles from './NotFound.module.scss';
import warningIcon from '../../assets/warning.svg';

const NotFound: React.FC = () => {
  return (
    <main className={styles.notFound}>
      <section className={styles.container}>
        <header className={styles.header}>
          <figure className={styles.iconBox}>
            <img src={warningIcon} alt="Warning" />
          </figure>
          <h1 className={styles.title}>404</h1>
          <h2 className={styles.subtitle}>Lost in the <span className={styles.gradientText}>API Matrix</span></h2>
        </header>
        <article className={styles.content}>
          <p className={styles.description}>
            The endpoint you are trying to reach has vanished into the digital void. 
            Perhaps it was moved, deleted, or never existed in the first place.
          </p>
          <nav className={styles.actions}>
            <Link to="/" className={styles.primaryBtn}>
              Return to Home
            </Link>
          </nav>
        </article>
      </section>
    </main>
  );
};

export default NotFound;
