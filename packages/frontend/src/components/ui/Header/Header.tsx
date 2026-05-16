import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.scss';
import { useAuth } from '../../../contexts/AuthContext';
import userIcon from '../../../assets/user.svg';
import logoMockia from '../../../assets/LogoMockia.png';
import ProfileModal from '../../projects/ProfileModal/ProfileModal';
import NotificationBell from '../../notifications/NotificationBell/NotificationBell';

const Header: React.FC = () => {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const path = location.pathname;
  
  // Determine variant based on path
  const isLanding = path === '/';
  const isAuthPage = path === '/login' || path === '/signup';
  const isProjectPage = path.startsWith('/editor/');

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [path]);

  const openSettings = () => {
    document.dispatchEvent(new CustomEvent('open-project-settings'));
    setIsMenuOpen(false);
  };

  const Logo = () => (
    <Link to="/" className={styles.logo}>
      <img src={logoMockia} alt="" className={styles.logoImg} />
      <span className={styles.logoText}>Mock<span className={styles.highlight}>IA</span>.io</span>
    </Link>
  );

  const ProfileAndBell = () => (
    <div className={styles.rightContent}>
      <div className={styles.actionItem}>
        <NotificationBell />
        <span className={styles.actionLabel}>Notifications</span>
      </div>
      <button className={styles.iconButton} onClick={() => { setIsProfileOpen(true); setIsMenuOpen(false); }} title="Profile">
        <div className={styles.actionItem}>
          <img src={userIcon} alt="Profile" className={styles.profileIcon} />
          <span className={styles.actionLabel}>Profile</span>
        </div>
      </button>
    </div>
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
        <div className={styles.headerContainer}>
          <div className={styles.leftSection}>
            <Logo />
          </div>

          <HamburgerBtn />

          {isMenuOpen && <div className={styles.menuBackdrop} onClick={() => setIsMenuOpen(false)} />}

          <div className={`${styles.navActions} ${isMenuOpen ? styles.menuOpen : ''}`}>
            {isAuthenticated && (
              <div className={styles.mobileOnlyLinks}>
                <Link to="/dashboard" onClick={() => setIsMenuOpen(false)} className={styles.mobileNavLink}>Dashboard</Link>
                {isProjectPage && (
                  <button onClick={openSettings} className={styles.mobileNavLink}>Configuration</button>
                )}
              </div>
            )}

            {isAuthenticated ? (
              <ProfileAndBell />
            ) : (
              <div className={styles.authButtons}>
                <Link to="/login" className={styles.loginBtn}>Log In</Link>
                <Link to="/signup" className={styles.signupBtn}>Sign up</Link>
              </div>
            )}
          </div>
        </div>
      </header>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </>
  );
};

export default Header;

