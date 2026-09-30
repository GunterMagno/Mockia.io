import React, { useId, useState } from 'react';
import { Icon } from '../Icon/Icon';
import eyeIcon from '../../../assets/eye.svg';
import eyeOffIcon from '../../../assets/eye-off.svg';
import styles from './Input.module.scss';
import { useI18n } from '../../../i18n/I18nProvider';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, type, id, className, ...rest }) => {
  const { t } = useI18n();
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  const togglePassword = () => {
    setShowPassword(!showPassword);
  };

  const content = (
    <article className={styles.inputWrapper}>
      <input 
        {...rest}
        id={inputId}
        className={`${styles.input} ${isPassword ? styles.passwordInput : ''} ${className || ''}`} 
        type={inputType} 
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {isPassword && (
        <button 
          type="button" 
          className={styles.toggleButton} 
          onClick={togglePassword}
          tabIndex={-1}
          aria-label={showPassword ? t('input.hidePassword') : t('input.showPassword')}
        >
          <Icon src={showPassword ? eyeOffIcon : eyeIcon} size={20} />
        </button>
      )}
    </article>
  );

  if (!label) return content;

  return (
    <fieldset className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      {content}
      {error && <span id={errorId} className={styles.error}>{error}</span>}
    </fieldset>
  );
};

export default Input;
