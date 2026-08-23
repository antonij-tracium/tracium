// KpiStrip — the borderless headline numbers across the top of the usage page.
// Renders whatever tiles it's handed (Spend / Runs / Tokens today), separated by
// hairline column dividers.

import styles from './KpiStrip.module.css';

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface KpiItem {
  label: string;
  value: string;
  delta: string;
  deltaTone: DeltaTone;
  hint: string;
}

function Kpi({ label, value, delta, deltaTone, hint, last }: KpiItem & { last: boolean }) {
  return (
    <div className={`${styles.kpi} ${last ? styles.last : ''}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      <div className={styles.footer}>
        {delta && <span className={`${styles.delta} ${styles[deltaTone]}`}>{delta}</span>}
        <span className={styles.hint}>{hint}</span>
      </div>
    </div>
  );
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className={styles.strip}>
      {items.map((it, i) => (
        <Kpi key={it.label} {...it} last={i === items.length - 1} />
      ))}
    </div>
  );
}
