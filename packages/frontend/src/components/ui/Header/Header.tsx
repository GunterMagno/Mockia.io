import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.scss';
import { useAuth } from '../../../contexts/AuthContext';
import userIcon from '../../../assets/user.svg';
import logoMockia from '../../../assets/LogoMockia.png';
import ProfileModal from '../../projects/ProfileModal/ProfileModal';
import NotificationBell from '../../notifications/NotificationBell/NotificationBell';
import gridIcon from '../../../assets/grid.svg';
import settingsIcon from '../../../assets/settings.svg';
import Icon from '../Icon/Icon';
import { PATHS, isKnownPath, isAuthPath } from '../../../routes/paths';
import { useI18n } from '../../../i18n/I18nProvider';
import LanguageSwitcher from '../LanguageSwitcher/LanguageSwitcher';

const Header: React.FC = () => {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useI18n();
  const path = location.pathname;
  
  // Determine variant based on path
  const isProjectPage = path.startsWith('/editor/') && isKnownPath(path);
  const is404 = !isKnownPath(path);

  const isLanding = path === PATHS.home;
  const isAuthPage = isAuthPath(path) || is404;

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [path]);

  // Listen for project name updates
  useEffect(() => {
    const handleSetProjectName = (e: any) => {
      setProjectName(e.detail);
    };
    document.addEventListener('set-project-name', handleSetProjectName);
    
    // Clear project name if we leave the project page
    if (!isProjectPage) {
      setProjectName(null);
    }
    
    return () => {
      document.removeEventListener('set-project-name', handleSetProjectName);
    };
  }, [isProjectPage]);

  const sectionLinks = [
    { href: '#story-title', label: t('nav.howItWorks') },
    { href: '#builder-title', label: t('nav.tryBuilder') },
    { href: '#features-title', label: t('nav.features') },
    { href: '#pricing-title', label: t('nav.pricing') },
  ];

  const openSettings = () => {
    document.dispatchEvent(new CustomEvent('open-project-settings'));
    setIsMenuOpen(false);
  };

  const Logo = () => (
    <Link to={PATHS.home} className={styles.logo} aria-label={t('nav.home')}>
      <img src={logoMockia} alt="" className={styles.logoImg} />
      <span className={styles.logoText}>Mock<span className={styles.highlight}>IA</span></span>
    </Link>
  );

  const ProfileAndBellDesktop = () => (
    <nav className={`${styles.rightContent} ${styles.desktopOnly}`}>
      <Link to={PATHS.dashboard} className={styles.iconButton} title={t('nav.dashboard')} aria-label={t('nav.dashboard')}>
        <article className={styles.actionItem}>
          <Icon src={gridIcon} size={24} />
          <span className={styles.actionLabel}>{t('nav.dashboard')}</span>
        </article>
      </Link>
      <article className={styles.actionItem}>
        <NotificationBell />
        <span className={styles.actionLabel}>{t('nav.notifications')}</span>
      </article>
      <button className={styles.iconButton} onClick={() => { setIsProfileOpen(true); setIsMenuOpen(false); }} title={t('nav.profile')} aria-label={t('nav.profile')}>
        <article className={styles.actionItem}>
          <Icon src={userIcon} size={28} className={styles.profileIcon} />
          <span className={styles.actionLabel}>{t('nav.profile')}</span>
        </article>
      </button>
    </nav>
  );

  const HamburgerBtn = () => (
    <button 
      className={`${styles.hamburgerBtn} ${isMenuOpen ? styles.menuOpen : ''}`} 
      onClick={() => setIsMenuOpen(!isMenuOpen)}
      aria-label={t('nav.toggleMenu')}
      aria-controls="site-nav"
      aria-expanded={isMenuOpen}
    >
      <span></span>
      <span></span>
      <span></span>
    </button>
  );

  // 1. Auth Pages Header: Minimal design (Logo only) for Login and Signup
  if (isAuthPage) {
    return (
      <header className={`${styles.header} ${styles.authHeader}`}>
        <Logo />
        <LanguageSwitcher className={styles.authLanguage} />
      </header>
    );
  }

  // 2. Landing & Main App Header with responsive Hamburger Menu
  return (
    <>
      <header className={styles.header}>
        <section className={styles.headerContainer}>
          <article className={styles.leftSection}>
            <Logo />
          </article>

          {isProjectPage && projectName && (
            <article className={styles.centerSection}>
              <span className={styles.projectName}>{projectName}</span>
              <button onClick={openSettings} className={styles.settingsIconBtn} title={t('nav.projectSettings')} aria-label={t('nav.projectSettings')}>
                <Icon src={settingsIcon} size={20} className={styles.settingsIcon} />
              </button>
            </article>
          )}

          <HamburgerBtn />

          {isMenuOpen && <article className={styles.menuBackdrop} onClick={() => setIsMenuOpen(false)} />}

          {isLanding && !isAuthenticated && (
            <nav className={styles.navCenter} aria-label={t('nav.sections')}>
              {sectionLinks.map((s) => (
                <a key={s.href} href={s.href} className={styles.navLink}>{s.label}</a>
              ))}
            </nav>
          )}

          <nav id="site-nav" className={`${styles.navActions} ${isMenuOpen ? styles.menuOpen : ''}`}>
            {isLanding && !isAuthenticated && (
              <nav className={styles.mobileOnlyLinks} aria-label={t('nav.sections')}>
                {sectionLinks.map((s) => (
                  <a key={s.href} href={s.href} className={styles.mobileNavLink} onClick={() => setIsMenuOpen(false)}>
                    {s.label}
                  </a>
                ))}
              </nav>
            )}

            {isAuthenticated && (
              <nav className={styles.mobileOnlyLinks}>
                {isProjectPage && projectName && (
                  <article className={styles.mobileProjectNameContainer}>
                    <span className={styles.mobileProjectName}>{projectName}</span>
                    <button onClick={openSettings} className={styles.mobileSettingsHeaderBtn}>
                      <Icon src={settingsIcon} size={20} className={styles.mobileNavIcon} />
                      {t('nav.configuration')}
                    </button>
                  </article>
                )}
                <Link to={PATHS.dashboard} onClick={() => setIsMenuOpen(false)} className={styles.mobileNavLink}>
                  <Icon src={gridIcon} size={20} className={styles.mobileNavIcon} />
                  {t('nav.dashboard')}
                </Link>
                
                <article 
                  className={`${styles.mobileNavLink} ${styles.mobileNotificationItem}`}
                  onClick={(e) => {
                    // Only trigger if clicking the empty space or the text, NOT the dropdown panel
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'ARTICLE' || target.tagName === 'SPAN') {
                      const bellBtn = e.currentTarget.querySelector('button');
                      if (bellBtn) {
                        bellBtn.click();
                      }
                    }
                  }}
                >
                  <NotificationBell className={styles.mobileNavBellWrapper} />
                  <span className={styles.mobileNavText}>{t('nav.notifications')}</span>
                </article>

                <button onClick={() => { setIsProfileOpen(true); setIsMenuOpen(false); }} className={styles.mobileNavLink}>
                  <Icon src={userIcon} size={20} className={styles.mobileNavIcon} />
                  {t('nav.profile')}
                </button>
              </nav>
            )}

            <LanguageSwitcher className={styles.language} />

            {isAuthenticated ? (
              <ProfileAndBellDesktop />
            ) : !isLoading && (
              <nav className={styles.authButtons}>
                <Link to={PATHS.login} className={styles.loginBtn}>{t('nav.logIn')}</Link>
                <Link to={PATHS.signup} className={styles.signupBtn}>{t('nav.signUp')}</Link>
              </nav>
            )}
          </nav>
        </section>
      </header>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </>
  );
};

export default Header;

