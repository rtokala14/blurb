import { useAppStore } from '../store/useAppStore';
import { contributions, isValid } from '../lib/score';
import { fmtScore1, fmtPts, fmtWeight } from '../lib/format';

export default function CellInspector() {
  const selected = useAppStore((s) => s.selectedCell);
  const layers = useAppStore((s) => s.layers);
  const catalogById = useAppStore((s) => s.catalogById);
  const scores = useAppStore((s) => s.scores);
  const selectCell = useAppStore((s) => s.selectCell);

  if (!selected) return null;
  const { contribs, total, partial } = contributions(selected, layers, catalogById, scores);
  const valid = isValid(layers);
  const sorted = [...contribs].sort((a, b) => b.contribution - a.contribution);
  const maxContrib = Math.max(0.0001, ...sorted.map((c) => c.contribution));

  return (
    <div className="ci-body">
      <div className="ci-head">
        <div>
          <div className="overline">Cell {selected.toUpperCase()}</div>
          <div className="ci-title">Suitability breakdown</div>
        </div>
        <button className="ci-close" onClick={() => selectCell(null)} title="Deselect">✕</button>
      </div>

      <div className="ci-score">
        <div className={`ci-score-val tnum ${valid ? '' : 'muted'}`}>{valid ? fmtScore1(total / 100) : '—'}</div>
        <div className="ci-score-meta">
          <div className="ci-score-unit">/ 100 suitability</div>
          {partial && <div className="ci-partial">partial data · re-normalized</div>}
          {!valid && <div className="ci-partial bad">frozen · weights ≠ 100</div>}
        </div>
      </div>

      <div className="overline ci-contrib-lbl">Contributions</div>
      <div className="ci-bars">
        {sorted.map((c) => {
          const w = (c.contribution / maxContrib) * 100;
          return (
            <div key={c.id} className={`ci-bar-row ${c.score == null ? 'null' : ''}`}>
              <div className="ci-bar-head">
                <span className="dot" style={{ background: c.color }} />
                <span className="ci-bar-name">{c.name}</span>
                <span className="ci-bar-pts tnum">{c.score == null ? 'n/a' : fmtPts(c.contribution)}</span>
              </div>
              <div className="ci-bar-track">
                <div className="ci-bar-fill" style={{ width: `${w}%`, background: c.color }} />
              </div>
              <div className="ci-bar-sub tnum">
                w {fmtWeight(c.weight)} × s {c.score == null ? '—' : c.score.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ci-foot tnum">
        Σ contributions = <b>{valid ? total.toFixed(1) : '—'}</b>{valid ? ' = cell score' : ''}
      </div>
    </div>
  );
}
