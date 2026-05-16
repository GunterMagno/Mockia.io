import React from 'react'

interface IconProps {
  src: string
  size?: number | string
  color?: string
  className?: string
}

import styles from './Icon.module.scss'

export const Icon: React.FC<IconProps> = ({ src, size = 24, color = 'currentColor', className = '' }) => {
  const iconSize = typeof size === 'number' ? `${size}px` : size;
  
  return (
    <figure 
      className={`${styles.icon} ${className}`}
      style={{
        '--icon-size': iconSize,
        '--icon-color': color,
        '--icon-url': `url("${src}")`,
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`
      } as React.CSSProperties}
    />
  )
}

export default Icon
