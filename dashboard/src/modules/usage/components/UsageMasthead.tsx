// UsageMasthead — the page header: the "Usage" title, a subtitle line, and a
// right-aligned freshness indicator on the live page.

import { LastUpdated } from '../../../common';
import styles from './UsageMasthead.module.css';

interface UsageMastheadProps {
  subtitle: string;
  /** Epoch ms of the latest successful fetch; drives the live "Updated …" badge. Omitted for demo data. */
  updatedAt?: number;
}

export function UsageMasthead({ subtitle, updatedAt }: UsageMastheadProps) {
  return (
    <div className={styles.masthead}>
      <div className={styles.text}>
        <h1 className={styles.title}>Usage</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      {updatedAt != null && <LastUpdated at={updatedAt} />}
    </div>
  );
}
