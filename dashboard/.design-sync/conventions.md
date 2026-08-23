# Tracium design system — how to build with it

Tracium is the **dark-themed** UI kit for the Tracium LLM-observability dashboard. Components are imported from `window.Tracium.*` (bundle auto-loaded). React 18.

## Setup — no provider, but set the theme surface

There is **no provider or context to wrap** — components render standalone. But they are built for a dark surface: every component styles itself with the design tokens, and most text/icon colors resolve to the near-white `var(--foreground)`. **Put your app root on the dark background or everything reads invisible:**

```jsx
<div style={{ background: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
  {/* build here */}
</div>
```

The tokens and component CSS load from `styles.css` (which `@import`s `_ds_bundle.css`); make sure it's linked. Default font is the system stack — no web font to load.

## Styling idiom — CSS custom-property tokens, not classes

Tracium has **no utility classes and no `className` API**. Components are self-styling; you influence them only through their typed props (e.g. `Badge variant`, `StatusPill status`, `LastUpdated tone`, `Card style`). For **your own layout glue**, use the token `var(--*)` values so it matches the kit. Real tokens (all defined in `_ds_bundle.css`):

| Group | Tokens |
|---|---|
| Surfaces | `--background` `--surface` `--surface-alt` `--surface-active` `--sidebar-bg` |
| Text | `--foreground` `--muted-foreground` `--muted` |
| Borders | `--border` `--border-strong` `--focus-ring` |
| Brand / accent | `--accent` `--accent-hover` `--accent-soft` `--accent-strong` `--accent-contrast` `--accent-border` `--accent-glow` |
| Semantic | `--success` `--warning` `--error` `--info` |
| Charts | `--chart-grid` `--chart-tooltip-bg` |
| Shadows | `--shadow` `--shadow-accent` |

The accent is a mint green (`--accent`); success/error/warning drive status coloring across `Badge`, `StatusPill`, `LastUpdated`, and the charts.

## Components

15 components. `Card` + `CardHeader` (surface + header), `Badge`, `StatusPill`, `CostTag`, `Duration`, `LastUpdated` (inline indicators), `EmptyState`, `Spinner`, `ErrorBoundary` (states), `Sparkline`, `CostBarChart`, `LatencyChart`, `HorizonStrip` (data viz), `Icon` (base glyph — the kit also exports ~30 ready `Icon*` glyphs like `IconHome`, `IconSearch`, `IconKey` from `window.Tracium.*`).

**Read the real files before styling:** each component's `<Name>.d.ts` (its exact props) and `<Name>.prompt.md` (usage), plus `styles.css` → `_ds_bundle.css` for the token values. The charts and `CostTag`/`Duration` take domain data (cost in USD, latency percentiles that may be `null`, epoch-ms timestamps) — check the `.d.ts` for the shape.

## Idiomatic example

```jsx
const { Card, CardHeader, StatusPill, CostTag, Duration, LatencyChart } = window.Tracium;

<div style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 24 }}>
  <Card style={{ maxWidth: 640 }}>
    <CardHeader title="Trace tr_9f2a" subtitle="checkout-agent"
      right={<StatusPill status="completed" />} />
    <div style={{ display: 'flex', gap: 24, padding: '16px 20px', color: 'var(--muted)' }}>
      <span>Cost <CostTag usd={0.0182} /></span>
      <span>Duration <Duration ms={4200} /></span>
    </div>
    <div style={{ padding: '0 20px 20px' }}>
      <LatencyChart series={[
        { label: 'Mon', p50: 0.8, p95: 1.9, p99: 3.1 },
        { label: 'Tue', p50: 0.7, p95: 2.1, p99: 3.6 },
      ]} />
    </div>
  </Card>
</div>
```
