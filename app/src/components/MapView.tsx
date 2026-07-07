import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl';
import { useAppStore } from '../store/useAppStore';
import { computeAllScores, cellScore, isValid, rampExpression, scoreDomain, contributions } from '../lib/score';
import { RadialChart } from './RadialChart';

const CARTO = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const GLYPHS = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/fonts/{fontstack}/{range}.pbf';

const FALLBACK_STYLE: any = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d0d0d' } }],
};

const GRID_SRC = 'grid-src';
const GRID_FILL = 'grid-fill';
const GRID_LINE = 'grid-line';
const GRID_HOVER = 'grid-hover';
const GRID_SEL_GLOW = 'grid-sel-glow';
const GRID_SEL = 'grid-sel';
const CENTER: [number, number] = [73.232, 22.605];

export default function MapView() {
  const mapRef = useRef<MLMap | null>(null);
  const radialRef = useRef<RadialChart | null>(null);
  const chipRef = useRef<Marker | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const idxByCell = useRef<Record<string, number>>({});
  const readyRef = useRef(false);

  // ---- init map once data present ----
  const grid = useAppStore((s) => s.grid);
  useEffect(() => {
    if (!grid || mapRef.current) return;
    let cancelled = false;

    (async () => {
      let style: any = FALLBACK_STYLE;
      try {
        const r = await fetch(CARTO);
        if (r.ok) style = await r.json();
      } catch {
        /* fall back to inline dark style — grid still renders */
      }
      if (cancelled) return;

      const map = new maplibregl.Map({
        container: 'map',
        style,
        center: CENTER,
        zoom: 10.6,
        pitch: 0,
        bearing: -8,
        attributionControl: { compact: true },
        maxPitch: 70,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      map.on('load', () => {
        // grid source
        const fc = {
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
        map.addSource(GRID_SRC, { type: 'geojson', data: fc });

        map.addLayer({
          id: GRID_FILL,
          type: 'fill',
          source: GRID_SRC,
          paint: {
            'fill-color': rampExpression(false),
            'fill-opacity': 0.78,
          },
        });
        map.addLayer({
          id: GRID_LINE,
          type: 'line',
          source: GRID_SRC,
          paint: { 'line-color': 'rgba(255,255,255,0.10)', 'line-width': 0.5 },
        });
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

        addOverlays(map);
        radialRef.current = new RadialChart(map);
        readyRef.current = true;

        // initial paint
        pushScores();

        // hover tooltip element (numeric relief for the color ramp)
        const tip = document.createElement('div');
        tip.className = 'cell-tip tnum';
        map.getContainer().appendChild(tip);
        tipRef.current = tip;

        // interactions
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
          const v = isValid(st.layers) ? cellScore(cellId, st.layers, st.scores) : null;
          tip.textContent = `${cellId.toUpperCase()} · ${v == null ? '—' : Math.round(v * 100)}`;
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
          const hits = map.queryRenderedFeatures(e.point, { layers: [GRID_FILL] });
          if (hits.length === 0) useAppStore.getState().selectCell(null);
        });
      });
    })();

    return () => { cancelled = true; };
  }, [grid]);

  // ---- push scores to feature-state; dim on invalid ----
  function pushScores() {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getSource(GRID_SRC)) return;
    const st = useAppStore.getState();
    const cells = st.grid!.cells;
    const valid = isValid(st.layers);
    const scores = computeAllScores(cells, st.layers, st.scores);
    for (let i = 0; i < cells.length; i++) {
      map.setFeatureState({ source: GRID_SRC, id: i }, { score: scores[i] < 0 ? null : scores[i] });
    }
    if (valid) {
      const domain = st.ui.relativeRamp ? scoreDomain(scores) : ([0, 1] as [number, number]);
      map.setPaintProperty(GRID_FILL, 'fill-color', rampExpression(st.ui.cvdSafeRamp, domain));
      map.setPaintProperty(GRID_FILL, 'fill-opacity', 0.78);
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
      }
    });
    return unsub;
  }, []);

  // ---- selection: camera + radial ----
  const selectedCell = useAppStore((s) => s.selectedCell);
  const prevSelIdx = useRef<number | null>(null);
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
    inner.innerHTML = `<div class="chip-score tnum">${scoreVal}</div><div class="chip-label">usability</div>`;
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

// ---- overlay layers ----
function addOverlays(map: MLMap) {
  const base = import.meta.env.BASE_URL + 'data/overlays/';
  const add = (id: string, url: string) => {
    map.addSource(`ov-${id}-src`, { type: 'geojson', data: url });
  };
  add('expressway', base + 'expressway.geojson');
  add('railway', base + 'railway.geojson');
  add('statehighway', base + 'statehighway.geojson');
  add('river', base + 'river.geojson');

  // river (fill)
  map.addLayer({
    id: 'ov-river', type: 'fill', source: 'ov-river-src',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#2f6fc0', 'fill-opacity': 0.35, 'fill-outline-color': '#66a3ff' },
  });
  // expressway glow + line
  map.addLayer({
    id: 'ov-expressway-glow', type: 'line', source: 'ov-expressway-src',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#fab219', 'line-width': 9, 'line-opacity': 0.25, 'line-blur': 6 },
  });
  map.addLayer({
    id: 'ov-expressway', type: 'line', source: 'ov-expressway-src',
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#ffd166', 'line-width': 2.6, 'line-dasharray': [2, 1.4] },
  });
  // railway
  map.addLayer({
    id: 'ov-railway-glow', type: 'line', source: 'ov-railway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.14, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'ov-railway', type: 'line', source: 'ov-railway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#e8e8e2', 'line-width': 1.8, 'line-dasharray': [3, 2] },
  });
  // state highways
  map.addLayer({
    id: 'ov-statehighway-glow', type: 'line', source: 'ov-statehighway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#22d3ee', 'line-width': 5, 'line-opacity': 0.18, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'ov-statehighway', type: 'line', source: 'ov-statehighway-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#22d3ee', 'line-width': 1.6, 'line-opacity': 0.9 },
  });
}
