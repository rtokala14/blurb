import { create } from 'zustand';
import type { LayerDef, WorkingLayer, GridData, Scores } from '../types';
import { autoBalance as autoBalanceFn, applyWeights } from '../lib/score';

export interface Preset {
  id: string;
  name: string;
  weights: Record<string, number>; // enabled layers only; must sum to 100
}

export const PRESETS: Preset[] = [
  {
    id: 'balanced', name: 'Balanced',
    weights: { roads: 15, industrial: 15, slope: 10, doublecrop: 10, settlements: 10, railway: 10, junctions: 10, streams: 5, jantri: 5, npo: 5, wfpr: 5 },
  },
  {
    id: 'connectivity', name: 'Connectivity first',
    weights: { roads: 26, railway: 20, junctions: 20, industrial: 16, slope: 8, streams: 5, settlements: 5 },
  },
  {
    id: 'lowdisplace', name: 'Low displacement',
    weights: { settlements: 28, doublecrop: 24, streams: 12, slope: 10, jantri: 8, roads: 8, industrial: 5, npo: 5 },
  },
  {
    id: 'cheapland', name: 'Cheap land',
    weights: { jantri: 30, slope: 18, settlements: 14, doublecrop: 12, industrial: 10, roads: 8, npo: 4, wfpr: 4 },
  },
];

interface AppState {
  loaded: boolean;
  grid: GridData | null;
  scores: Scores;
  catalog: LayerDef[];
  catalogById: Record<string, LayerDef>;

  layers: WorkingLayer[];
  savedWeights: Record<string, number>; // remembered weight when disabled

  selectedCell: string | null;
  hoverCell: string | null;

  overlays: Record<string, boolean>;
  ui: { basemapLabels: boolean; cvdSafeRamp: boolean; panelOpen: boolean; relativeRamp: boolean };

  history: WorkingLayer[][]; // for undo

  activePreset: string | null;

  load: (grid: GridData, scores: Scores, catalog: LayerDef[]) => void;
  setWeight: (id: string, w: number) => void;
  toggleEnabled: (id: string) => void;
  removeLayer: (id: string) => void;
  addLayer: (id: string) => void;
  autoBalance: () => void;
  undo: () => void;
  applyPreset: (id: string) => void;
  selectCell: (id: string | null) => void;
  setHover: (id: string | null) => void;
  toggleOverlay: (id: string) => void;
  setUi: (patch: Partial<AppState['ui']>) => void;
}

const pushHistory = (s: AppState): WorkingLayer[][] =>
  [...s.history, s.layers.map((l) => ({ ...l }))].slice(-30);

export const useAppStore = create<AppState>((set) => ({
  loaded: false,
  grid: null,
  scores: {},
  catalog: [],
  catalogById: {},
  layers: [],
  savedWeights: {},
  selectedCell: null,
  hoverCell: null,
  overlays: { expressway: false, railway: false, statehighway: false, river: false },
  ui: { basemapLabels: false, cvdSafeRamp: false, panelOpen: true, relativeRamp: true },
  history: [],
  activePreset: 'balanced',

  load: (grid, scores, catalog) => {
    const catalogById: Record<string, LayerDef> = {};
    catalog.forEach((c) => (catalogById[c.id] = c));
    const layers: WorkingLayer[] = catalog
      .filter((c) => c.defaultEnabled)
      .map((c) => ({ id: c.id, weight: c.defaultWeight, enabled: true }));
    set({ loaded: true, grid, scores, catalog, catalogById, layers });
  },

  setWeight: (id, w) =>
    set((s) => ({
      history: pushHistory(s),
      activePreset: null,
      layers: s.layers.map((l) => (l.id === id ? { ...l, weight: Math.max(0, Math.min(100, w)) } : l)),
    })),

  toggleEnabled: (id) =>
    set((s) => {
      const layer = s.layers.find((l) => l.id === id);
      if (!layer) return {};
      const savedWeights = { ...s.savedWeights };
      let layers: WorkingLayer[];
      if (layer.enabled) {
        savedWeights[id] = layer.weight;
        layers = s.layers.map((l) => (l.id === id ? { ...l, enabled: false } : l));
      } else {
        const restored = savedWeights[id] ?? layer.weight;
        layers = s.layers.map((l) => (l.id === id ? { ...l, enabled: true, weight: restored } : l));
      }
      return { history: pushHistory(s), activePreset: null, layers, savedWeights };
    }),

  removeLayer: (id) =>
    set((s) => ({
      history: pushHistory(s),
      activePreset: null,
      layers: s.layers.filter((l) => l.id !== id),
    })),

  addLayer: (id) =>
    set((s) => {
      if (s.layers.some((l) => l.id === id)) return {};
      return {
        history: pushHistory(s),
        activePreset: null,
        layers: [...s.layers, { id, weight: 0, enabled: true }],
      };
    }),

  autoBalance: () =>
    set((s) => ({ history: pushHistory(s), activePreset: null, layers: autoBalanceFn(s.layers) })),

  undo: () =>
    set((s) => {
      if (s.history.length === 0) return {};
      const prev = s.history[s.history.length - 1];
      return { layers: prev, history: s.history.slice(0, -1), activePreset: null };
    }),

  applyPreset: (id) =>
    set((s) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return {};
      // ensure all preset layers exist in working set
      const existing = new Set(s.layers.map((l) => l.id));
      let layers = [...s.layers];
      for (const lid of Object.keys(preset.weights)) {
        if (!existing.has(lid)) layers.push({ id: lid, weight: 0, enabled: true });
      }
      layers = applyWeights(layers, preset.weights);
      return { history: pushHistory(s), layers, activePreset: id };
    }),

  selectCell: (id) => set({ selectedCell: id }),
  setHover: (id) => set({ hoverCell: id }),
  toggleOverlay: (id) => set((s) => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } })),
  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
}));
