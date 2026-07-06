import type { LayerDef, WorkingLayer, Scores, Contribution } from '../types';

// ---- color scales ----
type RGB = [number, number, number];
function hex2rgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
const rgb2css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

const RAMP_RYG: RGB[] = [hex2rgb('#d03b3b'), hex2rgb('#fab219'), hex2rgb('#0ca30c')];
// CVD-safe single-hue blue sequential (light -> dark), reversed for dark bg so
// high score = light/bright.
const RAMP_BLUE: RGB[] = [hex2rgb('#0d366b'), hex2rgb('#2f6fc0'), hex2rgb('#cde2fb')];

export function rampColor(v: number, cvdSafe: boolean): string {
  const stops = cvdSafe ? RAMP_BLUE : RAMP_RYG;
  const t = Math.max(0, Math.min(1, v));
  if (t <= 0.5) return rgb2css(mix(stops[0], stops[1], t / 0.5));
  return rgb2css(mix(stops[1], stops[2], (t - 0.5) / 0.5));
}

// MapLibre interpolate expression for the fill layer, driven by feature-state.
// `domain` lets the ramp stretch across [lo, hi] instead of [0, 1] (relative
// contrast mode) so spatial variation uses the full red->green range.
export function rampExpression(cvdSafe: boolean, domain: [number, number] = [0, 1]): any {
  const s = cvdSafe ? ['#0d366b', '#2f6fc0', '#cde2fb'] : ['#d03b3b', '#fab219', '#0ca30c'];
  const [lo, hi] = domain;
  const mid = (lo + hi) / 2;
  return [
    'interpolate', ['linear'],
    ['coalesce', ['feature-state', 'score'], -1],
    Math.min(-1, lo - 1), '#2a2a28',
    lo, s[0],
    mid, s[1],
    hi, s[2],
  ];
}

// [min, max] of valid (>= 0) cell scores, guarded against degenerate ranges
// so the interpolate stops stay strictly ascending.
export function scoreDomain(arr: Float32Array): [number, number] {
  let lo = 1, hi = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi <= lo) return [0, 1];
  if (hi - lo < 0.04) {
    const m = (hi + lo) / 2;
    return [Math.max(0, m - 0.02), Math.min(1, m + 0.02)];
  }
  return [lo, hi];
}

// ---- weighted scoring with per-cell null re-normalization ----
export function cellScore(
  cellId: string,
  layers: WorkingLayer[],
  scores: Scores
): number | null {
  let num = 0;
  let denom = 0;
  for (const l of layers) {
    if (!l.enabled) continue;
    const s = scores[l.id]?.[cellId];
    if (s == null) continue; // null -> excluded, re-normalize
    num += l.weight * s;
    denom += l.weight;
  }
  if (denom === 0) return null;
  return num / denom;
}

export function computeAllScores(
  cells: { id: string }[],
  layers: WorkingLayer[],
  scores: Scores
): Float32Array {
  const out = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const v = cellScore(cells[i].id, layers, scores);
    out[i] = v == null ? -1 : v;
  }
  return out;
}

// contributions for the inspector / radial chart (points on 0-100, re-normalized)
export function contributions(
  cellId: string,
  layers: WorkingLayer[],
  catalog: Record<string, LayerDef>,
  scores: Scores
): { contribs: Contribution[]; total: number; partial: boolean } {
  const enabled = layers.filter((l) => l.enabled);
  let denom = 0;
  let hasNull = false;
  for (const l of enabled) {
    const s = scores[l.id]?.[cellId];
    if (s == null) { hasNull = true; continue; }
    denom += l.weight;
  }
  // Re-normalization factor so contributions sum to the displayed 0-100 score.
  const norm = denom > 0 ? 100 / denom : 0;
  const contribs: Contribution[] = enabled.map((l) => {
    const def = catalog[l.id];
    const s = scores[l.id]?.[cellId] ?? null;
    return {
      id: l.id,
      name: def.name,
      color: def.color,
      weight: l.weight,
      score: s,
      // points contributed to the 0-100 cell score (post re-normalization).
      // norm = 100/denom, so Σ contribution == displayed 0-100 cell score.
      contribution: s == null ? 0 : l.weight * s * norm,
    };
  });
  const total = contribs.reduce((a, c) => a + c.contribution, 0);
  return { contribs, total, partial: hasNull };
}

// ---- validation & auto-balance ----
export function totalWeight(layers: WorkingLayer[]): number {
  return layers.filter((l) => l.enabled).reduce((a, l) => a + l.weight, 0);
}
export function isValid(layers: WorkingLayer[]): boolean {
  const enabled = layers.filter((l) => l.enabled);
  if (enabled.length === 0) return false;
  return Math.abs(totalWeight(layers) - 100) < 0.01;
}

// Proportionally rescale enabled weights to sum to EXACTLY 100 (integer),
// distributing rounding remainder to the largest fractional parts.
export function autoBalance(layers: WorkingLayer[]): WorkingLayer[] {
  const enabled = layers.filter((l) => l.enabled);
  const sum = enabled.reduce((a, l) => a + l.weight, 0);
  if (enabled.length === 0) return layers;
  let target: { id: string; w: number; frac: number }[];
  if (sum === 0) {
    // even split
    const base = Math.floor(100 / enabled.length);
    target = enabled.map((l) => ({ id: l.id, w: base, frac: 0 }));
  } else {
    target = enabled.map((l) => {
      const exact = (l.weight / sum) * 100;
      const w = Math.floor(exact);
      return { id: l.id, w, frac: exact - w };
    });
  }
  let assigned = target.reduce((a, t) => a + t.w, 0);
  let remainder = 100 - assigned;
  // hand out remainder to largest fractional parts (or first cells if sum===0)
  const order = [...target].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < order.length && remainder > 0; i++) {
    order[i].w += 1;
    remainder--;
  }
  const map = new Map(target.map((t) => [t.id, t.w]));
  return layers.map((l) => (l.enabled ? { ...l, weight: map.get(l.id) ?? l.weight } : l));
}

export function applyWeights(layers: WorkingLayer[], weights: Record<string, number>): WorkingLayer[] {
  return layers.map((l) => (weights[l.id] != null ? { ...l, weight: weights[l.id], enabled: true } : { ...l, enabled: false }));
}
