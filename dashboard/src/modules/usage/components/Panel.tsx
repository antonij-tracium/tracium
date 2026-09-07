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
  /**
   * Cap the content to the panel's available height and scroll overflow inside
   * it, instead of letting tall content grow the panel. Used by the shorter
   * partner in a PanelFrame so a long list matches the chart beside it rather
   * than leaving blank space next to it. Enable only on the wide layout — when
   * stacked, the panel has no sibling to borrow its height from.
   */
  scroll?: boolean;
  children: React.ReactNode;
}

export function Panel({ eyebrow, title, right, scroll = false, children }: PanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <span className={styles.title}>{title}</span>
        </div>
        {right && <div className={styles.right}>{right}</div>}
      </div>
      <div className={`${styles.content} ${scroll ? styles.scrollHost : ''}`}>
        {scroll ? <div className={styles.scroller}>{children}</div> : children}
      </div>
    </div>
  );
}
