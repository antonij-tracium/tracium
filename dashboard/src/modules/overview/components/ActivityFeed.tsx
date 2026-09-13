// Live activity — a flat, clickable list of recent trace events (no card). The
// caller owns the incoming items (the demo page simulates them; the live page
// polls recent traces); this component only owns the Live/Pause toggle, which
// freezes the displayed list so a row can be read without it scrolling away.

import { useEffect, useState } from 'react';
import { IconDot } from '../../../common';
import type { ActivityItem } from '../interfaces';
import type { ActivityId } from '../ids';
import { SectionRule } from './SectionRule';

interface ActivityFeedProps {
  items: ActivityItem[];
  onSelectTrace: (id: ActivityId) => void;
}

export function ActivityFeed({ items, onSelectTrace }: ActivityFeedProps) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(items);

  useEffect(() => {
    if (!paused) setFrozen(items);
  }, [items, paused]);

  const display = paused ? frozen : items;

  return (
    <div>
      <SectionRule
        eyebrow="Live"
        title="Activity"
        subtitle="Real-time trace events"
        right={
          <button
            onClick={() => setPaused((p) => !p)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--muted)',
              padding: '5px 10px',
              border: '1px solid var(--border)',
              borderRadius: 7,
              background: 'transparent',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: paused ? 'var(--muted)' : 'var(--accent)',
                boxShadow: paused ? 'none' : '0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent)',
              }}
            />
            {paused ? 'Paused' : 'Live'}
          </button>
        }
      />
      <div style={{ maxHeight: 420, overflowY: 'auto', margin: '-4px 0' }}>
        {display.map((it, i) => (
          <button
            key={it.id}
            onClick={() => onSelectTrace(it.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              alignItems: 'center',
              gap: 14,
              width: '100%',
              padding: '12px 4px',
              border: 'none',
              textAlign: 'left',
              borderBottom:
                i < display.length - 1 ? '1px solid color-mix(in srgb, var(--border) 55%, transparent)' : 'none',
              background: 'transparent',
              transition: 'background .12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--surface-alt) 60%, transparent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <IconDot size={7} color={it.status === 'failed' ? 'var(--error)' : 'var(--accent)'} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: 'var(--foreground)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {it.agent}
              </span>
              {it.msg && (
                <span style={{ fontSize: 12, color: it.status === 'failed' ? 'var(--error)' : 'var(--muted)' }}>
                  {it.msg}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>
              {it.latency.toFixed(1)}s
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', width: 64, textAlign: 'right' }}>{it.time}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
