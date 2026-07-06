# Land Usability Explorer — PoC Implementation Plan

A demo web app that computes a **weighted land-usability score** over a 500-cell
analysis grid (Vadodara region, Gujarat, India), renders it as an interactive
red→green heatmap, and — on clicking any grid cell — erupts a **360° radial 3D
column chart** around that cell showing how each layer contributes to its score.
Layers are fully dynamic: add/remove/enable/disable, re-weight, with live
validation that weights total 100.

This is a client-facing PoC. Visual polish is a first-class requirement:
dark, modern, futuristic ("mission control for land planning").

---

## 1. Data inventory (committed under `data/`)

All GeoJSON coordinates are **WGS84 lon/lat** (the `.prj` sidecars describe the
original UTM 43N shapefiles; the exported GeoJSON is already reprojected).
Study area bbox ≈ `73.109..73.355 E, 22.513..22.697 N` (~25 × 20 km).

### Analysis grid layers — 500 cells, 1 km² each (`HA_Area = 100` ha)

| File | Layer meaning | Suitability score field (0–1, higher = more usable) | Notes |
|---|---|---|---|
| `Analysis/Slope.geojson` | Terrain slope | `oneminus` (flatter = better), range 0.68–0.96 | `Slope_Max` = raw slope |
| `Analysis/DoubleCropLand.geojson` | Double-crop agriculture | `oneminus` (avoid fertile farmland), 0.05–1.0 | `Agri_Per` = % agri |
| `Analysis/Settlements.geojson` | Built-up settlements | `oneminus` (avoid villages), 0–1 | `Gamtal_Per` = % settlement |
| `Analysis/Stream.json` | Streams / water bodies | `oneminuspr` (avoid water), 0.15–1.0 | `Water_Per` = % water |
| `Analysis/Road Buffer.geojson` | Road proximity (NE/NH/SH/MR buffers) | `nor_roads`, 0–0.32 | per-class fields `Norm_NE/NH/SH/MR` |
| `Analysis/Railway Buffer.geojson` | Railway proximity | `Nor`, 0–0.59 | `railway_bu` = buffer distance |
| `Analysis/Node.geojson` | Road-junction density | `nor_junc`, 0–0.63 | `Junctions` = count |
| `Analysis/Industrial_Area.geojson` | Proximity to existing industrial estates | `oneminus` (closer = better), 0–0.62 | `GIDC_Dista` = distance m |
| `Analysis/GIDC_Influence.geojson` | GIDC estate coverage | `nor_score` | ⚠ **every value is 0** in this extract — ship it, but disabled by default |

### Village-level socioeconomic layers (need spatial join to the grid)

| File | Meaning | Score field | Features |
|---|---|---|---|
| `Analysis/Village_Jantri.json` | Jantri land price | `oneminus` (cheaper land = better), 0.58–1.0 | 53 villages |
| `Analysis/Village_NPO.json` | Non-primary occupation share | `NPO_nor`, 0.01–0.78 | 82 villages |
| `Analysis/Village_WFPR.json` | Workforce participation | `wfpr_nor1`, 0.33–0.95 | 76 villages |

### Overlay (reference) layers — toggleable context, not scored

| File | Geometry |
|---|---|
| `Overlay/Delhi Mumbai Expressway.geojson` | 1 LineString |
| `Overlay/Railway.geojson` | 1 LineString (Mumbai–Delhi line) |
| `Overlay/Statehighway.geojson` | 9 LineStrings (SH158 etc.) |
| `Overlay/River.geojson` | 1 Polygon (Mahi river) |

### Data quirks (discovered during exploration — the pipeline MUST handle these)

1. **`FeatureID` is NOT consistent across grid layers.** Only 90/500 cells share
   geometry for the same `FeatureID` between layers. → Join layers **spatially by
   cell centroid** (nearest-centroid within ~500 m), never by ID.
2. **Grids are slightly offset between some layers** (up to ~280 m centroid
   drift for Settlements/Stream/DoubleCropLand vs the rest). Nearest-centroid
   matching within half a cell handles this.
3. **`GIDC_Influence` is all zeros** (every numeric attribute = 0). Keep it in
   the catalog (flagged), exclude from default weights.
4. **`Node.geojson` and `Nodes_buffer.json` are byte-identical.** Use `Node.geojson`,
   ignore the duplicate.
5. Some layers use `.json` extension instead of `.geojson`; some have `FID`
   instead of `FeatureID`. Pipeline normalizes.
6. Village layers contain `MultiPolygon`s; join is point-in-polygon of the cell
   centroid (fallback: nearest polygon within 2 km; else score `null` → layer
   contributes proportionally re-normalized, see §4).

---

## 2. Scoring model

```
usability(cell) = Σ_i  (w_i / 100) × s_i(cell)      for enabled layers i
```

- `s_i(cell)` ∈ [0,1] is the layer's precomputed suitability score (§1 tables).
- `w_i` are integer-ish weights (one decimal allowed); **Σ w_i must equal 100**
  across *enabled* layers. Anything else is an invalid configuration → the app
  shows an error state (§6) and keeps rendering the last valid result, dimmed.
- Cells where a layer has no data (`s_i = null`, e.g. centroid outside every
  village polygon): re-normalize that cell over layers that do have data
  (`Σ w_j s_j / Σ w_j` over non-null j) and mark the cell "partial data" in the
  inspector.
- Result ∈ [0,1], displayed as 0–100. Color: red (0) → yellow → green (100).

### Default layer catalog (weights sum to 100)

| # | Layer | Default weight |
|---|---|---|
| 1 | Road connectivity | 15 |
| 2 | Industrial proximity | 15 |
| 3 | Slope | 10 |
| 4 | Double-crop land | 10 |
| 5 | Settlements | 10 |
| 6 | Railway proximity | 10 |
| 7 | Junction density | 10 |
| 8 | Streams & water | 5 |
| 9 | Land price (Jantri) | 5 |
| 10 | Non-primary occupation | 5 |
| 11 | Workforce participation | 5 |
|  | **Total** | **100** |
| — | GIDC influence | 0 (disabled; data all-zero) |

---

## 3. Preprocessing pipeline

`scripts/build-grid.mjs` (plain Node, no native deps) — run once, output
committed so the app needs no build-time GIS.

1. Load `Analysis/Slope.geojson` → **canonical grid**: 500 cells, id `c000..c499`,
   store simplified polygon (5-point ring, ~6 decimal places) + centroid.
2. For each grid layer: compute each feature's centroid, nearest-match to
   canonical cells (reject > 700 m), emit `scores[layerId][cellId]`.
3. For each village layer: point-in-polygon (ray casting — implement inline,
   ~20 lines) of each cell centroid; fallback nearest-polygon-centroid ≤ 2 km.
4. Clamp all scores to [0,1], round to 4 dp.
5. Emit:
   - `app/public/data/grid.json` — `{ cells: [{id, ring, centroid}] }` (~150 KB)
   - `app/public/data/scores.json` — `{ layerId: { cellId: score } }`
   - `app/public/data/catalog.json` — layer catalog: id, name, description,
     icon, default weight, source file, raw-field name, `allZero` flag
   - `app/public/data/overlays/*.geojson` — the 4 overlay files, minified
6. Log a join-quality report (matched cells per layer, null counts) to stdout;
   fail the script if any grid layer matches < 495/500 cells.

---

## 4. App architecture

**Stack:** Vite + React 18 + TypeScript + [zustand](https://github.com/pmndrs/zustand)
for state + **MapLibre GL JS** (no API key needed) with the free Carto *Dark
Matter* basemap. No deck.gl — the radial 3D chart is done with MapLibre
`fill-extrusion` layers, which keeps one rendering pipeline and zero WebGL
interop risk.

```
app/
  index.html
  package.json  vite.config.ts  tsconfig.json
  public/data/            ← pipeline output (committed)
  src/
    main.tsx  App.tsx
    theme.css               ← design tokens (CSS custom properties)
    store/useAppStore.ts    ← layers[], weights, selection, ui flags; derived:
                              totals, validity, per-cell scores (memoized)
    lib/score.ts            ← scoring math, re-normalization, color scale
    lib/radial.ts           ← generates radial-chart sector polygons (§5)
    lib/format.ts
    components/
      MapView.tsx           ← map init, grid fill layer, overlays, click/hover
      RadialChart.ts        ← imperative module driving fill-extrusion layers
      ControlPanel.tsx      ← layer list, weight sliders, add/remove
      WeightDonut.tsx       ← SVG donut of weight allocation (the "100 ring")
      CellInspector.tsx     ← right-side breakdown panel for selected cell
      Legend.tsx  Toolbar.tsx  ErrorBanner.tsx  StatTiles.tsx
```

State shape (zustand):

```ts
{
  catalog: LayerDef[]                  // from catalog.json
  layers: { id, weight, enabled }[]    // user-editable working set
  selectedCell: string | null
  hoverCell: string | null
  overlays: { id, visible }[]
  ui: { basemapLabels: boolean, cvdSafeRamp: boolean, panelOpen: boolean }
}
```

Derived selectors: `totalWeight`, `isValid (total === 100 ± 0.01 && ≥1 enabled)`,
`cellScores: Float32Array(500)` recomputed in <1 ms on any weight change —
no workers needed at this size. Map paint updates via
`map.setPaintProperty`/`feature-state`, not layer re-creation, so slider drags
repaint at 60 fps.

---

## 5. Map & the 360° radial column chart

### Heatmap grid
- One GeoJSON source (500 polygons), one `fill` layer; score written with
  `setFeatureState({score})`; paint = `interpolate` over score:
  `0 → #d03b3b (red) → 0.5 #fab219 (amber) → 1 → #0ca30c (green)`, 78 % opacity,
  hairline cell borders, hover cell gets a bright outline + slight lift
  (`fill-extrusion` hover pop is optional stretch).
- When config invalid: grid desaturates to gray + 30 % opacity (error state).

### Radial chart (the showpiece)
On cell click:
1. Camera `flyTo` the cell, zoom ~13.2, pitch 58°, slight bearing rotation.
2. `lib/radial.ts` generates one **annulus-sector polygon per enabled layer**:
   full 360° divided into N equal sectors (3° gap between), inner radius 620 m,
   outer radius 900 m, centered on the cell centroid.
3. Each sector is a `fill-extrusion` feature: height `= contribution_i × H_MAX`
   (contribution = `w_i × s_i / 100`; `H_MAX ≈ 2600 m` so the tallest columns read
   clearly at pitch), color = the layer's categorical color, base 0.
4. Heights **animate from 0** over ~600 ms (ease-out cubic, rAF loop updating
   `fill-extrusion-height`). Weight-slider changes while a cell is selected
   re-animate heights live — this is the money shot of the demo.
5. `symbol` layer labels each sector (layer name + contribution points) at the
   sector's outer midpoint; the selected cell itself gets a pulsing outline and
   a floating score chip (HTML marker) showing the 0–100 score.
6. Click elsewhere / ✕ in inspector → sectors animate down, camera eases back.

### Overlays
Expressway (amber dashed glow), Railway (white/dark hatch), State highways
(cyan thin), River (blue fill 35 %). Toggle chips in the toolbar. "Glow" =
duplicate line layer underneath, wider + blurred + low opacity.

---

## 6. Dynamic layer & weight UX (the validation story)

Control panel (left, glass panel):

- **Weight donut** at top: segments = enabled layers (categorical colors),
  center shows `Σ = 100` in green when valid; when invalid the ring gap is
  rendered in pulsing red and center shows e.g. `Σ = 85 ✕`.
- Each layer = a card: color dot, name, weight slider `0–100` (step 1) +
  numeric input, enable/disable switch, remove (✕) button, tiny sparkline-style
  histogram of that layer's score distribution (pure SVG, precomputed bins).
- **Add layer**: "+" opens a picker listing catalog layers not in the working
  set (GIDC flagged "no data in this extract"). Added with weight 0.
- **Validation behavior** (explicit requirement): any change that breaks
  `Σ = 100` — removing a layer, disabling one, dragging a slider —
  1. keeps the app running (heatmap dims to gray, radial chart frozen),
  2. shows a persistent **error banner**: "Weights total 85 — must equal 100.
     Redistribute 15 points or auto-balance.",
  3. offers **Auto-balance** (scales enabled weights proportionally to sum
     to 100, rounding fixed so the total is exactly 100) and **Undo**.
- **Presets** row: "Balanced" (defaults), "Connectivity first", "Low
  displacement" (settlement/agri-heavy), "Cheap land". Presets always sum to 100.
- Disabling a layer sets its weight aside (remembered) — re-enabling restores it
  (and likely re-triggers the ≠100 error, which is the intended teaching moment).

---

## 7. Visual design language

Dark-first "ops console" aesthetic. Design tokens in `theme.css`; charts follow
the repo's dataviz method (the implementer should load the **dataviz skill**
and run `validate_palette.js` on the final palette before shipping).

- **Surfaces:** page `#0d0d0d`, panels `rgba(26,26,25,0.72)` with
  `backdrop-filter: blur(16px)`, hairline borders `rgba(255,255,255,0.10)`,
  soft 24 px shadows. Accent: electric cyan `#22d3ee` for interactive states
  (kept out of chart-series duty).
- **Type:** system sans; `tabular-nums` for weights/scores; generous tracking on
  small-caps section labels for the futuristic feel.
- **Layer categorical colors** (identity in donut, sliders, radial sectors) —
  dark-mode validated 8-slot palette, fixed assignment order, never cycled:
  `#3987e5, #199e70, #c98500, #008300, #9085e9, #e66767, #d55181, #d95926`.
  Layers 9–12 reuse *no* new hues: they get slots by fixed catalog order with
  texture/direct-label relief (every sector and card is always direct-labeled,
  so identity never rides on color alone — this is also the CVD mitigation).
- **Suitability ramp:** red→amber→green as explicitly requested
  (`#d03b3b → #fab219 → #0ca30c`). Because red↔green is the classic CVD trap:
  (a) hover tooltip + inspector always show the numeric score, (b) a
  **CVD-safe toggle** in the toolbar swaps the ramp to a validated single-hue
  blue sequential (`#cde2fb → #0d366b` reversed for dark) — one line of paint
  config, big accessibility win to demo.
- **Motion:** 150–250 ms ease-out on panels/chips; 600 ms radial eruption;
  number tickers on the score chip; `prefers-reduced-motion` respected.
- Legend bottom-left (gradient bar 0–100), stat tiles top-right (area analyzed,
  mean score, top-cell score, % cells > 70).

---

## 8. Implementation phases (for the implementing agent)

1. **Pipeline** — `scripts/build-grid.mjs`, generate `app/public/data/*`,
   check the join report (≥ 495/500 matched per grid layer; villages ≥ 460/500
   cells covered). Commit generated data.
2. **App scaffold** — Vite + React + TS, theme tokens, store with validation
   logic + unit-ish sanity (auto-balance always lands on exactly 100).
3. **Map core** — basemap, grid heatmap w/ feature-state scoring, hover
   tooltip, legend, overlays + toggles.
4. **Radial chart** — sector generation, extrusion animation, labels, camera
   choreography, live re-animation on weight change.
5. **Control panel** — donut, sliders, add/remove/enable, error banner,
   auto-balance, presets, cell inspector with per-layer contribution bars
   (sorted, direct-labeled).
6. **Polish & verify** — empty/error states, reduced motion, `npm run build`
   clean, Playwright screenshot of (a) heatmap, (b) selected-cell radial view,
   (c) broken-weights error state; eyeball all three.

**Acceptance criteria**
- Load → heatmap visible in < 2 s on localhost; slider drag repaints live.
- Click cell → radial chart erupts, labels legible, inspector shows
  contributions summing to the displayed score.
- Remove any layer → error banner + dimmed map + working auto-balance → valid
  state restores color and (if a cell is selected) re-animates the radial chart.
- Add GIDC layer → visibly flagged as no-data; contributes 0 everywhere.
- `npm run build` passes with no TS errors; no console errors in normal use.

## 9. Out of scope (PoC)

Persistence/sharing of configurations, mobile layout (desktop-first; must not
break at 1280 px), server backend (fully static), editing layer *data*,
uploading new GeoJSON, i18n. All candidates for the follow-up pitch.
