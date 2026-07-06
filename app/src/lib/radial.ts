// Generates annulus-sector polygons for the 360° radial column chart, one
// sector per enabled layer, centered on a cell centroid. Heights are driven
// separately via fill-extrusion-height (animated); geometry here is static.

import type { Contribution } from '../types';

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

// Offset a lon/lat point by (east, north) meters.
function offset(lon: number, lat: number, east: number, north: number): [number, number] {
  const dLat = toDeg(north / R);
  const dLon = toDeg(east / (R * Math.cos(toRad(lat))));
  return [lon + dLon, lat + dLat];
}

export const INNER_R = 620;
export const OUTER_R = 900;
export const H_MAX = 2600;
export const GAP_DEG = 3;

export interface SectorFeature {
  type: 'Feature';
  properties: {
    layerId: string;
    name: string;
    color: string;
    contribution: number; // points 0-100
    targetHeight: number; // meters (final)
    labelLon: number;
    labelLat: number;
  };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

// Build sector polygons. Angular order follows the contributions array order.
export function buildSectors(
  center: [number, number],
  contribs: Contribution[]
): SectorFeature[] {
  const [lon, lat] = center;
  const n = contribs.length;
  if (n === 0) return [];
  const step = 360 / n;
  const half = GAP_DEG / 2;
  const ARC_SEGMENTS = Math.max(3, Math.round((step - GAP_DEG) / 4));

  return contribs.map((c, i) => {
    const a0 = i * step + half;
    const a1 = (i + 1) * step - half;
    const ring: [number, number][] = [];
    // outer arc (a0 -> a1)
    for (let k = 0; k <= ARC_SEGMENTS; k++) {
      const a = toRad(a0 + ((a1 - a0) * k) / ARC_SEGMENTS);
      ring.push(offset(lon, lat, Math.sin(a) * OUTER_R, Math.cos(a) * OUTER_R));
    }
    // inner arc (a1 -> a0)
    for (let k = ARC_SEGMENTS; k >= 0; k--) {
      const a = toRad(a0 + ((a1 - a0) * k) / ARC_SEGMENTS);
      ring.push(offset(lon, lat, Math.sin(a) * INNER_R, Math.cos(a) * INNER_R));
    }
    ring.push(ring[0]);

    const mid = toRad((a0 + a1) / 2);
    const labelR = OUTER_R + 130;
    const [labelLon, labelLat] = offset(lon, lat, Math.sin(mid) * labelR, Math.cos(mid) * labelR);

    return {
      type: 'Feature' as const,
      properties: {
        layerId: c.id,
        name: c.name,
        color: c.color,
        contribution: c.contribution,
        targetHeight: (c.contribution / 100) * H_MAX,
        labelLon,
        labelLat,
      },
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  });
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
