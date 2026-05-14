import React from 'react';
import styles from './Button.module.scss';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

import { Icon } from '../Icon/Icon';
import loaderIcon from '../../../assets/loader.svg';

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', isLoading, className, children, ...rest }) => {
  const cls = [styles.btn, styles[variant], styles[size], className, isLoading ? styles.loading : ''].filter(Boolean).join(' ');
  return (
    <button {...rest} className={cls} disabled={rest.disabled || !!isLoading}>
      {isLoading ? <Icon src={loaderIcon} size={size === 'sm' ? 14 : 18} /> : children}
    </button>
  );
};

export default Button;
