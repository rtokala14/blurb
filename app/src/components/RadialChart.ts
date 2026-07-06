import maplibregl, { type Map as MLMap, Marker } from 'maplibre-gl';
import type { Contribution } from '../types';
import { buildSectors, easeOutCubic, type SectorFeature } from '../lib/radial';

const SRC = 'radial-src';
const FILL = 'radial-fill';

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Drives the 360° radial column chart via a fill-extrusion layer whose per-
// feature height is animated with requestAnimationFrame. Sector labels are
// HTML markers (not a symbol layer) so they render even when the basemap's
// glyph tiles are unreachable, and can carry richer styling.
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
  private markers: Marker[] = [];

  constructor(map: MLMap) {
    this.map = map;
    this.ensureLayers();
  }

  private ensureLayers() {
    const map = this.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
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
    this.renderLabels();

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

  private renderLabels() {
    this.clearMarkers();
    for (const f of this.features) {
      const p = f.properties;
      // Near-zero sectors are flat and effectively invisible; labelling them
      // only adds clutter — the inspector lists every layer regardless.
      if (p.contribution < 0.5) continue;
      const pts = p.contribution.toFixed(p.contribution >= 10 ? 0 : 1);
      // MapLibre positions the marker root via an inline CSS transform, so the
      // entry animation must live on an inner wrapper — animating transform on
      // the root would override the marker's positioning.
      const el = document.createElement('div');
      const inner = document.createElement('div');
      inner.className = 'sector-label';
      inner.innerHTML =
        `<span class="sl-dot" style="background:${p.color}"></span>` +
        `<span class="sl-name"></span>` +
        `<span class="sl-pts tnum">${pts}</span>`;
      (inner.querySelector('.sl-name') as HTMLElement).textContent = p.name;
      el.appendChild(inner);
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.labelLon, p.labelLat])
        .addTo(this.map);
      this.markers.push(m);
    }
  }

  private clearMarkers() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
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
    this.clearMarkers();
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
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.clearMarkers();
  }
}
