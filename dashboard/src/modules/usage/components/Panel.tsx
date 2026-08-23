// Panel — a titled content block used inside PanelFrame: an uppercase eyebrow, a
// title, and an optional right-aligned slot (legend, count, etc.) above the
// content. Mirrors the overview ChartsRow panel header so the two pages read the
// same.

import React from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export function Panel({ eyebrow, title, right, children }: PanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <span className={styles.title}>{title}</span>
        </div>
        {right && <div className={styles.right}>{right}</div>}
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
