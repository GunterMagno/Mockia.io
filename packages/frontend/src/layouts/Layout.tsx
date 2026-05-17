import React from 'react'
import { Footer } from '../components/ui/Footer/Footer'
import styles from './Layout.module.scss'

interface LayoutProps {
  onOpenProjectSettings?: () => void;
}

const Layout: React.FC<React.PropsWithChildren<LayoutProps>> = ({ children, onOpenProjectSettings }) => {
  React.useEffect(() => {
    const handleOpenSettings = () => {
      if (onOpenProjectSettings) onOpenProjectSettings();
    };
    document.addEventListener('open-project-settings', handleOpenSettings);
    return () => {
      document.removeEventListener('open-project-settings', handleOpenSettings);
    };
  }, [onOpenProjectSettings]);

  return (
    <section className={styles.layout}>
      <article className={styles.layoutInner}>
        {/* Main Content Area */}
        <section className={styles.mainWrapper}>
          <main className={styles.main}>
            <section className={styles.container}>{children}</section>
          </main>
        </section>
      </article>

      {/* Footer spans across the bottom row */}
      <footer className={styles.footerWrapper}>
        <Footer />
      </footer>
    </section>
  )
}

export default Layout
