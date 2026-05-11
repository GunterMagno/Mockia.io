import React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import styles from './Header.module.scss';
import { Icon } from '../Icon/Icon';
import userIcon from '../../../assets/user.svg';
import bellIcon from '../../../assets/bell.svg';

const Header: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: projectId } = useParams();
  const path = location.pathname;

  // Determine variant based on path
  const isLanding = path === '/';
  const isAuthPage = path === '/login' || path === '/signup';
  const isProjectPage = path.startsWith('/editor/');
  const isAuthenticated = path === '/dashboard' || path.startsWith('/settings') || path === '/profile';

  // For the project variant, we show the project ID/Name
  const projectTitle = projectId || "Title of Project";

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
        <div className={styles.centerContent}>
          {projectTitle}
        </div>
        <div className={styles.rightContent}>
          <button className={styles.iconButton} title="Notifications">
            <Icon src={bellIcon} />
          </button>
          <button className={styles.iconButton} onClick={() => navigate('/profile')} title="Profile">
            <Icon src={userIcon} />
          </button>
        </div>
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
        <button className={styles.iconButton} onClick={() => navigate('/profile')} title="Profile">
          <Icon src={userIcon} />
        </button>
      </div>
    </header>
  );
};

export default Header;
