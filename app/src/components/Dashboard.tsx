import { useMemo } from 'react';
import { useAppStore, PRESETS } from '../store/useAppStore';
import { computeAllScores, contributions, isValid, totalWeight, scoreDomain, rampColor } from '../lib/score';
import { fmtScore1, fmtWeight, fmtPts } from '../lib/format';
import RadarChart from './RadarChart';
import WeightDonut from './WeightDonut';

// Full-viewport portfolio overview. Opaque overlay above the explorer panels
// (z 18) but below the brand card / error banner / modal, so the view tabs and
// the Σ≠100 banner stay reachable. MapView stays mounted underneath.
export default function Dashboard() {
  const view = useAppStore((s) => s.ui.view);
  const grid = useAppStore((s) => s.grid);
  const scores = useAppStore((s) => s.scores);
  const layers = useAppStore((s) => s.layers);
  const catalogById = useAppStore((s) => s.catalogById);
  const activePreset = useAppStore((s) => s.activePreset);
  const cvd = useAppStore((s) => s.ui.cvdSafeRamp);
  const relative = useAppStore((s) => s.ui.relativeRamp);
  const selectCell = useAppStore((s) => s.selectCell);
  const setUi = useAppStore((s) => s.setUi);

  const valid = isValid(layers);
  const total = totalWeight(layers);

  // All derived stats in one memo — 500 cells × ~12 layers, trivial cost.
  const stats = useMemo(() => {
    if (!grid) return null;
    const arr = computeAllScores(grid.cells, layers, scores);

    // headline stats over valid (>= 0) cells
    let sum = 0, n = 0, max = -1, maxId = '';
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < 0) continue;
      sum += v; n++;
      if (v > max) { max = v; maxId = grid.cells[i].id; }
    }
    const mean = n ? sum / n : 0;

    // distribution histogram over a snapped-to-2% domain around the data
    let lo = 1, hi = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < 0) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi <= lo) { lo = 0; hi = 1; }
    lo = Math.max(0, Math.floor(lo * 50) / 50);
    hi = Math.min(1, Math.ceil(hi * 50) / 50);
    const NB = 18;
    const bins = new Array(NB).fill(0);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v < 0) continue;
      bins[Math.min(NB - 1, Math.floor(((v - lo) / (hi - lo)) * NB))]++;
    }
    const rampDomain = relative ? scoreDomain(arr) : ([0, 1] as [number, number]);

    // average contribution points per layer + per-cell top driver
    const contribSum: Record<string, number> = {};
    const topDriver: Record<string, { name: string; color: string }> = {};
    for (const c of grid.cells) {
      const { contribs } = contributions(c.id, layers, catalogById, scores);
      let best = -1, bestIdx = -1;
      for (let k = 0; k < contribs.length; k++) {
        contribSum[contribs[k].id] = (contribSum[contribs[k].id] ?? 0) + contribs[k].contribution;
        if (contribs[k].contribution > best) { best = contribs[k].contribution; bestIdx = k; }
      }
      if (bestIdx >= 0) topDriver[c.id] = { name: contribs[bestIdx].name, color: contribs[bestIdx].color };
    }
    const enabled = layers.filter((l) => l.enabled);
    const avgContrib = enabled
      .map((l) => ({
        id: l.id,
        name: catalogById[l.id]?.name ?? l.id,
        color: catalogById[l.id]?.color ?? '#666',
        pts: (contribSum[l.id] ?? 0) / (grid.cells.length || 1),
      }))
      .sort((a, b) => b.pts - a.pts);

    // top 10 cells
    const ranked = grid.cells
      .map((c, i) => ({ id: c.id, score: arr[i] }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // data coverage per working layer
    const coverage = layers.map((l) => {
      let count = 0;
      const ls = scores[l.id];
      if (ls) for (const c of grid.cells) if (ls[c.id] != null) count++;
      return { id: l.id, name: catalogById[l.id]?.name ?? l.id, color: catalogById[l.id]?.color ?? '#666', count };
    });

    return { mean, max, maxId, n, bins, lo, hi, rampDomain, avgContrib, topDriver, ranked, coverage };
  }, [grid, layers, scores, catalogById, relative]);

  if (view !== 'dashboard' || !grid || !stats) return null;

  const presetName = activePreset ? PRESETS.find((p) => p.id === activePreset)?.name ?? 'Custom' : 'Custom weights';
  const enabledCount = layers.filter((l) => l.enabled).length;
  const nCells = grid.cells.length;
  const frozen = valid ? '' : ' frozen';
  const pct = (v: number) => `${fmtScore1(v)}%`;

  // histogram geometry
  const HB_W = 380, HB_H = 132, AXIS = 18;
  const binMax = Math.max(1, ...stats.bins);
  const bw = HB_W / stats.bins.length;
  const [dLo, dHi] = stats.rampDomain;
  const rampT = (v: number) => (dHi > dLo ? Math.max(0, Math.min(1, (v - dLo) / (dHi - dLo))) : v);

  const maxAvg = Math.max(0.0001, ...stats.avgContrib.map((a) => a.pts));
  const sumAvg = stats.avgContrib.reduce((a, c) => a + c.pts, 0);

  return (
    <div className="dashboard" role="region" aria-label="Portfolio overview">
      <div className="dash-inner">
        <header className="dash-head">
          <div>
            <div className="overline">Vantage · {nCells}-cell grid</div>
            <h1 className="dash-title">Portfolio overview</h1>
          </div>
          <div className="dash-meta tnum">
            <span className="dash-meta-item">Preset <b>{presetName}</b></span>
            <span className={`dash-meta-item ${valid ? 'ok' : 'bad'}`}>
              Σ weights <b>{fmtWeight(total)}</b> {valid ? '· balanced' : '· must equal 100'}
            </span>
          </div>
        </header>

        <div className="dash-grid">
          {/* 1 — suitability distribution */}
          <section className={`dash-card glass${frozen}`}>
            <div className="overline">Suitability distribution</div>
            <div className="dash-card-sub">Weighted score of all {nCells} cells</div>
            <div className="dash-chart">
              {valid ? (
                <svg width="100%" viewBox={`0 0 ${HB_W} ${HB_H + AXIS}`} role="img"
                  aria-label={`Histogram of weighted suitability scores, ${stats.n} cells`}>
                  {stats.bins.map((b, i) => {
                    const h = (b / binMax) * (HB_H - 6);
                    const mid = stats.lo + ((i + 0.5) / stats.bins.length) * (stats.hi - stats.lo);
                    return (
                      <rect key={i}
                        x={i * bw + 1} y={HB_H - h} width={bw - 2} height={Math.max(h, b > 0 ? 2 : 0)}
                        rx={2} fill={rampColor(rampT(mid), cvd)}>
                        <title>{`${(stats.lo + (i / stats.bins.length) * (stats.hi - stats.lo)) * 100 | 0}–${(stats.lo + ((i + 1) / stats.bins.length) * (stats.hi - stats.lo)) * 100 | 0}%: ${b} cells`}</title>
                      </rect>
                    );
                  })}
                  <line x1={0} y1={HB_H} x2={HB_W} y2={HB_H} stroke="var(--chart-grid)" strokeWidth={1} />
                  {[0, 0.5, 1].map((t) => (
                    <text key={t} x={t * HB_W} y={HB_H + 13} fontSize={9.5} fill="var(--ink-3)"
                      textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} className="tnum">
                      {Math.round((stats.lo + t * (stats.hi - stats.lo)) * 100)}%
                    </text>
                  ))}
                </svg>
              ) : (
                <div className="dash-frozen-msg">—</div>
              )}
            </div>
            <div className="dash-foot tnum">
              mean <b>{valid ? pct(stats.mean) : '—'}</b> · peak <b>{valid ? pct(stats.max) : '—'}</b>
            </div>
          </section>

          {/* 2 — average contribution by layer */}
          <section className={`dash-card glass${frozen}`}>
            <div className="overline">Average contribution by layer</div>
            <div className="dash-card-sub">Mean points each layer adds to a cell score</div>
            <div className="dash-chart dash-bars">
              {stats.avgContrib.map((a) => (
                <div key={a.id} className="db-row" title={`${a.name}: ${a.pts.toFixed(2)} pts average`}>
                  <span className="db-name">{a.name}</span>
                  <span className="db-track">
                    <span className="db-fill" style={{ width: valid ? `${(a.pts / maxAvg) * 100}%` : 0, background: a.color }} />
                  </span>
                  <span className="db-val tnum">{valid ? fmtPts(a.pts) : '—'}</span>
                </div>
              ))}
            </div>
            <div className="dash-foot tnum">
              Σ <b>{valid ? sumAvg.toFixed(1) : '—'}</b> pts ≈ mean score {valid ? pct(stats.mean) : '—'}
            </div>
          </section>

          {/* 3 — top 10 sites */}
          <section className={`dash-card glass${frozen}`}>
            <div className="overline">Top 10 sites</div>
            <div className="dash-card-sub">Click a row to inspect the cell on the map</div>
            <table className="dash-table tnum">
              <thead>
                <tr><th>#</th><th>Cell</th><th className="num">Score</th><th>Top driver</th></tr>
              </thead>
              <tbody>
                {stats.ranked.map((r, i) => {
                  const drv = stats.topDriver?.[r.id];
                  return (
                    <tr key={r.id} className="dash-row" tabIndex={0}
                      onClick={() => { setUi({ view: 'explorer' }); selectCell(r.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setUi({ view: 'explorer' }); selectCell(r.id); } }}>
                      <td className="rank">{i + 1}</td>
                      <td>{r.id.toUpperCase()}</td>
                      <td className="num"><b>{valid ? pct(r.score) : '—'}</b></td>
                      <td>
                        {drv && <><span className="dot sm" style={{ background: drv.color }} />{drv.name}</>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* 4 — grid profile (radar reused as-is: shows grid average) */}
          <section className="dash-card glass">
            <div className="overline">Grid profile</div>
            <div className="dash-card-sub">Average raw layer scores, weight-independent</div>
            <div className="dash-radar"><RadarChart /></div>
          </section>

          {/* 5 — data coverage */}
          <section className="dash-card glass">
            <div className="overline">Data coverage</div>
            <div className="dash-card-sub">Cells with data, per layer</div>
            <div className="dash-chart dash-bars">
              {stats.coverage.map((c) => (
                <div key={c.id} className="db-row" title={`${c.name}: ${c.count} of ${nCells} cells have data`}>
                  <span className="db-name">{c.name}</span>
                  <span className="db-track slim">
                    <span className="db-fill" style={{ width: `${(c.count / nCells) * 100}%`, background: c.color }} />
                  </span>
                  <span className="db-val wide tnum">{c.count}/{nCells}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 6 — model summary */}
          <section className={`dash-card glass${frozen}`}>
            <div className="overline">Model summary</div>
            <div className="dash-card-sub">Current weight allocation</div>
            <div className="dash-summary">
              <WeightDonut />
              <div className="dash-stats">
                <div className="ds-stat">
                  <span className="ds-lbl">Enabled layers</span>
                  <span className="ds-val">{enabledCount}</span>
                </div>
                <div className="ds-stat">
                  <span className="ds-lbl">Mean suitability</span>
                  <span className="ds-val">{valid ? pct(stats.mean) : '—'}</span>
                </div>
                <div className="ds-stat">
                  <span className="ds-lbl">Best cell · {stats.maxId ? stats.maxId.toUpperCase() : '—'}</span>
                  <span className="ds-val">{valid ? pct(stats.max) : '—'}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
