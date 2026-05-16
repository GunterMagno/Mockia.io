import React from 'react'
import { Link } from 'react-router-dom'
import styles from './Footer.module.scss'

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer}>
      <section className={styles.container}>
        <article>&copy; {new Date().getFullYear()} Mockia.io - Intelligent Mock API Generator</article>
        <nav className={styles.links}>
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
          <a 
            href="http://localhost:3000/api/docs" 
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            API Docs
          </a>
        </nav>
      </section>
    </footer>
  )
}

export default Footer
