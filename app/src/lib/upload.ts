// Parsing, validation, normalization and grid-join for user-uploaded GeoJSON.
// Small pure functions — no store or DOM access here.
import type { Cell } from '../types';

export type Ring = [number, number][];

export interface UploadFeature {
  /** All rings (outer rings AND holes) of the Polygon/MultiPolygon. Even-odd
   *  point-in-polygon over the full set handles holes + multi parts. */
  rings: Ring[];
  centroid: [number, number];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  properties: Record<string, unknown>;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FEATURES = 5000;

export type ParseResult =
  | { ok: true; features: UploadFeature[]; numericColumns: string[] }
  | { ok: false; error: string };

const isRing = (r: unknown): r is Ring =>
  Array.isArray(r) && r.length >= 4 &&
  r.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));

function collectRings(geom: any): Ring[] | null {
  if (!geom || typeof geom !== 'object') return null;
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates;
    if (!Array.isArray(rings) || !rings.every(isRing)) return null;
    return rings as Ring[];
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates;
    if (!Array.isArray(polys)) return null;
    const out: Ring[] = [];
    for (const rings of polys) {
      if (!Array.isArray(rings) || !rings.every(isRing)) return null;
      out.push(...(rings as Ring[]));
    }
    return out;
  }
  return null;
}

export function parseUpload(text: string): ParseResult {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON — export it again as GeoJSON.' };
  }
  if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    return { ok: false, error: 'Expected a GeoJSON FeatureCollection at the top level.' };
  }
  if (json.features.length === 0) {
    return { ok: false, error: 'The FeatureCollection has no features.' };
  }
  if (json.features.length > MAX_UPLOAD_FEATURES) {
    return { ok: false, error: `Too many features (${json.features.length.toLocaleString()}) — the limit is ${MAX_UPLOAD_FEATURES.toLocaleString()}.` };
  }
  const features: UploadFeature[] = [];
  for (let i = 0; i < json.features.length; i++) {
    const f = json.features[i];
    const type = f?.geometry?.type ?? 'missing geometry';
    const rings = collectRings(f?.geometry);
    if (!rings || rings.length === 0) {
      return { ok: false, error: `Feature ${i + 1} is "${type}" — only Polygon and MultiPolygon features are supported.` };
    }
    let sx = 0, sy = 0, n = 0;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        sx += x; sy += y; n++;
        if (x < minLon) minLon = x;
        if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y;
        if (y > maxLat) maxLat = y;
      }
    }
    features.push({
      rings,
      centroid: [sx / n, sy / n],
      bbox: [minLon, minLat, maxLon, maxLat],
      properties: (f.properties && typeof f.properties === 'object') ? f.properties : {},
    });
  }
  const numericColumns = detectNumericColumns(features);
  return { ok: true, features, numericColumns };
}

/** Property keys where >= 80% of non-null values are finite numbers. */
export function detectNumericColumns(features: UploadFeature[]): string[] {
  const keys = new Set<string>();
  for (const f of features) for (const k of Object.keys(f.properties)) keys.add(k);
  const out: string[] = [];
  for (const k of keys) {
    let nonNull = 0, numeric = 0;
    for (const f of features) {
      const v = f.properties[k];
      if (v == null) continue;
      nonNull++;
      if (typeof v === 'number' && Number.isFinite(v)) numeric++;
    }
    if (nonNull > 0 && numeric / nonNull >= 0.8 && numeric > 0) out.push(k);
  }
  return out.sort();
}

/** Per-feature raw value of a column (null when missing / non-numeric). */
export function columnValues(features: UploadFeature[], col: string): (number | null)[] {
  return features.map((f) => {
    const v = f.properties[col];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

export function valueRange(vals: (number | null)[]): { min: number; max: number; count: number } {
  let min = Infinity, max = -Infinity, count = 0;
  for (const v of vals) {
    if (v == null) continue;
    count++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, count };
}

/** Min–max normalize to 0–1; invert flips after normalizing (1 − x).
 *  Degenerate range (max ≈ min) → every non-null value becomes 0.5. */
export function normalizeValues(vals: (number | null)[], invert: boolean): (number | null)[] {
  const { min, max } = valueRange(vals);
  const span = max - min;
  return vals.map((v) => {
    if (v == null) return null;
    const t = span < 1e-12 ? 0.5 : (v - min) / span;
    return invert ? 1 - t : t;
  });
}

/** Even-odd (ray casting) point-in-polygon over a set of rings. Holes and
 *  MultiPolygon parts both work because crossings toggle inclusion. */
export function pointInRings(pt: [number, number], rings: Ring[]): boolean {
  const [px, py] = pt;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Approximate distance in meters between two lon/lat points (equirectangular —
 *  plenty accurate over the ~25 km study area). */
export function distMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  return R * Math.sqrt(dLat * dLat + dLon * dLon);
}

export interface JoinResult {
  cellScores: Record<string, number>;
  matched: number;      // total cells that got a score
  byContainment: number;
  byNearest: number;
}

/** Join normalized feature values onto grid cells: point-in-polygon of the
 *  cell centroid first, then nearest feature centroid within `maxNearestM`,
 *  else the cell stays null (the scoring model re-normalizes null cells). */
export function joinToGrid(
  cells: Cell[],
  features: UploadFeature[],
  values: (number | null)[],
  maxNearestM = 2000
): JoinResult {
  const cellScores: Record<string, number> = {};
  let byContainment = 0, byNearest = 0;
  for (const cell of cells) {
    const [cx, cy] = cell.centroid;
    let v: number | null = null;
    for (let i = 0; i < features.length; i++) {
      if (values[i] == null) continue;
      const [minLon, minLat, maxLon, maxLat] = features[i].bbox;
      if (cx < minLon || cx > maxLon || cy < minLat || cy > maxLat) continue;
      if (pointInRings(cell.centroid, features[i].rings)) { v = values[i]; break; }
    }
    if (v != null) {
      byContainment++;
    } else {
      let best = Infinity, bestVal: number | null = null;
      for (let i = 0; i < features.length; i++) {
        if (values[i] == null) continue;
        const d = distMeters(cell.centroid, features[i].centroid);
        if (d < best) { best = d; bestVal = values[i]; }
      }
      if (bestVal != null && best <= maxNearestM) { v = bestVal; byNearest++; }
    }
    if (v != null) cellScores[cell.id] = Math.round(v * 10000) / 10000;
  }
  return { cellScores, matched: byContainment + byNearest, byContainment, byNearest };
}

/** 12 equal bins over [0,1] of the joined cell scores — same shape as the
 *  pipeline histograms in catalog.json, so Sparkline renders it unchanged. */
export function computeHistogram(cellScores: Record<string, number>, bins = 12): number[] {
  const out = new Array(bins).fill(0);
  for (const v of Object.values(cellScores)) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(v * bins)));
    out[i]++;
  }
  return out;
}

/** Next unused custom layer id: custom-1, custom-2, … */
export function nextCustomId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^custom-(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `custom-${max + 1}`;
}

/** First palette color not used by another catalog entry; if all are taken,
 *  continue the fixed assignment order past the existing entries. */
export function pickColor(palette: string[], usedColors: string[], catalogLength: number): string {
  const used = new Set(usedColors);
  for (const c of palette) if (!used.has(c)) return c;
  return palette[catalogLength % palette.length];
}

/** File name sans extension, truncated to ~28 chars. */
export function layerNameFromFile(fileName: string, maxLen = 28): string {
  const base = fileName.replace(/\.(geo)?json$/i, '');
  return base.length > maxLen ? base.slice(0, maxLen - 1).trimEnd() + '…' : base;
}
