import styles from './AuthBackground.module.css';

export function AuthBackground() {
  return (
    <div className={styles.container}>
      <div className={styles.lineFirst} />
      <div className={styles.lineSecond} />
    </div>
  );
}
