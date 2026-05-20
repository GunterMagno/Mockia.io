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

const Header: React.FC = () => {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const path = location.pathname;
  
  // Determine variant based on path
  const validPaths = ['/', '/login', '/signup', '/terms', '/privacy', '/dashboard'];
  const isProjectPage = path.startsWith('/editor/');
  const is404 = !validPaths.includes(path) && !isProjectPage;

  const isLanding = path === '/';
  const isAuthPage = path === '/login' || path === '/signup' || is404;

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

  const openSettings = () => {
    document.dispatchEvent(new CustomEvent('open-project-settings'));
    setIsMenuOpen(false);
  };

  const Logo = () => (
    <Link to="/" className={styles.logo}>
      <img src={logoMockia} alt="" className={styles.logoImg} />
      <span className={styles.logoText}>Mock<span className={styles.highlight}>IA</span></span>
    </Link>
  );

  const ProfileAndBellDesktop = () => (
    <nav className={`${styles.rightContent} ${styles.desktopOnly}`}>
      <Link to="/dashboard" className={styles.iconButton} title="Dashboard">
        <article className={styles.actionItem}>
          <Icon src={gridIcon} size={24} />
          <span className={styles.actionLabel}>Dashboard</span>
        </article>
      </Link>
      <article className={styles.actionItem}>
        <NotificationBell />
        <span className={styles.actionLabel}>Notifications</span>
      </article>
      <button className={styles.iconButton} onClick={() => { setIsProfileOpen(true); setIsMenuOpen(false); }} title="Profile">
        <article className={styles.actionItem}>
          <img src={userIcon} alt="Profile" className={styles.profileIcon} />
          <span className={styles.actionLabel}>Profile</span>
        </article>
      </button>
    </nav>
  );

  const HamburgerBtn = () => (
    <button 
      className={`${styles.hamburgerBtn} ${isMenuOpen ? styles.menuOpen : ''}`} 
      onClick={() => setIsMenuOpen(!isMenuOpen)}
      aria-label="Toggle menu"
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
      </header>
    );
  }

  // 2. Landing & Main App Header with responsive Hamburger Menu
  return (
    <>
      <header className={`${styles.header} ${isLanding ? styles.landingHeader : ''}`}>
        <section className={styles.headerContainer}>
          <article className={styles.leftSection}>
            <Logo />
          </article>

          {isProjectPage && projectName && (
            <article className={styles.centerSection}>
              <span className={styles.projectName}>{projectName}</span>
              <button onClick={openSettings} className={styles.settingsIconBtn} title="Project Settings">
                <Icon src={settingsIcon} size={20} className={styles.settingsIcon} />
              </button>
            </article>
          )}

          <HamburgerBtn />

          {isMenuOpen && <article className={styles.menuBackdrop} onClick={() => setIsMenuOpen(false)} />}

          <nav className={`${styles.navActions} ${isMenuOpen ? styles.menuOpen : ''}`}>
            {isAuthenticated && (
              <nav className={styles.mobileOnlyLinks}>
                {isProjectPage && projectName && (
                  <article className={styles.mobileProjectNameContainer}>
                    <span className={styles.mobileProjectName}>{projectName}</span>
                    <button onClick={openSettings} className={styles.mobileSettingsHeaderBtn}>
                      <img src={settingsIcon} alt="Configuration" className={styles.mobileNavIcon} />
                      Configuration
                    </button>
                  </article>
                )}
                <Link to="/dashboard" onClick={() => setIsMenuOpen(false)} className={styles.mobileNavLink}>
                  <img src={gridIcon} alt="Dashboard" className={styles.mobileNavIcon} />
                  Dashboard
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
                  <span className={styles.mobileNavText}>Notifications</span>
                </article>

                <button onClick={() => { setIsProfileOpen(true); setIsMenuOpen(false); }} className={styles.mobileNavLink}>
                  <img src={userIcon} alt="Profile" className={styles.mobileNavIcon} />
                  Profile
                </button>
              </nav>
            )}

            {isAuthenticated ? (
              <ProfileAndBellDesktop />
            ) : (
              <nav className={styles.authButtons}>
                <Link to="/login" className={styles.loginBtn}>Log In</Link>
                <Link to="/signup" className={styles.signupBtn}>Sign up</Link>
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

