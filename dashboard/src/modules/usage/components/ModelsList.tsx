// ModelsList — minimal "where it goes" list: one row per model with a share bar.

import type { CSSProperties } from 'react';
import { costFormatter, tokenFormatter, fmtNum } from '../../../common';
import type { ModelSummary } from '../interfaces';
import styles from './ModelsList.module.css';

export function ModelsList({ models }: { models: ModelSummary[] }) {
  const total = models.reduce((s, m) => s + m.cost, 0) || 1;

  return (
    <div className={styles.list}>
      {models.map((m) => {
        const pct = (m.cost / total) * 100;
        return (
          <div
            key={m.name}
            className={styles.row}
            style={{ '--swatch': m.color } as CSSProperties}
          >
            <div className={styles.head}>
              <div className={styles.name}>
                <span className={styles.swatch} />
                <span className={styles.modelName}>{m.name}</span>
              </div>
              <div className={styles.figures}>
                <span className={styles.cost}>{costFormatter.format(m.cost)}</span>
                <span className={styles.pct}>{pct.toFixed(0)}%</span>
              </div>
            </div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ '--pct': pct + '%' } as CSSProperties} />
            </div>
            <div className={styles.meta}>
              <span>{fmtNum(m.runs)} runs</span>
              <span>{tokenFormatter.format(m.inputTokens + m.outputTokens)} tokens</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
