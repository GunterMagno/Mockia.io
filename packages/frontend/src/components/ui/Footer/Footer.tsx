import React from 'react'
import { Link } from 'react-router-dom'
import styles from './Footer.module.scss'

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div>&copy; {new Date().getFullYear()} Mockia.io - Intelligent Mock API Generator</div>
        <div className={styles.links}>
          <a 
            href="https://github.com/GunterMagno/Mockia.io/tree/main/docs" 
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
          <Link to="/terms" className={styles.link}>Terms</Link>
          <Link to="/privacy" className={styles.link}>Privacy</Link>
        </div>
      </div>
    </footer>
  )
}

export default Footer
