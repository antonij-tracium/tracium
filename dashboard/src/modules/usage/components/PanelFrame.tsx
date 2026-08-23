// PanelFrame — a bounded two-column frame split by a rule, holding a pair of
// Panels. The left panel gets more width (the chart needs it); on tablet and
// below the two stack and the divider flips from vertical to horizontal. Mirrors
// the overview ChartsRow frame.

import React from 'react';
import type { CSSProperties } from 'react';
import { useMaxWidth, BREAKPOINTS } from '../../../common';
import styles from './PanelFrame.module.css';

interface PanelFrameProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Grid template for the wide layout. Defaults to a wider left column. */
  columns?: string;
}

export function PanelFrame({ left, right, columns = '1.4fr 1fr' }: PanelFrameProps) {
  const stacked = useMaxWidth(BREAKPOINTS.tablet);

  return (
    <div
      className={styles.frame}
      style={{ gridTemplateColumns: stacked ? '1fr' : columns } as CSSProperties}
    >
      <div className={`${styles.cell} ${stacked ? styles.stackDivider : styles.divider}`}>
        {left}
      </div>
      <div className={styles.cell}>{right}</div>
    </div>
  );
}
