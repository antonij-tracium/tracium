import { Icon } from 'tracium-dashboard';

// The DS ships a named-icon set (IconHome, IconSearch, IconKey, …) built on
// this primitive; each is `Icon` bound to a path `d`. This showcase renders a
// representative sample through the primitive, on the app surface (dark DS).
const glyphs: { name: string; d: string }[] = [
  { name: 'home', d: 'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1v-9.5z' },
  { name: 'search', d: 'M11 4a7 7 0 015.2 11.8L21 20M13 18a7 7 0 01-7-7' },
  { name: 'key', d: 'M15 7a4 4 0 11-6.93 3.93L3 16v4h4v-3h3v-3l.07-.07A4 4 0 0115 7z' },
  { name: 'usage', d: 'M4 20V10M10 20V4M16 20v-6M22 20v-9' },
  { name: 'check', d: 'M5 12l5 5 9-11' },
  { name: 'alert', d: 'M12 9v4M12 17h.01M4.5 19h15a2 2 0 001.7-3L13.7 5a2 2 0 00-3.4 0L2.8 16a2 2 0 001.7 3z' },
  { name: 'zap', d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { name: 'settings', d: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 12c0-.4 0-.8-.1-1.2l2-1.5-2-3.5-2.3.9c-.6-.5-1.3-.9-2-1.2L14.6 3h-4l-.4 2.5c-.7.3-1.4.7-2 1.2L5.9 5.8l-2 3.5 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.5 2.3-.9c.6.5 1.3.9 2 1.2L9.4 21h4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z' },
];

const panel: React.CSSProperties = {
  display: 'inline-flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start',
  padding: '20px 24px', borderRadius: 10,
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--foreground)',
};
const cell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 64,
};

export const Set = () => (
  <div style={panel}>
    {glyphs.map((g) => (
      <div key={g.name} style={cell}>
        <Icon d={g.d} size={22} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{g.name}</span>
      </div>
    ))}
  </div>
);

export const Sizes = () => (
  <div style={{ ...panel, alignItems: 'center' }}>
    <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" size={16} />
    <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" size={24} />
    <Icon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" size={36} />
  </div>
);
