import React from 'react'
import styles from './AmbientBackground.module.scss'

/** Capa animada global: vive en el shell, asi la animacion no se corta al cambiar de seccion o ruta. */
export const AmbientBackground: React.FC = () => (
  <div className={styles.ambient} aria-hidden="true">
    <span className={`${styles.blob} ${styles.a}`} />
    <span className={`${styles.blob} ${styles.b}`} />
    <span className={`${styles.blob} ${styles.c}`} />
    <span className={styles.grid} />
  </div>
)

export default AmbientBackground
