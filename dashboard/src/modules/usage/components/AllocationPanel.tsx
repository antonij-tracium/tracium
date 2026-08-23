import { useState } from 'react';
import { costFormatter, tokenFormatter } from '../../../common';
import { useAttributeKeys, useAttributeUsage } from '../hooks/useUsage';

// AllocationPanel lets the operator pick any custom attribute the instrumentation
// tags spans with (team, user.id, environment, …) and see AI spend allocated
// across its values — the "who is this costing me" view. Fed by
// GET /v1/metrics/attribute-keys and /usage-by-attribute. Renders nothing until
// at least one custom attribute has been ingested.
export function AllocationPanel({ range }: { range: string }) {
  const keysQ = useAttributeKeys(range);
  const keys = keysQ.data?.items ?? [];
  const [picked, setPicked] = useState('');
  const active = picked || keys[0] || '';
  const usageQ = useAttributeUsage(range, active);
  const rows = usageQ.data?.items ?? [];

  if (keys.length === 0) return null;

  const cell: React.CSSProperties = { padding: '6px 10px' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Cost allocation</h3>
        <select
          value={active}
          onChange={(e) => setPicked(e.target.value)}
          style={{
            padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)',
            background: 'var(--background)', color: 'var(--foreground)', fontSize: 13, fontFamily: 'inherit',
          }}
        >
          {keys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th style={cell}>{active}</th>
            <th style={num}>Cost</th>
            <th style={num}>Runs</th>
            <th style={num}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={cell}>{r.value || '—'}</td>
              <td style={num}>{costFormatter.format(r.cost)}</td>
              <td style={num}>{r.runs}</td>
              <td style={num}>{tokenFormatter.format(r.input_tokens + r.output_tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
