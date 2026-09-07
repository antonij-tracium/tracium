import React from 'react';

interface TraciumLogoProps {
  size?: number;
}

/**
 * The Tracium mark: an accent parallelogram over an ink descender that together
 * form a stylised "T". Colours are theme tokens so the mark tracks light/dark
 * surfaces — the ink polygon uses --foreground (matching the white-on-dark
 * brand variant), the top bar uses the brand accent.
 */
export function TraciumLogo({ size = 26 }: TraciumLogoProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="57.6 48.1 88.8 82.6"
      fill="none"
      role="img"
      aria-label="Tracium"
    >
      <polygon
        fill="var(--foreground)"
        points="114.6 130.7 82.2 130.7 82.2 112.3 114.6 80.5 114.6 80.5 114.6 130.7"
      />
      <polygon
        fill="var(--accent)"
        points="57.6 48.1 57.6 80.5 114.6 80.5 146.4 48.1 146.4 48.1 57.6 48.1"
      />
    </svg>
  );
}
