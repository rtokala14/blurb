import { useAppStore } from '../store/useAppStore';
import { totalWeight, isValid } from '../lib/score';
import { fmtWeight } from '../lib/format';

const R = 52;
const STROKE = 13;
const C = 2 * Math.PI * R;

export default function WeightDonut() {
  const layers = useAppStore((s) => s.layers);
  const catalogById = useAppStore((s) => s.catalogById);
  const enabled = layers.filter((l) => l.enabled);
  const total = totalWeight(layers);
  const valid = isValid(layers);

  // segments scaled against max(total, 100) so an over-100 total visibly overflows
  const scale = Math.max(total, 100);
  let offset = 0;
  const segs = enabled.map((l) => {
    const frac = scale > 0 ? l.weight / scale : 0;
    const len = frac * C;
    const seg = { color: catalogById[l.id]?.color ?? '#666', dash: len, gap: C - len, off: -offset };
    offset += len;
    return seg;
  });
  // remaining gap to 100 (when under 100)
  const remainingFrac = total < 100 ? (100 - total) / scale : 0;

  return (
    <div className="donut-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--wheel-track)" strokeWidth={STROKE} />
        {/* deficit arc (pulsing red) when under 100 */}
        {remainingFrac > 0 && (
          <circle
            cx="64" cy="64" r={R} fill="none"
            stroke={valid ? 'transparent' : 'var(--bad)'}
            strokeWidth={STROKE}
            strokeDasharray={`${remainingFrac * C} ${C - remainingFrac * C}`}
            strokeDashoffset={-total / scale * C}
            transform="rotate(-90 64 64)"
            className="donut-deficit"
            opacity={0.55}
          />
        )}
        {segs.map((s, i) => (
          <circle
            key={i} cx="64" cy="64" r={R} fill="none"
            stroke={s.color} strokeWidth={STROKE}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={s.off}
            transform="rotate(-90 64 64)"
            style={{ transition: 'stroke-dasharray 220ms ease-out, stroke-dashoffset 220ms ease-out' }}
          />
        ))}
      </svg>
      <div className="donut-center">
        <div className={`donut-total tnum ${valid ? 'ok' : 'bad'}`}>{fmtWeight(total)}</div>
        <div className="donut-label">{valid ? '✓ balanced' : 'Σ ≠ 100'}</div>
      </div>
    </div>
  );
}
