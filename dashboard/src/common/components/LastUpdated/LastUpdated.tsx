// LastUpdated — live freshness indicator (a dot + relative time) shown in a
// page header. Shared across the signed-in pages so the badge looks and behaves
// identically everywhere.
//
// Two usage modes:
//   • Pass `at` (epoch ms) — renders "Updated <relative>" and self-ticks every
//     10s so the label stays current between fetches. Used by Agents/Users.
//   • Pass `label` — renders that text verbatim (no ticking). Used by the
//     overview Masthead, which computes its own "Synced …" label across several
//     queries.
//
// `tone` drives the dot color, the live-pulse glow (live only) and the text
// color, so the indicator can tell the truth: green when fresh, amber when
// stale, red when a section failed to load.

import { useEffect, useState } from 'react';

export type SyncTone = 'live' | 'stale' | 'error' | 'syncing';

const TONE_COLOR: Record<SyncTone, string> = {
  live: 'var(--accent)',
  stale: 'var(--warning)',
  error: 'var(--error)',
  syncing: 'var(--muted)',
};

function relativeTime(sinceMs: number): string {
  const s = Math.max(0, Math.round(sinceMs / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export interface LastUpdatedProps {
  /** Epoch ms of the last successful fetch. Used to derive the label when `label` is omitted. */
  at?: number;
  /** Explicit label (e.g. "Synced 2m ago"); overrides the derived "Updated …" text. */
  label?: string;
  /** Freshness tone — drives dot color, the live-only glow, and text color. Defaults to 'live'. */
  tone?: SyncTone;
}

export function LastUpdated({ at, label, tone = 'live' }: LastUpdatedProps) {
  // Self-tick only when we derive the label from `at` (no explicit label).
  const ticking = label == null && at != null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [ticking]);

  const text = label ?? (at != null ? `Updated ${relativeTime(now - at)}` : '');
  const dotColor = TONE_COLOR[tone];
  const textColor = tone === 'live' || tone === 'syncing' ? 'var(--muted)' : dotColor;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12,
        color: textColor,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dotColor,
          // The glow ring reads as a live pulse; reserve it for the fresh state.
          boxShadow: tone === 'live' ? `0 0 0 3px color-mix(in srgb, ${dotColor} 18%, transparent)` : 'none',
        }}
      />
      {text}
    </div>
  );
}
