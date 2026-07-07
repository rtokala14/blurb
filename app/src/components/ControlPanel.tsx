import { useAppStore, PRESETS } from '../store/useAppStore';
import { isValid } from '../lib/score';
import { fmtWeight } from '../lib/format';
import WeightDonut from './WeightDonut';
import Sparkline from './Sparkline';

export default function ControlPanel() {
  const layers = useAppStore((s) => s.layers);
  const catalogById = useAppStore((s) => s.catalogById);
  const setWeight = useAppStore((s) => s.setWeight);
  const toggleEnabled = useAppStore((s) => s.toggleEnabled);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const applyPreset = useAppStore((s) => s.applyPreset);
  const setPreview = useAppStore((s) => s.setPreview);
  const autoBalance = useAppStore((s) => s.autoBalance);
  const activePreset = useAppStore((s) => s.activePreset);
  const setUi = useAppStore((s) => s.setUi);

  const valid = isValid(layers);

  return (
    <div className="control-panel glass">
      <div className="cp-head">
        <div>
          <div className="overline">Weight allocation</div>
          <div className="cp-title">Layer model</div>
        </div>
        <button
          className={`chip mini ${valid ? '' : 'warn'}`}
          onClick={autoBalance}
          disabled={valid}
          title="Rescale to sum to 100"
        >
          Auto-balance
        </button>
      </div>

      <div className="cp-donut">
        <WeightDonut />
      </div>

      <div className="cp-presets">
        <div className="overline">Presets</div>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`chip preset ${activePreset === p.id ? 'on' : ''}`}
              onClick={() => applyPreset(p.id)}
              onMouseEnter={() => setPreview(p.weights)}
              onMouseLeave={() => setPreview(null)}
              onFocus={() => setPreview(p.weights)}
              onBlur={() => setPreview(null)}
              title={`Hover to preview, click to apply`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="cp-layers">
        <div className="cp-layers-head">
          <span className="overline">Layers ({layers.length})</span>
          <button className="chip mini" onClick={() => setUi({ addLayerOpen: true })}>+ Add layer</button>
        </div>

        <div className="layer-list">
          {layers.map((l) => {
            const def = catalogById[l.id];
            if (!def) return null;
            return (
              <div key={l.id} className={`layer-card ${l.enabled ? '' : 'off'}`}>
                <div className="lc-row1">
                  <span className="dot" style={{ background: def.color }} />
                  <span className="lc-name" title={def.description}>{def.name}</span>
                  {def.allZero && <span className="pi-flag" title="No data in this extract">no data</span>}
                  <label className="switch" title={l.enabled ? 'Disable' : 'Enable'}>
                    <input
                      type="checkbox"
                      checked={l.enabled}
                      onChange={() => toggleEnabled(l.id)}
                      aria-label={`${l.enabled ? 'Disable' : 'Enable'} ${def.name}`}
                    />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                  </label>
                  <button
                    className="lc-remove"
                    title="Remove layer"
                    aria-label={`Remove ${def.name}`}
                    onClick={() => removeLayer(l.id)}
                  >✕</button>
                </div>
                <div className="lc-row2">
                  <input
                    type="range" min={0} max={100} step={1}
                    value={l.weight}
                    disabled={!l.enabled}
                    onChange={(e) => setWeight(l.id, Number(e.target.value))}
                    className="lc-slider"
                    style={{ accentColor: def.color }}
                    aria-label={`${def.name} weight`}
                  />
                  <input
                    type="number" min={0} max={100}
                    value={l.weight}
                    disabled={!l.enabled}
                    onChange={(e) => setWeight(l.id, Number(e.target.value))}
                    className="lc-num tnum"
                    aria-label={`${def.name} weight`}
                  />
                </div>
                <div className="lc-row3">
                  <Sparkline bins={def.histogram} color={def.color} />
                  <span className="lc-share tnum">{l.enabled ? `${fmtWeight(l.weight)} pts` : 'off'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
