import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '../components/ui/Icon/Icon'
import gridIcon from '../assets/grid.svg'
import settingsIcon from '../assets/settings.svg'
import userIcon from '../assets/user.svg'

import { Footer } from '../components/ui/Footer/Footer'
import ProfileModal from '../components/projects/ProfileModal'

import styles from './Layout.module.scss'

interface LayoutProps {
  onOpenProjectSettings?: () => void;
}

const Layout: React.FC<React.PropsWithChildren<LayoutProps>> = ({ children, onOpenProjectSettings }) => {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('mockia_sidebar_collapsed')
    return saved === 'true'
  })
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  const toggleSidebar = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('mockia_sidebar_collapsed', String(newState))
  }

  const isProjectPage = location.pathname.startsWith('/editor/')

  const navItems = [
    { label: 'DashBoard', path: '/dashboard', icon: <Icon src={gridIcon} />, visible: true },
    { label: 'Configuration', onClick: onOpenProjectSettings, icon: <Icon src={settingsIcon} />, visible: isProjectPage && !!onOpenProjectSettings },
    { label: 'Profile', onClick: () => setIsProfileOpen(true), icon: <Icon src={userIcon} />, visible: true },
  ]

  return (
    <div className={`${styles.layout} ${isCollapsed ? styles.collapsed : ''}`}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        {/* Toggle Button */}
        <button 
          onClick={toggleSidebar}
          className={styles.toggleBtn}
        >
          {isCollapsed ? '→|' : '|←'}
        </button>

        <nav className={styles.nav}>
          <ul className={styles.navList}>
            {navItems.filter(i => i.visible).map((item) => (
              <li key={item.label}>
                {item.path ? (
                  <NavLink 
                    to={item.path} 
                    className={({ isActive }) => 
                      `${styles.navLink} ${isActive ? styles.active : ''} ${isCollapsed ? styles.collapsed : ''}`
                    }
                    title={isCollapsed ? item.label : ''}
                  >
                    <span className={styles.iconBox}>{item.icon}</span>
                    {!isCollapsed && <span>{item.label}</span>}
                  </NavLink>
                ) : (
                  <button 
                    onClick={item.onClick}
                    className={`${styles.navLink} ${isCollapsed ? styles.collapsed : ''}`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <span className={styles.iconBox}>{item.icon}</span>
                    {!isCollapsed && <span>{item.label}</span>}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* Main Content Area */}
      <div className={styles.mainWrapper}>
        <main className={styles.main}>
          <section className={styles.container}>{children}</section>
        </main>
      </div>

      {/* Footer spans across the bottom row */}
      <div className={styles.footerWrapper}>
        <Footer />
      </div>
    </div>
  )
}

export default Layout
