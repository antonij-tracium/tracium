const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    backgroundColor: 'var(--surface-active)',
    color: 'var(--muted-foreground)',
  },
  error: {
    backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
    color: 'var(--error)',
  },
  success: {
    backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)',
    color: 'var(--success)',
  },
};

interface BadgeProps {
  label: string;
  variant?: 'default' | 'error' | 'success';
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
  const style: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    ...variantStyles[variant],
  };

  return <span style={style}>{label}</span>;
}
