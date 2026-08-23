import { ReactNode } from 'react';
import styles from './AuthCard.module.css';

interface AuthCardProps {
  children: ReactNode;
  className?: string;
}

export function AuthCard({ children, className = '' }: AuthCardProps) {
  return (
    <div className={`${styles.card} ${className}`}>
      <div className={styles.glow} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
