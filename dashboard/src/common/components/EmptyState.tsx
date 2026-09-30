interface EmptyStateProps {
  message: string;
  description?: string;
}

export function EmptyState({ message, description }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        color: 'var(--muted-foreground)',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: '17px', fontWeight: 500, margin: '0 0 8px' }}>{message}</p>
      {description && (
        <p style={{ fontSize: '15px', margin: 0 }}>{description}</p>
      )}
    </div>
  );
}
