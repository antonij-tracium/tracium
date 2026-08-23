import styles from './AuthPreview.module.css';
import { Dashboard } from '../../shell';
import { QueryProvider } from '../../../common/providers/QueryProvider';
import { APIProvider } from '../../../common/providers/APIProvider';

const PREVIEW_CONFIG = {
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8090',
  apiKey: 'demo',
};

/**
 * Live, fully-interactive preview of the real product shown on the auth
 * screens. It renders the actual Dashboard in embedded mode (seeded with the
 * same Demo workspace every new account gets), so prospective users can click
 * around and explore exactly what they'll get before signing up. Embedded mode
 * keeps all state in memory, so the preview never touches the real app's
 * persisted state.
 */
export function AuthPreview() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.window}>

        {/* ── Window chrome ── */}
        <div className={styles.chrome}>
          <div className={styles.lights}>
            <span className={`${styles.light} ${styles.red}`} />
            <span className={`${styles.light} ${styles.yellow}`} />
            <span className={`${styles.light} ${styles.green}`} />
          </div>
          <span className={styles.chromeTitle}>Tracium Dashboard</span>
          <span className={styles.chromeUrl}>tracium.ai</span>
        </div>

        {/* ── Live product preview ── */}
        <div className={styles.body}>
          <QueryProvider>
            <APIProvider config={PREVIEW_CONFIG}>
              <Dashboard embedded />
            </APIProvider>
          </QueryProvider>
        </div>
      </div>
    </div>
  );
}
