import React, { useState } from 'react';
import { Icon } from '../Icon/Icon';
import eyeIcon from '../../../assets/eye.svg';
import eyeOffIcon from '../../../assets/eye-off.svg';
import styles from './Input.module.scss';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, type, ...rest }) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  const togglePassword = () => {
    setShowPassword(!showPassword);
  };

  const content = (
    <article className={styles.inputWrapper}>
      <input 
        className={`${styles.input} ${isPassword ? styles.passwordInput : ''} ${rest.className || ''}`} 
        type={inputType} 
        {...rest} 
      />
      {isPassword && (
        <button 
          type="button" 
          className={styles.toggleButton} 
          onClick={togglePassword}
          tabIndex={-1}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <Icon src={showPassword ? eyeOffIcon : eyeIcon} size={20} />
        </button>
      )}
    </article>
  );

  if (!label) return content;

  return (
    <fieldset className={styles.field}>
      <label className={styles.label}>{label}</label>
      {content}
      {error && <span className={styles.error}>{error}</span>}
    </fieldset>
  );
};

export default Input;
