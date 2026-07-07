import { useAppStore } from '../store/useAppStore';
import { totalWeight, isValid } from '../lib/score';
import { fmtWeight } from '../lib/format';

export default function ErrorBanner() {
  const layers = useAppStore((s) => s.layers);
  const autoBalance = useAppStore((s) => s.autoBalance);
  const undo = useAppStore((s) => s.undo);
  const history = useAppStore((s) => s.history);

  const valid = isValid(layers);
  if (valid) return null;

  const total = totalWeight(layers);
  const enabledCount = layers.filter((l) => l.enabled).length;
  const delta = 100 - total;

  const msg =
    enabledCount === 0
      ? 'No layers enabled — enable at least one to compute suitability.'
      : `Weights total ${fmtWeight(total)} — must equal 100. ${
          delta > 0 ? `Add ${fmtWeight(delta)} points` : `Remove ${fmtWeight(-delta)} points`
        } or auto-balance.`;

  return (
    <div className="error-banner">
      <div className="eb-icon">!</div>
      <div className="eb-msg">
        <span className="eb-title">Invalid configuration</span>
        <span className="eb-text">{msg}</span>
      </div>
      <div className="eb-actions">
        {enabledCount > 0 && (
          <button className="eb-btn primary" onClick={autoBalance}>Auto-balance</button>
        )}
        <button className="eb-btn" onClick={undo} disabled={history.length === 0}>Undo</button>
      </div>
    </div>
  );
}
