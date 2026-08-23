// Wraps one overview section so it can load independently: a centered spinner
// while fetching, an inline notice on error, otherwise the section content.

import React from 'react';
import { Spinner } from '../../../common';

interface SectionProps {
  isLoading: boolean;
  isError: boolean;
  minHeight?: number;
  children: React.ReactNode;
}

function Centered({ minHeight, children }: { minHeight: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

export function Section({ isLoading, isError, minHeight = 120, children }: SectionProps) {
  if (isLoading) {
    return (
      <Centered minHeight={minHeight}>
        <Spinner />
      </Centered>
    );
  }
  if (isError) {
    return <Centered minHeight={minHeight}>Failed to load</Centered>;
  }
  return <>{children}</>;
}
