import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '../components/ui/Icon/Icon'
import gridIcon from '../assets/grid.svg'
import settingsIcon from '../assets/settings.svg'
import userIcon from '../assets/user.svg'

import { Footer } from '../components/ui/Footer/Footer'

import styles from './Layout.module.scss'

const Layout: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const isProjectPage = location.pathname.startsWith('/editor/')

  const navItems = [
    { label: 'DashBoard', path: '/dashboard', icon: <Icon src={gridIcon} />, visible: true },
    { label: 'Configuration', path: `/settings${location.pathname}`, icon: <Icon src={settingsIcon} />, visible: isProjectPage },
    { label: 'Profile', path: '/profile', icon: <Icon src={userIcon} />, visible: true },
  ]

  return (
    <div className={`${styles.layout} ${isCollapsed ? styles.collapsed : ''}`}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        {/* Toggle Button */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={styles.toggleBtn}
        >
          {isCollapsed ? '→|' : '|←'}
        </button>

        <nav className={styles.nav}>
          <ul className={styles.navList}>
            {navItems.filter(i => i.visible).map((item) => (
              <li key={item.path}>
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
              </li>
            ))}
          </ul>
        </nav>
      </aside>

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
