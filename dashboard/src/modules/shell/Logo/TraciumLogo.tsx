import React from 'react';

interface TraciumLogoProps {
  size?: number;
}

export function TraciumLogo({ size = 26 }: TraciumLogoProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="7" y="7" width="7" height="7" rx="1.5" fill="var(--accent-contrast)" />
      <rect x="18" y="7" width="7" height="7" rx="1.5" fill="var(--accent-contrast)" opacity="0.5" />
      <rect x="7" y="18" width="7" height="7" rx="1.5" fill="var(--accent-contrast)" opacity="0.5" />
      <rect x="18" y="18" width="7" height="7" rx="1.5" fill="var(--accent-contrast)" />
    </svg>
  );
}
