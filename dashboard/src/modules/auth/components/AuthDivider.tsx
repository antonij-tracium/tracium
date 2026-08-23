import styles from './AuthDivider.module.css';

interface AuthDividerProps {
  text: string;
}

export function AuthDivider({ text }: AuthDividerProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.line} />
      <span className={styles.text}>{text}</span>
      <div className={styles.line} />
    </div>
  );
}
