import React, { useEffect } from 'react';
import styles from './LegalPage.module.scss';

const Terms: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <article className={styles.legalPage}>
      <section className={styles.container}>
        <header className={styles.header}>
          <h1>Terms of Service</h1>
          <p className={styles.lastUpdated}>Last updated: May 15, 2026</p>
        </header>

        <main className={styles.content}>
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using Mockia.io, you agree to be bound by these Terms of Service. If you do not agree to all of these terms, you should not use our platform.
            </p>
          </section>

          <section>
            <h2>2. Description of Service</h2>
            <p>
              Mockia.io is an AI-powered Mock API generator that synchronizes with your GitHub repositories. We provide tools to generate, host, and manage mock endpoints for software development and testing purposes.
            </p>
          </section>

          <section>
            <h2>3. User Accounts</h2>
            <p>
              To use certain features of Mockia.io, you must register for an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
            </p>
            <ul>
              <li>You must provide accurate and complete information during registration.</li>
              <li>You are responsible for the security of your GitHub tokens used for synchronization.</li>
              <li>We reserve the right to suspend or terminate accounts that violate these terms.</li>
            </ul>
          </section>

          <section>
            <h2>4. Usage Policies</h2>
            <p>
              You agree not to use Mockia.io for any unlawful purpose or to conduct any activity that would violate the rights of others or harm our infrastructure.
            </p>
            <ul>
              <li>No automated scraping or harvesting of data from the platform.</li>
              <li>No usage of the platform to host malicious content or malware.</li>
              <li>No interference with the security or integrity of our mock API services.</li>
            </ul>
          </section>

          <section>
            <h2>5. Intellectual Property</h2>
            <p>
              Mockia.io and its original content, features, and functionality are owned by its creators and are protected by international copyright, trademark, and other intellectual property laws.
            </p>
          </section>

          <section>
            <h2>6. Limitation of Liability</h2>
            <p>
              In no event shall Mockia.io be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, or use.
            </p>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us at <a href="mailto:legal@mockia.io">legal@mockia.io</a>.
            </p>
          </section>
        </main>
      </section>
    </article>
  );
};

export default Terms;
