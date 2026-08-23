# design-sync notes — dashboard

## Repo shape / build
- This repo is a React **app**, not a published component library. There is **no library `dist/` entry** (`dist/` is the Vite app bundle) and `package.json` has no `module`/`main`/`exports`.
- The DS surface is the shared primitives in `src/common/components` (barrel: `src/common/components/index.ts`). Config scopes discovery there via `cfg.srcDir: "src/common/components"`, and the converter runs in **synth-entry mode** (no `--entry`) — it synthesizes an entry from those source files.
- **Self-symlink required:** the converter expects `node_modules/<pkg>/package.json`. npm never self-installs, so before building create `ln -sfn .. node_modules/dashboard`. Without it the build crashes at `exportedNames` (ENOENT on `node_modules/dashboard/package.json`). `node_modules` is gitignored, so **recreate this symlink on every fresh clone** before running the build.
- Build command (from repo root):
  `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --out ./ds-bundle`

## Contracts (dtsPropsFor)
- Synth-entry mode could not extract prop types from the inline `interface`s — every `<Name>Props` came out as `{ [key: string]: unknown }`. All 15 contracts are hand-written in `cfg.dtsPropsFor` from the component sources. **If a component's props change in source, update `cfg.dtsPropsFor.<Name>` by hand** — nothing regenerates them.
- Chart point shapes (`CostPoint`/`LatencyPoint`/`ErrorPoint`, from `src/common/interfaces`) are inlined into the chart `dtsPropsFor` bodies rather than referenced, so the design agent sees the field shape directly.

## Icons
- The DS exports ~30 single-path `Icon*` glyphs (`IconHome`, `IconSearch`, …) plus the base `Icon` primitive. The individual glyphs are excluded from the component list via `cfg.componentSrcMap` (`"IconX": null`) to avoid ~30 near-identical cards; only the base `Icon` is a card, with an authored showcase preview. All glyphs remain importable from `window.Tracium.*` regardless.
- If new `Icon*` glyphs are added to `src/common/components/icons/index.tsx`, add them to the `componentSrcMap` null list (or they'll each become their own card) and, ideally, to the `Icon` showcase preview.

## Theming in previews
- Tracium is a **dark theme** (tokens in `src/index.css` `:root`). The preview harness background is white, so components whose text/glyphs inherit `var(--foreground)` (near-white) render near-invisible on white. Text/glyph-only previews (`CostTag`, `Duration`, `Icon`) are wrapped in a `var(--surface)` panel so they read true. Keep that pattern for any new text-only component preview.

## Known render warns (triaged benign — re-syncs should treat these as expected, not new)
- `[RENDER_THIN] Sparkline` — Sparkline is pure SVG `<path>` (no text) at 24–40px height; the paint-detection heuristic mis-measures it. Confirmed rendering correctly in the review sheet. Benign.
- `[RENDER_ERRORS] ErrorBoundary` — the `Caught` story intentionally throws (a `Boom` component) to demonstrate the boundary's fallback; the thrown error surfaces as a pageerror. The boundary catches it and renders the fallback card (root non-empty, no `[RENDER]`). Intentional.

## Presentation overrides
- `Card`, `CardHeader`, `EmptyState`, `ErrorBoundary`, `Sparkline` use `cfg.overrides.<Name>.cardMode: "column"` — they were flagged `[GRID_OVERFLOW]` (wider than a grid cell). Column mode gives each story full card width, one per row.

## Upload status
- **Uploaded**: project "Tracium Design System" (`d4c3084a-d89c-4246-9417-2fa0ca644143`), all 15 components + shared base files pushed in one batch (bundle was already fully built/verified from the prior blocked run). `config.json` now has `projectId` set. `_ds_sync.json` anchor is in place, so future re-syncs can diff instead of re-verifying everything.

## Re-sync risks (what can silently go stale)
- **`dtsPropsFor` drift**: contracts are hand-maintained (synth mode can't extract them). A prop rename/addition in source will NOT show up in the `.d.ts` until `dtsPropsFor` is updated. This is the single most likely thing to rot.
- **Preview data is inlined** in each `.design-sync/previews/<Name>.tsx` (mock series/labels). It doesn't track the real interfaces automatically — if a chart interface changes shape, the preview may compile against stale fields.
- **Self-symlink + synth mode** means the bundle rebuilds from `src/` every run; if the app's shared components move out of `src/common/components`, update `cfg.srcDir` and the barrel assumption.
- Toolchain assumed: node v22, converter deps (esbuild/ts-morph/@types/react/playwright) installed into `.ds-sync/`; chromium via `npx playwright install chromium`.
