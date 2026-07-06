import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeAllScores, scoreDomain, isValid } from '../lib/score';

export default function Legend() {
  const cvd = useAppStore((s) => s.ui.cvdSafeRamp);
  const relative = useAppStore((s) => s.ui.relativeRamp);
  const grid = useAppStore((s) => s.grid);
  const layers = useAppStore((s) => s.layers);
  const scores = useAppStore((s) => s.scores);

  const valid = isValid(layers);
  const domain = useMemo<[number, number]>(() => {
    if (!relative || !valid || !grid) return [0, 1];
    return scoreDomain(computeAllScores(grid.cells, layers, scores));
  }, [relative, valid, grid, layers, scores]);

  const gradient = cvd
    ? 'linear-gradient(90deg, #0d366b, #2f6fc0, #cde2fb)'
    : 'linear-gradient(90deg, #d03b3b, #fab219, #0ca30c)';

  const [lo, hi] = domain;
  const ticks = relative
    ? [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi].map((v) =>
        Math.round(v * 100)
      )
    : [0, 25, 50, 75, 100];

  return (
    <div className="legend glass">
      <div className="overline">Usability score</div>
      <div className="legend-bar" style={{ background: gradient }} />
      <div className="legend-scale tnum">
        {ticks.map((t, i) => <span key={i}>{t}</span>)}
      </div>
      <div className="legend-ends">
        <span>{cvd ? 'Low suitability' : 'Avoid'}</span>
        <span>{cvd ? 'High suitability' : 'Prime'}</span>
      </div>
      {relative && valid && (
        <div className="legend-note">Contrast stretched to grid range {ticks[0]}–{ticks[4]}</div>
      )}
    </div>
  );
}
