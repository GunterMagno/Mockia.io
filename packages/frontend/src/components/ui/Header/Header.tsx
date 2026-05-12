import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import styles from './Header.module.scss';
import { Icon } from '../Icon/Icon';
import userIcon from '../../../assets/user.svg';
import bellIcon from '../../../assets/bell.svg';
import ProfileModal from '../../projects/ProfileModal';

const Header: React.FC = () => {
  const location = useLocation();
  const { id: projectId } = useParams();
  const path = location.pathname;
  
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);

  // Determine variant based on path
  const isLanding = path === '/';
  const isAuthPage = path === '/login' || path === '/signup';
  const isProjectPage = path.startsWith('/editor/');


  // Type 4: Minimal (Logo only)
  if (isAuthPage) {
    return (
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>Mockia.io</Link>
      </header>
    );
  }

  // Type 3: Landing (Logo, Links, Buttons)
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

  // Type 2: Project (Logo, Title, Bell, User)
  if (isProjectPage) {
    return (
      <header className={styles.header}>
        <Link to="/dashboard" className={styles.logo}>Mockia.io</Link>
        <div className={styles.rightContent}>
          <button className={styles.iconButton} title="Notifications">
            <Icon src={bellIcon} />
          </button>
          <button className={styles.iconButton} onClick={() => setIsProfileOpen(true)} title="Profile">
            <Icon src={userIcon} />
          </button>
        </div>
        <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
      </header>
    );
  }

  // Type 1: Authenticated (Logo, Bell, User)
  return (
    <header className={styles.header}>
      <Link to="/dashboard" className={styles.logo}>Mockia.io</Link>
      <div className={styles.rightContent}>
        <button className={styles.iconButton} title="Notifications">
          <Icon src={bellIcon} />
        </button>
        <button className={styles.iconButton} onClick={() => setIsProfileOpen(true)} title="Profile">
          <Icon src={userIcon} />
        </button>
      </div>
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </header>
  );
};

export default Header;
