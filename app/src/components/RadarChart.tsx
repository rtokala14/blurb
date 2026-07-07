import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

// Compact axis labels for the radar; falls back to the first word of the
// catalog name for any layer not listed.
const SHORT: Record<string, string> = {
  roads: 'Roads',
  industrial: 'Industry',
  slope: 'Slope',
  doublecrop: 'Agri',
  settlements: 'Settle',
  railway: 'Rail',
  junctions: 'Junctions',
  streams: 'Water',
  jantri: 'Price',
  npo: 'NPO',
  wfpr: 'WFPR',
  gidc: 'GIDC',
};

const SIZE = 288;
const CX = SIZE / 2;
const CY = 148;
const R = 96;

export default function RadarChart() {
  const layers = useAppStore((s) => s.layers);
  const scores = useAppStore((s) => s.scores);
  const grid = useAppStore((s) => s.grid);
  const catalogById = useAppStore((s) => s.catalogById);
  const hover = useAppStore((s) => s.hoverCell);
  const selected = useAppStore((s) => s.selectedCell);

  const enabled = layers.filter((l) => l.enabled);

  // Grid-average raw score per layer (weight-independent).
  const means = useMemo(() => {
    const m: Record<string, number> = {};
    if (!grid) return m;
    for (const l of layers) {
      const ls = scores[l.id];
      let sum = 0, n = 0;
      for (const c of grid.cells) {
        const v = ls?.[c.id];
        if (v != null) { sum += v; n++; }
      }
      m[l.id] = n ? sum / n : 0;
    }
    return m;
  }, [grid, scores, layers]);

  if (enabled.length < 3) {
    return <div className="radar-wrap"><div className="dock-hint">Enable at least 3 layers to see the profile radar.</div></div>;
  }

  const activeCell = hover ?? selected;
  const n = enabled.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number): [number, number] => [
    CX + Math.cos(angle(i)) * R * v,
    CY + Math.sin(angle(i)) * R * v,
  ];
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ');

  const avgVals = enabled.map((l) => means[l.id] ?? 0);
  // Missing cell data plots at the grid mean (neutral) with a dimmed vertex
  // dot, so a data gap never reads as a genuine zero.
  const activeVals = activeCell
    ? enabled.map((l) => scores[l.id]?.[activeCell] ?? means[l.id] ?? 0)
    : null;
  const activeHasData = activeCell
    ? enabled.map((l) => scores[l.id]?.[activeCell] != null)
    : null;

  const context = activeCell ? `Cell ${activeCell.toUpperCase()}` : 'Grid average';

  return (
    <div className="radar-wrap">
      <div className="radar-sub">
        <span className="radar-context tnum">{context}</span>
        {activeCell && (
          <span className="radar-legend">
            <span className="rl-swatch cell" /> cell
            <span className="rl-swatch avg" /> grid avg
          </span>
        )}
      </div>
      <svg width={SIZE} height={SIZE - 24} viewBox={`0 0 ${SIZE} ${SIZE - 24}`} role="img" aria-label="Per-layer score profile">
        {/* rings */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <polygon key={t} points={poly(enabled.map(() => t))}
            fill="none" stroke="var(--chart-grid)" strokeWidth={1} />
        ))}
        {/* axes */}
        {enabled.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />;
        })}
        {/* ring value labels along the top axis */}
        {[0.5, 1].map((t) => (
          <text key={t} x={CX + 4} y={CY - R * t + 3} fontSize={8} fill="var(--ink-3)" className="tnum">
            {Math.round(t * 100)}
          </text>
        ))}
        {/* grid-average polygon */}
        <polygon points={poly(avgVals)}
          fill="var(--chart-avg-fill)" stroke="var(--chart-avg-stroke)" strokeWidth={1.2} />
        {/* active cell polygon */}
        {activeVals && (
          <polygon points={poly(activeVals)}
            fill="var(--chart-cell-fill)" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {/* vertex dots, layer-colored */}
        {activeVals && activeVals.map((v, i) => {
          const [x, y] = pt(i, v);
          const def = catalogById[enabled[i].id];
          return (
            <circle key={i} cx={x} cy={y} r={3.4}
              fill={def?.color ?? '#fff'}
              opacity={activeHasData![i] ? 1 : 0.3}
              stroke="rgba(0,0,0,0.5)" strokeWidth={1}>
              <title>{`${def?.name}: ${activeHasData![i] ? Math.round(v * 100) + '%' : 'no data'}`}</title>
            </circle>
          );
        })}
        {/* axis labels */}
        {enabled.map((l, i) => {
          const a = angle(i);
          const [x, y] = [CX + Math.cos(a) * (R + 15), CY + Math.sin(a) * (R + 15)];
          const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
          const def = catalogById[l.id];
          const label = SHORT[l.id] ?? def?.name.split(' ')[0] ?? l.id;
          return (
            <text key={l.id} x={x} y={y + 3} fontSize={9} fontWeight={600}
              fill="var(--ink-2)" textAnchor={anchor}>
              <title>{def?.name}</title>
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
