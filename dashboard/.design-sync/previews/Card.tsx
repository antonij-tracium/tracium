import { Card, CardHeader, StatusPill, CostTag, Duration } from 'tracium-dashboard';

export const WithHeader = () => (
  <Card style={{ width: 360 }}>
    <CardHeader title="Trace summary" subtitle="tr_9f2a·checkout-agent" right={<StatusPill status="completed" />} />
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', fontSize: 13, color: 'var(--muted)' }}>
      <span>Cost <CostTag usd={0.0182} /></span>
      <span>Duration <Duration ms={4200} /></span>
      <span>Spans 24</span>
    </div>
  </Card>
);

export const Plain = () => (
  <Card style={{ width: 360, padding: 20, fontSize: 13, color: 'var(--foreground)' }}>
    A bare surface container — border, radius, and background from the DS tokens.
    Compose any content inside.
  </Card>
);
