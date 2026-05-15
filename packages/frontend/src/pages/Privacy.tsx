import React, { useEffect } from 'react';
import styles from './LegalPage.module.scss';

const Privacy: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.legalPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Privacy Policy</h1>
          <p className={styles.lastUpdated}>Last updated: May 15, 2026</p>
        </header>

        <main className={styles.content}>
          <section>
            <h2>1. Information We Collect</h2>
            <p>
              We collect information to provide better services to all our users. The types of information we collect include:
            </p>
            <ul>
              <li><strong>Account Information:</strong> Name, email address, and username when you register.</li>
              <li><strong>Authentication:</strong> GitHub OAuth tokens used exclusively to sync your repositories and schemas.</li>
              <li><strong>Usage Data:</strong> Information about how you interact with our platform and mock endpoints.</li>
            </ul>
          </section>

          <section>
            <h2>2. How We Use Your Information</h2>
            <p>
              We use the information we collect to:
            </p>
            <ul>
              <li>Maintain and improve Mockia.io services.</li>
              <li>Process your mock API requests and AI generations.</li>
              <li>Communicate with you regarding updates, security, and support.</li>
              <li>Protect the security and integrity of our platform.</li>
            </ul>
          </section>

          <section>
            <h2>3. Data Protection</h2>
            <p>
              We take the security of your data very seriously. We use industry-standard encryption and security measures to protect your account information and GitHub tokens.
            </p>
            <ul>
              <li>GitHub tokens are encrypted at rest and never shared with third parties.</li>
              <li>We perform regular security audits of our infrastructure.</li>
              <li>Access to user data is strictly limited to authorized personnel only.</li>
            </ul>
          </section>

          <section>
            <h2>4. Sharing of Information</h2>
            <p>
              We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties. This does not include trusted third parties who assist us in operating our website and conducting our business, so long as those parties agree to keep this information confidential.
            </p>
          </section>

          <section>
            <h2>5. Your Rights</h2>
            <p>
              You have the right to access, correct, or delete your personal information stored on our platform. You can manage your account settings directly through the dashboard or contact us for assistance.
            </p>
          </section>

          <section>
            <h2>6. Changes to This Policy</h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section>
            <h2>7. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at <a href="mailto:privacy@mockia.io">privacy@mockia.io</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Privacy;
