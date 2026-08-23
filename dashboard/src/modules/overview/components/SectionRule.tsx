// Editorial section header: an eyebrow + title (+ optional subtitle) on the
// left, optional controls on the right, separated from its content by a single
// rule. Used by every inline section on the overview (no cards, just rules and
// whitespace).

import React from 'react';

interface SectionRuleProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}

export function SectionRule({ eyebrow, title, subtitle, right, style }: SectionRuleProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        paddingBottom: 14,
        marginBottom: 22,
        borderBottom: '1px solid var(--border)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {eyebrow && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--muted)',
            }}
          >
            {eyebrow}
          </span>
        )}
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--foreground)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </span>
        {subtitle && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{subtitle}</span>}
      </div>
      {right}
    </div>
  );
}
