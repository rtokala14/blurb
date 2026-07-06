import type { Map as MLMap } from 'maplibre-gl';
import type { Contribution } from '../types';
import { buildSectors, easeOutCubic, type SectorFeature } from '../lib/radial';

const SRC = 'radial-src';
const LBL_SRC = 'radial-label-src';
const FILL = 'radial-fill';
const LBL = 'radial-label';

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Drives the 360° radial column chart via a fill-extrusion layer whose per-
// feature height is animated with requestAnimationFrame.
export class RadialChart {
  private map: MLMap;
  private features: SectorFeature[] = [];
  private current: number[] = []; // current animated heights
  private targets: number[] = [];
  private raf = 0;
  private startTime = 0;
  private duration = 600;
  private fromHeights: number[] = [];
  private active = false;

  constructor(map: MLMap) {
    this.map = map;
    this.ensureLayers();
  }

  private ensureLayers() {
    const map = this.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource(LBL_SRC)) {
      map.addSource(LBL_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(FILL)) {
      map.addLayer({
        id: FILL,
        type: 'fill-extrusion',
        source: SRC,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'animHeight'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }
    if (!map.getLayer(LBL)) {
      map.addLayer({
        id: LBL,
        type: 'symbol',
        source: LBL_SRC,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-max-width': 8,
          'symbol-z-order': 'source',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.6,
        },
      });
    }
  }

  // Erupt (or re-animate) the chart for a set of contributions at a centroid.
  show(center: [number, number], contribs: Contribution[]) {
    this.ensureLayers();
    this.features = buildSectors(center, contribs);
    this.targets = this.features.map((f) => f.properties.targetHeight);
    this.active = true;

    // labels
    const labels = {
      type: 'FeatureCollection' as const,
      features: this.features.map((f) => ({
        type: 'Feature' as const,
        properties: {
          label: `${f.properties.name}\n${f.properties.contribution.toFixed(f.properties.contribution >= 10 ? 0 : 1)} pts`,
        },
        geometry: { type: 'Point' as const, coordinates: [f.properties.labelLon, f.properties.labelLat] },
      })),
    };
    (this.map.getSource(LBL_SRC) as any)?.setData(labels);

    // animate from current heights (0 if new count)
    this.fromHeights = this.features.map((_, i) => this.current[i] ?? 0);
    this.current = [...this.fromHeights];
    if (prefersReduced) {
      this.current = [...this.targets];
      this.render();
      return;
    }
    this.startTime = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  private loop = () => {
    const t = Math.min(1, (performance.now() - this.startTime) / this.duration);
    const e = easeOutCubic(t);
    this.current = this.targets.map((tg, i) => this.fromHeights[i] + (tg - this.fromHeights[i]) * e);
    this.render();
    if (t < 1) this.raf = requestAnimationFrame(this.loop);
  };

  private render() {
    if (!this.map.getSource(SRC)) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: this.features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, animHeight: this.current[i] ?? 0 },
      })),
    };
    (this.map.getSource(SRC) as any)?.setData(fc);
  }

  // Animate all columns down to 0, then clear.
  hide() {
    if (!this.active) return;
    this.active = false;
    if (this.features.length === 0) return;
    if (prefersReduced) { this.clear(); return; }
    this.fromHeights = this.features.map((_, i) => this.current[i] ?? 0);
    this.targets = this.features.map(() => 0);
    this.startTime = performance.now();
    cancelAnimationFrame(this.raf);
    const down = () => {
      const t = Math.min(1, (performance.now() - this.startTime) / this.duration);
      const e = easeOutCubic(t);
      this.current = this.fromHeights.map((h) => h * (1 - e));
      this.render();
      if (t < 1) this.raf = requestAnimationFrame(down);
      else this.clear();
    };
    this.raf = requestAnimationFrame(down);
  }

  private clear() {
    this.features = [];
    this.current = [];
    (this.map.getSource(SRC) as any)?.setData({ type: 'FeatureCollection', features: [] });
    (this.map.getSource(LBL_SRC) as any)?.setData({ type: 'FeatureCollection', features: [] });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}
