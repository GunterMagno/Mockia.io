import React from 'react'

import styles from './Footer.module.scss'

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div>&copy; {new Date().getFullYear()} Mockia.io - Intelligent Mock API Generator</div>
        <div className={styles.links}>
          <a href="/docs" className={styles.link}>Documentation</a>
          <a href="/terms" className={styles.link}>Terms</a>
          <a href="/privacy" className={styles.link}>Privacy</a>
        </div>
      </div>
    </footer>
  )
}

export default Footer
