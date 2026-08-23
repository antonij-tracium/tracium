// SectionHead — one consistent section header: big title, optional hint, faint
// rule above. Shared by the demo UsagePage and the live UsageLivePage.

import React from 'react';
import styles from './SectionHead.module.css';

export interface SectionHeadProps {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  first?: boolean;
}

export function SectionHead({ title, hint, right, first = false }: SectionHeadProps) {
  return (
    <header className={`${styles.head} ${first ? styles.first : ''}`}>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
      {right && <div className={styles.right}>{right}</div>}
    </header>
  );
}
