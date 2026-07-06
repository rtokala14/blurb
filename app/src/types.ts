export interface Cell {
  id: string;
  ring: [number, number][];
  centroid: [number, number];
}
export interface GridData {
  cells: Cell[];
}
export type Scores = Record<string, Record<string, number>>;

export interface LayerDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  defaultWeight: number;
  sourceFile: string;
  field: string;
  kind: 'grid' | 'village';
  allZero: boolean;
  defaultEnabled: boolean;
  histogram: number[];
}

export interface WorkingLayer {
  id: string;
  weight: number;
  enabled: boolean;
}

export interface Contribution {
  id: string;
  name: string;
  color: string;
  weight: number;
  score: number | null;
  contribution: number; // points on 0-100 scale (post re-normalization)
}
