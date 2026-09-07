import styles from './AuthBackground.module.css';

export function AuthBackground() {
  return (
    <div className={styles.container}>
      <div className={styles.drift} />
      <div className={styles.grid} />
      <div className={styles.glow} />
      <div className={styles.vignette} />
    </div>
  );
}
