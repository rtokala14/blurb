import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeAllScores, isValid } from '../lib/score';

export default function StatTiles() {
  const grid = useAppStore((s) => s.grid);
  const layers = useAppStore((s) => s.layers);
  const scores = useAppStore((s) => s.scores);

  const stats = useMemo(() => {
    if (!grid) return null;
    const arr = computeAllScores(grid.cells, layers, scores);
    let sum = 0, n = 0, max = 0, over70 = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < 0) continue;
      sum += arr[i]; n++;
      if (arr[i] > max) max = arr[i];
      if (arr[i] > 0.7) over70++;
    }
    return {
      mean: n ? (sum / n) * 100 : 0,
      max: max * 100,
      over70: n ? (over70 / n) * 100 : 0,
    };
  }, [grid, layers, scores]);

  if (!stats) return null;
  const valid = isValid(layers);

  const tiles = [
    { label: 'Grid', value: '500', sub: 'cells · 1 km² each' },
    { label: 'Mean score', value: valid ? stats.mean.toFixed(1) : '—', sub: 'across grid' },
    { label: 'Top cell', value: valid ? stats.max.toFixed(0) : '—', sub: 'peak score' },
    { label: 'Prime land', value: valid ? stats.over70.toFixed(0) + '%' : '—', sub: 'cells above 70' },
  ];

  return (
    <div className="stat-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="stat-tile glass">
          <div className="overline">{t.label}</div>
          <div className="stat-value tnum">{t.value}</div>
          <div className="stat-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
