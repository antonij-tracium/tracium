import React from 'react';

// The brand primary CTA: a flat accent button with an angled "slice" cut off
// its trailing edge, matching the auth / docs primary button. Disabled renders
// a muted accent fill. Extends the native button so callers pass onClick,
// type, title, etc. directly; `style` merges over the defaults.

const SLICE = 'polygon(0 0, 100% 0, 94% 100%, 0% 100%)';

export interface SlicedButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function SlicedButton({ disabled, style, children, ...rest }: SlicedButtonProps) {
  return (
    <button
      disabled={disabled}
      style={{
        padding: '9px 22px 9px 16px',
        background: disabled
          ? 'color-mix(in srgb, var(--accent) 35%, transparent)'
          : 'var(--accent)',
        border: 'none',
        borderRadius: 0,
        clipPath: SLICE,
        color: 'var(--accent-contrast)',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
