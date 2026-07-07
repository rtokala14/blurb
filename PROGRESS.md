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

## In flight (subagent currently working)

**Agent 2 — light theme + basemap switcher** (uncommitted changes in
`app/src/` belong to it; it commits when done):

- Basemap ui state `'dark'|'light'|'satellite'|'terrain'` + segmented control
  in Toolbar. Dark/light = Carto dark-matter / positron GL styles; satellite
  = Esri World_Imagery raster; terrain = Esri World_Topo_Map raster; inline
  dark fallback style retained. `map.setStyle()` wipes custom layers, so all
  app layers/sources are re-added on `style.load` and state restored: scores
  via pushScores(), selected feature-state, overlay visibility, radial chart
  reattach (incl. stage + labels + chip) if a cell is selected. No intro
  re-run on basemap change.
- Light UI theme: `:root[data-theme='light']` token overrides in
  `app/src/theme.css`; `ui.theme` in store; "◐ Theme" chip;
  `document.documentElement.dataset.theme` set from App. Hard-coded dark
  rgba() literals in radar/sector-label/score-chip/cell-tip/etc. moved to
  tokens (`--chart-grid`, `--tip-bg`, `--backdrop`, `--raise-hover`, …).
  Theme toggle auto-swaps basemap only between dark↔light Carto styles.
- Verification: screenshots 09-light-mode, 10-satellite, 11-light-selected
  plus dark-mode regression re-run.

## Queued next (in order)

1. **Percentage display** (small, do directly, not via agent — user request):
   scores render as percentages, not "x / 100". Chip: "46%" + label; Cell
   inspector: "44.8%" and drop "/ 100 suitability" (keep the word
   suitability); hover tooltip: "C361 · 47%"; radar vertex title values may
   take "%" too. Contribution POINTS stay points (sector pills, breakdown
   bars, "Σ contributions" footer) — they are additive parts, not
   percentages. Dashboard (below) must use % from the start.

2. **Agent 3 — GeoJSON upload + Dashboard tab** (not started; full spec):
   - *Upload*: in AddLayerModal add an "Upload GeoJSON" section: file input
     (≤10 MB, ≤5000 features, FeatureCollection of Polygon/MultiPolygon;
     friendly inline errors). Detect numeric property columns (≥80% numeric
     non-null values); user picks column + optional "invert (lower is
     better)" toggle; min–max normalize to 0–1; join to the 500-cell grid by
     cell-centroid point-in-polygon (ray casting, MultiPolygon-aware) with
     nearest-feature-centroid ≤2 km fallback, else null (renormalization
     already handles nulls). Creates a catalog entry `custom-<n>` (name from
     file, next unused categorical palette color, histogram bins computed
     same shape as pipeline's for Sparkline) + store.scores entry + working
     layer weight 0 enabled. Store needs an `addCustomLayer` action
     (catalog/catalogById/scores/layers update in one set()).
   - *Dashboard*: `ui.view: 'explorer'|'dashboard'`, segmented tab control
     near the brand card. Dashboard = opaque overlay page (z between panels
     and modal; keep MapView mounted underneath). Theme-aware via tokens.
     Load the dataviz skill before building charts. Cards: suitability
     distribution histogram (weighted scores, ramp-colored); average
     contribution by layer (horizontal bars, layer colors, direct labels);
     top-10 cells table (rank, cell id, score %, top driver — row click
     switches to explorer AND selects that cell); grid-average radar (reuse
     RadarChart); weight donut + active preset; data-coverage card (cells
     with data per layer, e.g. Jantri 313/500). Error banner still visible;
     when Σ≠100 the dashboard shows the frozen/invalid treatment like the
     map does. All scores as percentages.

3. After both: refresh all screenshots, update this file, push.

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

Everything lives on `claude/land-usability-heatmap-poc-itj76i` (pushed after
every reviewed step). No PR exists; do not open one unless asked.
