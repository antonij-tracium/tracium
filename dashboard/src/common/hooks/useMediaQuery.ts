import { useState, useEffect } from 'react';

/**
 * Shared layout breakpoints (viewport width, px). The app's inline-style
 * components can't use CSS media queries, so structural reflows (e.g. the
 * sidebar drawer, two-column → one-column stacking) read these via
 * useMediaQuery / useBreakpoint instead.
 */
export const BREAKPOINTS = {
  /** Phone — sidebar becomes an off-canvas drawer below this. */
  mobile: 900,
  /** Small tablet — macro two-column layouts stack below this. */
  tablet: 1100,
} as const;

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * Re-renders the component when the match state changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is at most `maxWidth` px wide. */
export function useMaxWidth(maxWidth: number): boolean {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}
