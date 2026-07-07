import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

// Modal picker for adding catalog layers to the working set.
// Esc closes it (handled globally in App); backdrop click closes too.
export default function AddLayerModal() {
  const open = useAppStore((s) => s.ui.addLayerOpen);
  const catalog = useAppStore((s) => s.catalog);
  const layers = useAppStore((s) => s.layers);
  const addLayer = useAppStore((s) => s.addLayer);
  const setUi = useAppStore((s) => s.setUi);
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) (firstRef.current ?? closeRef.current)?.focus();
  }, [open]);

  if (!open) return null;
  const inSet = new Set(layers.map((l) => l.id));
  const available = catalog.filter((c) => !inSet.has(c.id));
  const close = () => setUi({ addLayerOpen: false });

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal glass"
        role="dialog"
        aria-modal="true"
        aria-label="Add a layer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="overline">Layer catalog</div>
            <div className="modal-title">Add a layer</div>
          </div>
          <button ref={closeRef} className="ci-close" onClick={close} aria-label="Close dialog">✕</button>
        </div>
        {available.length === 0 ? (
          <div className="dock-hint">All catalog layers are already in the model.</div>
        ) : (
          <div className="modal-list">
            {available.map((c, i) => (
              <button
                key={c.id}
                ref={i === 0 ? firstRef : undefined}
                className="modal-item"
                onClick={() => { addLayer(c.id); close(); }}
              >
                <span className="dot" style={{ background: c.color }} />
                <span className="mi-text">
                  <span className="mi-name">
                    {c.name}
                    {c.allZero && <span className="pi-flag" title="Every value is zero in this extract">no data</span>}
                  </span>
                  <span className="mi-desc">{c.description}</span>
                </span>
                <span className="mi-add" aria-hidden="true">+ Add</span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-foot">
          New layers start at weight 0 — raise their slider, then re-balance so the total is 100.
        </div>
      </div>
    </div>
  );
}
