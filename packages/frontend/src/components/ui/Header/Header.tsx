import React, { useState } from 'react';
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

  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const Logo = () => (
    <Link to="/" className={styles.logo}>
      <img src={logoMockia} alt="" className={styles.logoImg} />
      <span className={styles.logoText}>Mock<span className={styles.highlight}>IA</span>.io</span>
    </Link>
  );

  const ProfileAndBell = () => (
    <div className={styles.rightContent}>
      <NotificationBell />
      <button className={styles.iconButton} onClick={() => setIsProfileOpen(true)} title="Profile">
        <img src={userIcon} alt="Profile" className={styles.profileIcon} />
      </button>
    </div>
  );

  // 1. Auth Pages Header: Minimal design (Logo only) for Login and Signup
  if (isAuthPage) {
    return (
      <header className={`${styles.header} ${styles.authHeader}`}>
        <Logo />
      </header>
    );
  }

  // 2. Landing Page Header: Full marketing navigation and auth buttons
  if (isLanding) {
    return (
      <>
        <header className={`${styles.header} ${styles.landingHeader}`}>
          <div className={styles.headerContainer}>
            <div className={styles.leftSection}>
              <Logo />
            </div>

            <div className={styles.authButtons}>
              {isAuthenticated ? (
                <ProfileAndBell />
              ) : (
                <>
                  <Link to="/login" className={styles.loginBtn}>Log In</Link>
                  <Link to="/signup" className={styles.signupBtn}>Sign up</Link>
                </>
              )}
            </div>
          </div>
        </header>
        <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
      </>
    );
  }

  // 3. Main App Header: Dashboard & Editor view with Notifications and Profile
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerContainer}>
          <div className={styles.leftSection}>
            <Logo />
          </div>
          <ProfileAndBell />
        </div>
      </header>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </>
  );
};

export default Header;
