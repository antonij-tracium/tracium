import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './AuthButton.module.css';

interface AuthButtonProps {
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function AuthButton({
  href,
  onClick,
  type = 'button',
  variant = 'primary',
  children,
  className = '',
  disabled,
}: AuthButtonProps) {
  const cls = `${styles.base} ${variant === 'primary' ? styles.primary : styles.secondary} ${className}`.trim();

  if (href) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} className={cls} disabled={disabled}>
      {children}
    </button>
  );
}
