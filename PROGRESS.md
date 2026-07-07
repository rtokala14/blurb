# Vantage — Progress & Handoff Notes

Living status document so work can resume in any session. **Update this file
whenever a work item completes or a new one is agreed.**
Last updated: 2026-07-07 (during "Vantage round").

## Where things stand

App: **Vantage — Land Suitability** (formerly Land Usability Explorer).
Vite + React 18 + TS + zustand + MapLibre GL, in `app/`. Pipeline in
`scripts/build-grid.mjs` → generated data committed in `app/public/data/`.
Architecture and data facts: see `PLAN.md` (historical but still accurate on
data quirks, scoring model, and layer/score-field mapping).

Shipped so far (commit history is the authority; highlights):

- `39de90d..c79274a` — full PoC: weighted heatmap (red→amber→green), 360°
  radial fill-extrusion contribution chart on cell click, control panel with
  weight sliders / donut / presets / auto-balance, Σ=100 validation UX,
  overlays, dark ops-console theme.
- `fda8f07` — relative contrast mode (default ON, "◧ Contrast" chip): ramp
  stretches over the grid's actual score range; HTML sector-label pills
  (staggered radii, far-side pushed out for pitch foreshortening, <0.5 pt
  sectors unlabeled); radial heights normalized to the cell's max
  contribution; selected-cell glow; vignette.
- `1672fe1` — right dock: context radar (hovered/selected cell vs grid
  average, raw scores, weight-independent) + cell breakdown; collapsible.
- `bb8c2ff` — KPI tiles removed; add-layer moved to a modal; toolbar anchored
  at left:376px (no overlap); global Esc (modal first, then deselect);
  aria-labels; hover tooltip "C361 · 47" on cells.
- `83e201a` — focus mode: on selection the heatmap fades to 0.18 opacity
  (selected cell 0.92) and a dark annulus "stage" (in RadialChart) renders
  under the columns.
- `ed16152` — preset hover-preview (`previewLayers` in store; heatmap,
  legend, tooltip follow preview; radial/donut stay committed) + cinematic
  load-in (camera ease + fill bloom; skipped under prefers-reduced-motion).
- `2f02611` — rebrand Vantage; all copy "usability" → "suitability"; GIDC now
  has deterministic synthetic scores (mulberry32 by cell index, 0.05–0.95);
  default weights (sum 100): roads 12, industrial 12, gidc 6, slope 10,
  doublecrop 10, settlements 10, railway 10, junctions 10, streams 5,
  jantri 5, npo 5, wfpr 5. 'balanced' preset matches.
- `bebe55c`/`1db3b7d` — Agent 2: basemap switcher (dark/light Carto,
  satellite/terrain Esri; all app layers re-added on `style.load` with state
  restored) + light UI theme (`:root[data-theme='light']` token overrides,
  `ui.theme`, "◐ Theme" chip; chart literals moved to tokens). Screenshots
  09–11.
- `46584c3` — percentage display: chip "46%", inspector "44.8% suitability",
  tooltip "C361 · 47%", radar titles in %. Contribution POINTS stay points.
- **GeoJSON upload + Dashboard view** (this commit):
  - *Upload* (AddLayerModal "Upload GeoJSON" section): file input ≤10 MB,
    ≤5000 features, Polygon/MultiPolygon FeatureCollection only, friendly
    inline errors (never crashes). Numeric columns = ≥80% of non-null values
    finite numbers; column select + "invert (lower is better)" + preview line
    ("6 features · range 120.5 – 987.2"). Min–max normalize (degenerate →
    0.5); spatial join in `app/src/lib/upload.ts` (pure functions):
    centroid point-in-polygon (even-odd ray cast, holes + MultiPolygon OK),
    fallback nearest feature centroid ≤2 km, else null. Creates catalog
    entry `custom-<n>` (name from file ≤28 chars, first unused palette color
    else cycled, 12-bin [0,1] histogram matching pipeline shape) via new
    store action `addCustomLayer(def, cellScores)` — one set() updating
    catalog/catalogById/scores/layers (+history, clears activePreset).
    Join-quality note shown in the modal ("matched 474/500 grid cells"),
    then it auto-closes. Custom layers verified end-to-end: slider, donut,
    radar axis, radial sector, inspector bars, remove — all work.
  - *Dashboard*: `ui.view: 'explorer'|'dashboard'`; Explorer|Dashboard tabs
    (aria-pressed buttons) inside the restyled brand card (control panel
    moved to top:124px to fit). Opaque overlay page at z-18 (panels 15 <
    18 < brand 20 < banner 30 < modal 40); MapView untouched underneath;
    toolbar hidden while in dashboard view. Six cards: ramp-colored score
    histogram (x-axis %, counts in <title>), avg contribution by layer
    (horizontal bars, Σ ≈ mean), top-10 table (row click → explorer +
    selectCell → map flies there), grid radar (reused as-is), data coverage
    (n/500 per layer), model summary (WeightDonut + mean/max % stats).
    Σ≠100 → cards 1/2/3/6 gray out with "—" while ErrorBanner floats above
    the overlay; Esc semantics unchanged (does NOT exit dashboard). Both
    themes verified. Screenshots 12–14.

## In flight

Nothing — no uncommitted agent work.

## Queued next (in order)

1. Push the branch when pushes are unblocked (currently blocked in this
   environment); screenshots 12–14 + refreshed 01–07 are committed.

## Conventions & key facts (do not violate)

- Weights are integers summing to exactly 100 across enabled layers;
  auto-balance rounds via largest-remainder. Cells with null layer scores
  renormalize over available layers.
- FeatureIDs are NOT aligned across raw layers — all joins are spatial
  (see PLAN.md §1 quirks). Grid = 500 × 1 km² cells, Vadodara region.
- Categorical layer palette (fixed assignment order, never cycled):
  #3987e5 #199e70 #c98500 #008300 #9085e9 #e66767 #d55181 #d95926.
  Accent cyan #22d3ee is interactive-only, never a data series.
  Ramp: #d03b3b → #fab219 → #0ca30c (CVD-safe blue alt via toggle).
- Radial chart: inner 620 m / outer 900 m / H_MAX 1000 m, heights normalized
  to the cell's max contribution; labels are HTML markers (never symbol
  layers — glyphs need CDN); animations on inner wrappers only (MapLibre
  positions marker roots with inline transforms).
- prefers-reduced-motion is respected everywhere.

## How to build / verify (any session)

```bash
node scripts/build-grid.mjs        # regenerate app/public/data (deterministic)
cd app && npm i && npm run build   # must pass with no TS errors
npx vite preview --port 4173 &     # serve the build
```

Screenshots: `scripts/screenshot.mjs` (committed copy of the verification
script) — needs `playwright-core` (`npm i playwright-core` anywhere) and
Chromium at `/opt/pw-browsers/chromium` (Claude remote env) or adjust
`executablePath`. It writes `docs/screenshots/*.png` and asserts Esc
behaviors. ALWAYS look at the screenshots before committing UI changes.
Kill the server with `pkill -f "[v]ite preview"` (bracket avoids self-match).

Note: basemap/tile fetches fail in the sandbox (proxy blocks CDNs) — the app
must always degrade to the inline fallback style with the grid still
rendering; don't "fix" that by disabling TLS or removing the fallback.

## Branch / remote

Everything lives on `claude/land-usability-heatmap-poc-itj76i`. No PR exists;
do not open one unless asked.

**Remote sync note (2026-07-07):** after a session restart broke this
environment's git push path (local git proxy 401s; no credential source for
direct/ingress pushes), the tip state was synced to the remote branch via the
GitHub API as consolidated commits containing all text files changed since
`6dcc418`. The richer local history (`bebe55c`, `1db3b7d`, `46584c3`,
`62e1c59`, `b3e37b8` + the sync-note commit) and the updated screenshot PNGs
exist only in the session container. If that container is still alive when
pushes heal, run `git push --force-with-lease origin
claude/land-usability-heatmap-poc-itj76i` from it to restore full history and
screenshots; otherwise the API-synced tree on the remote is complete and
correct for all code/docs (only `docs/screenshots/*.png` are stale —
regenerate them with `scripts/screenshot.mjs`).
