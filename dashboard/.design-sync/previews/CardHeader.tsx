import { Card, CardHeader, LastUpdated, StatusPill } from 'tracium-dashboard';

export const WithSubtitle = () => (
  <Card style={{ width: 380 }}>
    <CardHeader title="Cost over time" subtitle="Last 7 days · all tenants" />
    <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>chart body…</div>
  </Card>
);

export const WithRightSlot = () => (
  <Card style={{ width: 380 }}>
    <CardHeader title="Agents" right={<LastUpdated label="Synced 1m ago" tone="live" />} />
    <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>table body…</div>
  </Card>
);

export const TitleOnly = () => (
  <Card style={{ width: 380 }}>
    <CardHeader title="Recent traces" right={<StatusPill status="healthy" />} />
    <div style={{ padding: '20px', fontSize: 13, color: 'var(--muted)' }}>list body…</div>
  </Card>
);
