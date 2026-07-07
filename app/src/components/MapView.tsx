import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl';
import { useAppStore, type Basemap } from '../store/useAppStore';
import { computeAllScores, cellScore, isValid, rampExpression, scoreDomain, contributions } from '../lib/score';
import { RadialChart } from './RadialChart';

const GLYPHS = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/fonts/{fontstack}/{range}.pbf';

// Inline fallback when a vector style fetch fails — the grid still renders.
// Background tone follows the requested basemap so an offline 'light' swap
// doesn't strand the light UI on a black void.
const fallbackStyle = (bg: string): any => ({
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }],
});
const FALLBACK_BG: Partial<Record<Basemap, string>> = { dark: '#0d0d0d', light: '#e9e7e2' };

// Vector styles are fetched (with the dark fallback); raster basemaps are
// built inline so they need no style fetch — only tiles, which can also fail
// gracefully (grid still renders over the background color).
const STYLE_URLS: Partial<Record<Basemap, string>> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const rasterStyle = (tiles: string, attribution: string, bg: string): any => ({
  version: 8,
  glyphs: GLYPHS,
  sources: {
    basemap: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 19, attribution },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': bg } },
    { id: 'basemap', type: 'raster', source: 'basemap' },
  ],
});

const RASTER_STYLES: Partial<Record<Basemap, any>> = {
  satellite: rasterStyle(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    'Esri, Maxar, Earthstar Geographics',
    '#1a231d'
  ),
  terrain: rasterStyle(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    'Esri, USGS, NOAA',
    '#e8e6de'
  ),
};

const styleCache: Partial<Record<Basemap, any>> = {};

async function buildStyle(basemap: Basemap): Promise<any> {
  if (RASTER_STYLES[basemap]) return RASTER_STYLES[basemap];
  if (styleCache[basemap]) return styleCache[basemap];
  try {
    const r = await fetch(STYLE_URLS[basemap]!);
    if (r.ok) {
      const style = await r.json();
      styleCache[basemap] = style;
      return style;
    }
  } catch {
    /* fall back to the inline style — grid still renders */
  }
  return fallbackStyle(FALLBACK_BG[basemap] ?? '#0d0d0d');
}

// Grid outline contrast per basemap: imagery needs brighter lines, the light
// vector & topo basemaps need dark lines, dark keeps the original hairline.
const GRID_LINE_COLOR: Record<Basemap, string> = {
  dark: 'rgba(255,255,255,0.10)',
  light: 'rgba(11,11,11,0.14)',
  satellite: 'rgba(255,255,255,0.24)',
  terrain: 'rgba(11,11,11,0.18)',
};

const GRID_SRC = 'grid-src';
const GRID_FILL = 'grid-fill';
const GRID_LINE = 'grid-line';
const GRID_HOVER = 'grid-hover';
const GRID_SEL_GLOW = 'grid-sel-glow';
const GRID_SEL = 'grid-sel';
const CENTER: [number, number] = [73.232, 22.605];
const HOME = { center: CENTER, zoom: 10.6, pitch: 0, bearing: -8 };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MapView() {
  const mapRef = useRef<MLMap | null>(null);
  const radialRef = useRef<RadialChart | null>(null);
  const chipRef = useRef<Marker | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const idxByCell = useRef<Record<string, number>>({});
  const gridFC = useRef<any>(null);
  const readyRef = useRef(false);
  const appliedBasemap = useRef<Basemap | null>(null);
  const prevSelIdx = useRef<number | null>(null);

  // ---- (re)add every app source/layer; runs on load and after setStyle ----
  // map.setStyle() wipes ALL custom sources, layers and feature-states, so
  // everything the app draws must be re-addable. Each add is guarded so a
  // double 'style.load'/initial-load overlap never throws.
  function attachAppLayers(map: MLMap) {
    if (!map.getSource(GRID_SRC)) {
      map.addSource(GRID_SRC, { type: 'geojson', data: gridFC.current });
    }
    if (!map.getLayer(GRID_FILL)) {
      map.addLayer({
        id: GRID_FILL,
        type: 'fill',
        source: GRID_SRC,
        paint: {
          'fill-color': rampExpression(false),
          'fill-opacity': 0.78,
        },
      });
    }
    if (!map.getLayer(GRID_LINE)) {
      map.addLayer({
        id: GRID_LINE,
        type: 'line',
        source: GRID_SRC,
        paint: { 'line-color': GRID_LINE_COLOR.dark, 'line-width': 0.5 },
      });
    }
    if (!map.getLayer(GRID_HOVER)) {
      map.addLayer({
        id: GRID_HOVER,
        type: 'line',
        source: GRID_SRC,
        paint: {
          'line-color': '#22d3ee',
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.4, 0],
          'line-opacity': 0.95,
        },
      });
    }
    if (!map.getLayer(GRID_SEL_GLOW)) {
      map.addLayer({
        id: GRID_SEL_GLOW,
        type: 'line',
        source: GRID_SRC,
        paint: {
          'line-color': '#22d3ee',
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 0],
          'line-blur': 5,
          'line-opacity': 0.45,
        },
      });
    }
    if (!map.getLayer(GRID_SEL)) {
      map.addLayer({
        id: GRID_SEL,
        type: 'line',
        source: GRID_SRC,
        paint: {
          'line-color': '#7ff3ff',
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.6, 0],
          'line-opacity': 0.95,
        },
      });
    }
    addOverlays(map);
  }

  // Restore everything setStyle wiped: layers, feature-states, paint driven
  // by store state, overlay visibility, and the radial chart if showing.
  function restoreAppState(map: MLMap) {
    attachAppLayers(map);
    if (!radialRef.current) radialRef.current = new RadialChart(map);
    else radialRef.current.reattach();
    readyRef.current = true;

    const st = useAppStore.getState();

    // grid line contrast for the active basemap
    map.setPaintProperty(GRID_LINE, 'line-color', GRID_LINE_COLOR[st.ui.basemap]);

    // (a) score feature-states + ramp/opacity paint
    pushScores();

    // (b) selected-cell feature-state
    if (prevSelIdx.current !== null) {
      map.setFeatureState({ source: GRID_SRC, id: prevSelIdx.current }, { selected: true });
    }

    // (c) overlay visibility from store state
    for (const [id, vis] of Object.entries(st.overlays)) {
      for (const suffix of ['', '-glow']) {
        const lid = `ov-${id}${suffix}`;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', vis ? 'visible' : 'none');
      }
    }
    // (d) radial chart re-attached above; the score chip & sector labels are
    // HTML markers, which survive a style swap untouched.
  }

  // ---- init map once data present ----
  const grid = useAppStore((s) => s.grid);
  useEffect(() => {
    if (!grid || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const initialBasemap = useAppStore.getState().ui.basemap;
      const style = await buildStyle(initialBasemap);
      if (cancelled) return;
      appliedBasemap.current = initialBasemap;

      gridFC.current = {
        type: 'FeatureCollection' as const,
        features: grid.cells.map((c, i) => {
          idxByCell.current[c.id] = i;
          return {
            type: 'Feature' as const,
            id: i,
            properties: { cellId: c.id, idx: i },
            geometry: { type: 'Polygon' as const, coordinates: [c.ring] },
          };
        }),
      };

      const map = new maplibregl.Map({
        container: 'map',
        style,
        // Cinematic load-in starts wide and pitched, then eases to the
        // working view; reduced-motion users start at the working view.
        center: CENTER,
        zoom: REDUCED_MOTION ? HOME.zoom : 9.5,
        pitch: REDUCED_MOTION ? HOME.pitch : 52,
        bearing: REDUCED_MOTION ? HOME.bearing : -34,
        attributionControl: { compact: true },
        maxPitch: 70,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      map.on('load', () => {
        restoreAppState(map);

        // intro: grid colors bloom in while the camera settles.
        // Runs on first load only — never after a basemap change.
        if (!REDUCED_MOTION) {
          map.setPaintProperty(GRID_FILL, 'fill-opacity-transition', { duration: 0, delay: 0 } as any);
          map.setPaintProperty(GRID_FILL, 'fill-opacity', 0);
          window.setTimeout(() => {
            map.setPaintProperty(GRID_FILL, 'fill-opacity-transition', { duration: 1600, delay: 300 } as any);
            map.setPaintProperty(GRID_FILL, 'fill-opacity', 0.78);
            map.easeTo({ ...HOME, duration: 2800, easing: (t) => 1 - Math.pow(1 - t, 3) });
            // restore snappy transitions once the intro has finished
            window.setTimeout(() => {
              map.setPaintProperty(GRID_FILL, 'fill-opacity-transition', { duration: 300, delay: 0 } as any);
            }, 2400);
          }, 150);
        }

        // hover tooltip element (numeric relief for the color ramp)
        const tip = document.createElement('div');
        tip.className = 'cell-tip tnum';
        map.getContainer().appendChild(tip);
        tipRef.current = tip;

        // interactions — delegated by layer id, so they keep working after
        // the layer is re-added following a basemap change
        let hoverId: number | null = null;
        map.on('mousemove', GRID_FILL, (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const f = e.features?.[0];
          if (!f) return;
          const id = f.id as number;
          if (hoverId !== null && hoverId !== id) {
            map.setFeatureState({ source: GRID_SRC, id: hoverId }, { hover: false });
          }
          hoverId = id;
          map.setFeatureState({ source: GRID_SRC, id }, { hover: true });
          const cellId = (f.properties as any).cellId as string;
          useAppStore.getState().setHover(cellId);
          const st = useAppStore.getState();
          const eff = st.previewLayers ?? st.layers;
          const v = isValid(eff) ? cellScore(cellId, eff, st.scores) : null;
          tip.textContent = `${cellId.toUpperCase()} · ${v == null ? '—' : Math.round(v * 100) + '%'}`;
          tip.style.display = 'block';
          const maxX = map.getCanvas().clientWidth - 110;
          tip.style.transform = `translate(${Math.min(e.point.x + 14, maxX)}px, ${e.point.y + 18}px)`;
        });
        map.on('mouseleave', GRID_FILL, () => {
          map.getCanvas().style.cursor = '';
          if (hoverId !== null) map.setFeatureState({ source: GRID_SRC, id: hoverId }, { hover: false });
          hoverId = null;
          useAppStore.getState().setHover(null);
          tip.style.display = 'none';
        });
        map.on('click', GRID_FILL, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          useAppStore.getState().selectCell((f.properties as any).cellId);
        });
        map.on('click', (e) => {
          if (!map.getLayer(GRID_FILL)) return; // mid style-swap
          const hits = map.queryRenderedFeatures(e.point, { layers: [GRID_FILL] });
          if (hits.length === 0) useAppStore.getState().selectCell(null);
        });
      });
    })();

    return () => { cancelled = true; };
  }, [grid]);

  // ---- basemap switching ----
  const basemap = useAppStore((s) => s.ui.basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || appliedBasemap.current === basemap) return;
    let cancelled = false;
    (async () => {
      const style = await buildStyle(basemap);
      if (cancelled || !mapRef.current) return;
      appliedBasemap.current = basemap;
      readyRef.current = false; // pushScores no-ops until layers are back
      // diff:false forces a full style reload so 'style.load' always fires
      // (a successful diff would silently strip our layers and never fire it).
      // Clone: setStyle may mutate the style object, and fallbacks are shared.
      map.once('style.load', () => restoreAppState(map));
      map.setStyle(JSON.parse(JSON.stringify(style)), { diff: false });
    })();
    return () => { cancelled = true; };
  }, [basemap]);

  // ---- push scores to feature-state; dim on invalid ----
  function pushScores() {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getSource(GRID_SRC)) return;
    const st = useAppStore.getState();
    const cells = st.grid!.cells;
    const effLayers = st.previewLayers ?? st.layers; // preset hover-preview
    const valid = isValid(effLayers);
    const scores = computeAllScores(cells, effLayers, st.scores);
    for (let i = 0; i < cells.length; i++) {
      map.setFeatureState({ source: GRID_SRC, id: i }, { score: scores[i] < 0 ? null : scores[i] });
    }
    if (valid) {
      const domain = st.ui.relativeRamp ? scoreDomain(scores) : ([0, 1] as [number, number]);
      map.setPaintProperty(GRID_FILL, 'fill-color', rampExpression(st.ui.cvdSafeRamp, domain));
      // Focus mode while a cell is selected: fade the heatmap so the radial
      // columns stand apart from the cell colors (selected cell stays bright).
      map.setPaintProperty(
        GRID_FILL,
        'fill-opacity',
        st.selectedCell
          ? (['case', ['boolean', ['feature-state', 'selected'], false], 0.92, 0.18] as any)
          : 0.78
      );
    } else {
      // desaturate to gray + low opacity
      map.setPaintProperty(GRID_FILL, 'fill-color', [
        'interpolate', ['linear'], ['coalesce', ['feature-state', 'score'], -1],
        -1, '#2a2a28', 0, '#3a3a38', 0.5, '#54544f', 1, '#6d6d66',
      ] as any);
      map.setPaintProperty(GRID_FILL, 'fill-opacity', 0.32);
    }
  }

  // subscribe to store changes affecting scores
  useEffect(() => {
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.layers !== prev.layers || s.ui.cvdSafeRamp !== prev.ui.cvdSafeRamp || s.ui.relativeRamp !== prev.ui.relativeRamp) {
        pushScores();
        // live re-animate radial if a cell is selected & valid
        if (s.selectedCell && isValid(s.layers)) reanimateRadial(s.selectedCell);
        else if (!isValid(s.layers)) { /* freeze radial */ }
      } else if (s.previewLayers !== prev.previewLayers) {
        // preview repaints the heatmap only; radial stays on committed weights
        pushScores();
      }
    });
    return unsub;
  }, []);

  // ---- selection: camera + radial ----
  const selectedCell = useAppStore((s) => s.selectedCell);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const st = useAppStore.getState();
    if (prevSelIdx.current !== null) {
      map.setFeatureState({ source: GRID_SRC, id: prevSelIdx.current }, { selected: false });
      prevSelIdx.current = null;
    }
    if (selectedCell != null && idxByCell.current[selectedCell] != null) {
      const idx = idxByCell.current[selectedCell];
      map.setFeatureState({ source: GRID_SRC, id: idx }, { selected: true });
      prevSelIdx.current = idx;
    }
    pushScores(); // re-applies fill opacity for the focus/normal state
    if (!selectedCell) {
      radialRef.current?.hide();
      chipRef.current?.remove();
      chipRef.current = null;
      map.easeTo({ pitch: 0, zoom: 10.6, bearing: -8, duration: 900 });
      map.setPaintProperty(GRID_HOVER, 'line-color', '#22d3ee');
      return;
    }
    const cell = st.grid!.cells.find((c) => c.id === selectedCell);
    if (!cell) return;
    map.flyTo({ center: cell.centroid, zoom: 13.2, pitch: 58, bearing: 18, duration: 1100, essential: true });
    if (isValid(st.layers)) reanimateRadial(selectedCell);
    updateChip(selectedCell);
  }, [selectedCell]);

  function reanimateRadial(cellId: string) {
    const map = mapRef.current;
    if (!map || !radialRef.current) return;
    const st = useAppStore.getState();
    const cell = st.grid!.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const { contribs } = contributions(cellId, st.layers, st.catalogById, st.scores);
    const enabled = contribs.filter((c) => st.layers.find((l) => l.id === c.id)?.enabled);
    radialRef.current.show(cell.centroid, enabled);
    updateChip(cellId);
  }

  function updateChip(cellId: string) {
    const map = mapRef.current;
    if (!map) return;
    const st = useAppStore.getState();
    const cell = st.grid!.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const { total } = contributions(cellId, st.layers, st.catalogById, st.scores);
    const scoreVal = Math.round(total);
    if (!chipRef.current) {
      // Inner wrapper carries the pop animation; MapLibre positions the root
      // via an inline transform that a keyframed transform would override.
      // Floated above the ring so far-side sector labels stay unobstructed.
      const root = document.createElement('div');
      const inner = document.createElement('div');
      inner.className = 'score-chip';
      root.appendChild(inner);
      chipRef.current = new maplibregl.Marker({ element: root, anchor: 'bottom', offset: [0, -170] })
        .setLngLat(cell.centroid)
        .addTo(map);
    }
    const inner = chipRef.current.getElement().firstElementChild as HTMLElement;
    inner.innerHTML = `<div class="chip-score tnum">${scoreVal}%</div><div class="chip-label">suitability</div>`;
    chipRef.current.setLngLat(cell.centroid);
  }

  // ---- overlays ----
  const overlays = useAppStore((s) => s.overlays);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    for (const [id, vis] of Object.entries(overlays)) {
      for (const suffix of ['', '-glow']) {
        const lid = `ov-${id}${suffix}`;
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', vis ? 'visible' : 'none');
      }
    }
  }, [overlays]);

  return (
    <>
      <div id="map" />
      <div className="map-vignette" />
    </>
  );
}

// ---- overlay layers (guarded — re-run after every basemap change) ----
function addOverlays(map: MLMap) {
  const base = import.meta.env.BASE_URL + 'data/overlays/';
  const add = (id: string, url: string) => {
    if (!map.getSource(`ov-${id}-src`)) {
      map.addSource(`ov-${id}-src`, { type: 'geojson', data: url });
    }
  };
  add('expressway', base + 'expressway.geojson');
  add('railway', base + 'railway.geojson');
  add('statehighway', base + 'statehighway.geojson');
  add('river', base + 'river.geojson');

  const addLayer = (spec: any) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  };

  // river (fill)
  addLayer({
    id: 'ov-river', type: 'fill', source: 'ov-river-src',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#2f6fc0', 'fill-opacity': 0.35, 'fill-outline-color': '#66a3ff' },
  });
  // expressway glow + line
  addLayer({
    id: 'ov-expressway-glow', type: 'line', source: 'ov-expressway-src',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#fab219', 'line-width': 9, 'line-opacity': 0.25, 'line-blur': 6 },
  });
  addLayer({
    id: 'ov-expressway', type: 'line', source: 'ov-expressway-src',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#ffd166', 'line-width': 2.6, 'line-dasharray': [2, 1.4] },
  });
  // railway
  addLayer({
    id: 'ov-railway-glow', type: 'line', source: 'ov-railway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.14, 'line-blur': 4 },
  });
  addLayer({
    id: 'ov-railway', type: 'line', source: 'ov-railway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#e8e8e2', 'line-width': 1.8, 'line-dasharray': [3, 2] },
  });
  // state highways
  addLayer({
    id: 'ov-statehighway-glow', type: 'line', source: 'ov-statehighway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#22d3ee', 'line-width': 5, 'line-opacity': 0.18, 'line-blur': 4 },
  });
  addLayer({
    id: 'ov-statehighway', type: 'line', source: 'ov-statehighway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#22d3ee', 'line-width': 1.6, 'line-opacity': 0.9 },
  });
}
