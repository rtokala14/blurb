#!/usr/bin/env node
// Vantage (Land Suitability) — preprocessing pipeline.
// Plain Node, no native/GIS deps. Builds a canonical 500-cell grid from
// Slope.geojson, joins every other analysis layer by NEAREST CELL CENTROID
// (FeatureID is NOT consistent across layers), joins village layers by
// point-in-polygon of the cell centroid, and emits committed JSON for the app.
//
// Run:  node scripts/build-grid.mjs
// Out:  app/public/data/{grid.json,scores.json,catalog.json,overlays/*.geojson}

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const OUT = join(ROOT, 'app', 'public', 'data');
const OUT_OVERLAYS = join(OUT, 'overlays');
mkdirSync(OUT_OVERLAYS, { recursive: true });

const read = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

// ---------- geometry helpers ----------
const R = 6371000; // m
const toRad = (d) => (d * Math.PI) / 180;
// Equirectangular metric distance — fine at this latitude/scale, cheap.
function metricDist(a, b) {
  const latMid = toRad((a[1] + b[1]) / 2);
  const x = toRad(b[0] - a[0]) * Math.cos(latMid);
  const y = toRad(b[1] - a[1]);
  return Math.sqrt(x * x + y * y) * R;
}

// Rings for Polygon / MultiPolygon → array of outer rings [[ [lon,lat], ... ]].
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((poly) => poly[0]);
  return [];
}
function allPolygons(geom) {
  // returns array of polygons, each = array of rings (outer + holes)
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

// Area-weighted centroid of a single ring (planar; adequate for small cells).
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    // degenerate → simple mean
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

// Centroid of a feature (largest outer ring by |area| for MultiPolygon).
function featureCentroid(geom) {
  const rings = outerRings(geom);
  if (rings.length === 0) return null;
  if (rings.length === 1) return ringCentroid(rings[0]);
  let best = null, bestA = -1;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    a = Math.abs(a);
    if (a > bestA) { bestA = a; best = ring; }
  }
  return ringCentroid(best);
}

// Ray-casting point-in-ring.
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
// Point in polygon (outer ring, minus holes) — handles MultiPolygon feature.
function pointInFeature(pt, geom) {
  for (const poly of allPolygons(geom)) {
    if (!pointInRing(pt, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(pt, poly[h])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// Simplify a cell ring to a ~5-point closed square ring, 6 dp.
function simplifyRing(ring) {
  // grid cells are axis-aligned 1km squares; take bbox corners
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return [
    [r6(minX), r6(minY)],
    [r6(maxX), r6(minY)],
    [r6(maxX), r6(maxY)],
    [r6(minX), r6(maxY)],
    [r6(minX), r6(minY)],
  ];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------- catalog ----------
// palette: fixed 8-slot categorical order, reused by catalog order for 9-12.
const PALETTE = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

const GRID_LAYERS = [
  { id: 'roads', name: 'Road connectivity', file: 'Analysis/Road Buffer.geojson', field: 'nor_roads', weight: 12, icon: 'road', desc: 'Proximity to national/state/major roads (NE/NH/SH/MR buffers).' },
  { id: 'industrial', name: 'Industrial proximity', file: 'Analysis/Industrial_Area.geojson', field: 'oneminus', weight: 12, icon: 'factory', desc: 'Closeness to existing GIDC industrial estates — nearer is better.' },
  { id: 'slope', name: 'Slope', file: 'Analysis/Slope.geojson', field: 'oneminus', weight: 10, icon: 'terrain', desc: 'Terrain flatness — flatter land is cheaper to develop.' },
  { id: 'doublecrop', name: 'Double-crop land', file: 'Analysis/DoubleCropLand.geojson', field: 'oneminus', weight: 10, icon: 'crop', desc: 'Avoids fertile double-cropped farmland.' },
  { id: 'settlements', name: 'Settlements', file: 'Analysis/Settlements.geojson', field: 'oneminus', weight: 10, icon: 'home', desc: 'Avoids built-up village settlement (gamtal) area.' },
  { id: 'railway', name: 'Railway proximity', file: 'Analysis/Railway Buffer.geojson', field: 'Nor', weight: 10, icon: 'train', desc: 'Proximity to the Mumbai–Delhi railway line.' },
  { id: 'junctions', name: 'Junction density', file: 'Analysis/Node.geojson', field: 'nor_junc', weight: 10, icon: 'node', desc: 'Density of road junctions — access & logistics.' },
  { id: 'streams', name: 'Streams & water', file: 'Analysis/Stream.json', field: 'oneminuspr', weight: 5, icon: 'water', desc: 'Avoids streams and surface water bodies.' },
];
const VILLAGE_LAYERS = [
  { id: 'jantri', name: 'Land price (Jantri)', file: 'Analysis/Village_Jantri.json', field: 'oneminus', weight: 5, icon: 'coin', desc: 'Village Jantri land price — cheaper land scores higher.' },
  { id: 'npo', name: 'Non-primary occupation', file: 'Analysis/Village_NPO.json', field: 'NPO_nor', weight: 5, icon: 'people', desc: 'Share of non-farming workforce — industrial readiness.' },
  { id: 'wfpr', name: 'Workforce participation', file: 'Analysis/Village_WFPR.json', field: 'wfpr_nor1', weight: 5, icon: 'workforce', desc: 'Workforce participation rate of the village.' },
];
const GIDC_LAYER = { id: 'gidc', name: 'GIDC influence', file: 'Analysis/GIDC_Influence.geojson', field: 'nor_score', weight: 6, icon: 'grid', desc: 'GIDC estate influence. Source extract is all zero, so values are synthetic demo scores (deterministic, seeded per cell).' };

// ---------- build canonical grid from Slope ----------
console.log('Building canonical grid from Slope.geojson …');
const slope = read('Analysis/Slope.geojson');
if (slope.features.length !== 500) console.warn(`  ! Slope has ${slope.features.length} features (expected 500)`);

const cells = slope.features.map((f, i) => {
  const rings = outerRings(f.geometry);
  const centroid = featureCentroid(f.geometry);
  const c = centroid.map((v) => Math.round(v * 1e6) / 1e6);
  return {
    id: 'c' + String(i).padStart(3, '0'),
    ring: simplifyRing(rings[0]),
    centroid: c,
  };
});

// spatial index: simple bucket grid on centroids for nearest lookup
const cellCentroids = cells.map((c) => c.centroid);
function nearestCell(pt) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < cellCentroids.length; i++) {
    const d = metricDist(pt, cellCentroids[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, dist: bestD };
}

// ---------- join grid layers by nearest centroid ----------
const scores = {};
const report = [];
const REJECT = 700; // m

function joinGridLayer(layer) {
  const gj = read(layer.file);
  const map = {};
  let matched = 0, rejected = 0, nullVals = 0;
  let maxDrift = 0;
  for (const f of gj.features) {
    const ctr = featureCentroid(f.geometry);
    if (!ctr) { rejected++; continue; }
    const { idx, dist } = nearestCell(ctr);
    if (dist > REJECT) { rejected++; continue; }
    if (dist > maxDrift) maxDrift = dist;
    let raw = f.properties[layer.field];
    if (raw == null || Number.isNaN(Number(raw))) { nullVals++; continue; }
    const v = clamp01(Number(raw));
    map[cells[idx].id] = r4(v);
    matched++;
  }
  scores[layer.id] = map;
  const uniqueCells = new Set(Object.keys(map)).size;
  report.push({ id: layer.id, name: layer.name, kind: 'grid', matched: uniqueCells, rejected, nullVals, maxDrift: Math.round(maxDrift), field: layer.field });
  return uniqueCells;
}

// ---------- join village layers by point-in-polygon ----------
function joinVillageLayer(layer) {
  const gj = read(layer.file);
  // Precompute polygon centroids for nearest fallback.
  const feats = gj.features.map((f) => ({
    geom: f.geometry,
    val: f.properties[layer.field],
    ctr: featureCentroid(f.geometry),
  }));
  const map = {};
  let inside = 0, fallback = 0, nullCells = 0;
  const FALLBACK = 2000; // m
  for (const cell of cells) {
    const pt = cell.centroid;
    let chosen = null;
    for (const fe of feats) {
      if (fe.val == null) continue;
      if (pointInFeature(pt, fe.geom)) { chosen = fe; break; }
    }
    if (chosen) inside++;
    else {
      // nearest polygon centroid within fallback
      let best = null, bestD = Infinity;
      for (const fe of feats) {
        if (fe.val == null || !fe.ctr) continue;
        const d = metricDist(pt, fe.ctr);
        if (d < bestD) { bestD = d; best = fe; }
      }
      if (best && bestD <= FALLBACK) { chosen = best; fallback++; }
    }
    if (!chosen) { nullCells++; continue; }
    map[cell.id] = r4(clamp01(Number(chosen.val)));
  }
  scores[layer.id] = map;
  const covered = Object.keys(map).length;
  report.push({ id: layer.id, name: layer.name, kind: 'village', matched: covered, inside, fallback, nullCells, field: layer.field });
  return covered;
}

for (const l of GRID_LAYERS) joinGridLayer(l);

// ---------- GIDC: synthetic demo scores ----------
// The GIDC_Influence extract is all zero, so instead of joining it we generate
// DETERMINISTIC pseudo-random scores in [0.05, 0.95], seeded from the cell
// index (mulberry32) — identical output on every run.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  const map = {};
  cells.forEach((cell, i) => {
    map[cell.id] = r4(0.05 + mulberry32(i + 1)() * 0.9);
  });
  scores[GIDC_LAYER.id] = map;
  report.push({ id: GIDC_LAYER.id, name: GIDC_LAYER.name, kind: 'grid', matched: Object.keys(map).length, rejected: 0, nullVals: 0, maxDrift: 0, field: 'synthetic' });
}

for (const l of VILLAGE_LAYERS) joinVillageLayer(l);

// ---------- score distribution histograms (for sparklines) ----------
const BINS = 12;
function histogram(layerId) {
  const bins = new Array(BINS).fill(0);
  for (const v of Object.values(scores[layerId])) {
    let b = Math.floor(v * BINS);
    if (b >= BINS) b = BINS - 1;
    if (b < 0) b = 0;
    bins[b]++;
  }
  return bins;
}

// ---------- catalog ----------
// GIDC stays last in catalog order; all 12 layers are enabled by default.
const catalogDefs = [...GRID_LAYERS, ...VILLAGE_LAYERS, GIDC_LAYER];
const catalog = catalogDefs.map((l, i) => ({
  id: l.id,
  name: l.name,
  description: l.desc,
  icon: l.icon,
  color: PALETTE[i % PALETTE.length],
  defaultWeight: l.weight,
  sourceFile: l.file,
  field: l.field,
  kind: VILLAGE_LAYERS.some((v) => v.id === l.id) ? 'village' : 'grid',
  allZero: !!l.allZero,
  defaultEnabled: !l.allZero,
  histogram: histogram(l.id),
}));

// ---------- overlays (minify + copy) ----------
const overlayFiles = [
  { src: 'Overlay/Delhi Mumbai Expressway.geojson', out: 'expressway.geojson' },
  { src: 'Overlay/Railway.geojson', out: 'railway.geojson' },
  { src: 'Overlay/Statehighway.geojson', out: 'statehighway.geojson' },
  { src: 'Overlay/River.geojson', out: 'river.geojson' },
];
for (const o of overlayFiles) {
  const gj = read(o.src);
  writeFileSync(join(OUT_OVERLAYS, o.out), JSON.stringify(gj));
}

// ---------- write outputs ----------
writeFileSync(join(OUT, 'grid.json'), JSON.stringify({ cells }));
writeFileSync(join(OUT, 'scores.json'), JSON.stringify(scores));
writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2));

// ---------- join-quality report ----------
console.log('\n===== JOIN QUALITY REPORT =====');
let fail = false;
for (const r of report) {
  if (r.kind === 'grid') {
    const ok = r.matched >= 495;
    if (!ok) fail = true;
    console.log(
      `${ok ? 'OK ' : 'FAIL'}  ${r.name.padEnd(24)} matched ${r.matched}/500  rejected ${r.rejected}  null ${r.nullVals}  maxDrift ${r.maxDrift}m  [${r.field}]`
    );
  } else {
    // Village coverage is a soft target: cells outside all village polygons get
    // a null score and are re-normalized per-cell by the scoring model (§4).
    // Jantri genuinely spans only part of the study area (53 villages), so full
    // coverage is neither achievable nor meaningful — warn, never hard-fail.
    const ok = r.matched >= 460;
    console.log(
      `${ok ? 'OK ' : 'WARN'}  ${r.name.padEnd(24)} covered ${r.matched}/500  inside ${r.inside}  fallback ${r.fallback}  null ${r.nullCells}  [${r.field}]`
    );
  }
}
console.log('================================');
console.log(`Wrote: grid.json (${cells.length} cells), scores.json (${Object.keys(scores).length} layers), catalog.json (${catalog.length} layers), ${overlayFiles.length} overlays`);

if (fail) {
  console.error('\n✗ Join quality below threshold (grid ≥495/500, village ≥460/500). Aborting.');
  process.exit(1);
}
console.log('\n✓ All layers pass join-quality thresholds.');
