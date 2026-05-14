import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.scss';
import { Icon } from '../Icon/Icon';
import userIcon from '../../../assets/user.svg';
import ProfileModal from '../../projects/ProfileModal/ProfileModal';
import NotificationBell from '../../notifications/NotificationBell/NotificationBell';

const Header: React.FC = () => {
  const location = useLocation();
  const path = location.pathname;
  
  // Determine variant based on path
  const isLanding = path === '/';
  const isAuthPage = path === '/login' || path === '/signup';

  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // 1. Auth Pages Header: Minimal design (Logo only) for Login and Signup
  if (isAuthPage) {
    return (
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>Mockia.io</Link>
      </header>
    );
  }

  // 2. Landing Page Header: Full marketing navigation and auth buttons
  if (isLanding) {
    return (
      <header className={styles.header}>
        <div className={styles.leftSection}>
          <Link to="/" className={styles.logo}>Mockia.io</Link>
          <nav className={styles.nav}>
            <Link to="/docs" className={styles.navLink}>Docs</Link>
            <Link to="/api" className={styles.navLink}>Api Reference</Link>
            <Link to="/community" className={styles.navLink}>Community</Link>
          </nav>
        </div>
        <div className={styles.authButtons}>
          <Link to="/login" className={styles.loginBtn}>Log In</Link>
          <Link to="/signup" className={styles.signupBtn}>Sign up</Link>
        </div>
      </header>
    );
  }

  // 3. Main App Header: Dashboard & Editor view with Notifications and Profile
  return (
    <header className={styles.header}>
      <Link to="/dashboard" className={styles.logo}>Mockia.io</Link>
      <div className={styles.rightContent}>
        <NotificationBell />
        <button className={styles.iconButton} onClick={() => setIsProfileOpen(true)} title="Profile">
          <Icon src={userIcon} />
        </button>
      </div>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </header>
  );
};

export default Header;
