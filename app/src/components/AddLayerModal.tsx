import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { LayerDef } from '../types';
import {
  parseUpload, columnValues, valueRange, normalizeValues, joinToGrid,
  computeHistogram, nextCustomId, pickColor, layerNameFromFile,
  MAX_UPLOAD_BYTES, type UploadFeature,
} from '../lib/upload';

// Fixed categorical layer palette (assignment order — see PLAN §7).
const PALETTE = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

interface Parsed {
  fileName: string;
  features: UploadFeature[];
  numericColumns: string[];
}

// Modal picker for adding catalog layers to the working set, plus an
// "Upload GeoJSON" section that turns a Polygon/MultiPolygon collection
// into a fully working custom layer.
export default function AddLayerModal() {
  const open = useAppStore((s) => s.ui.addLayerOpen);
  const catalog = useAppStore((s) => s.catalog);
  const layers = useAppStore((s) => s.layers);
  const grid = useAppStore((s) => s.grid);
  const addLayer = useAppStore((s) => s.addLayer);
  const addCustomLayer = useAppStore((s) => s.addCustomLayer);
  const setUi = useAppStore((s) => s.setUi);
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [column, setColumn] = useState<string>('');
  const [invert, setInvert] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);

  useEffect(() => {
    if (open) (firstRef.current ?? closeRef.current)?.focus();
    if (!open) {
      // reset the upload flow whenever the modal closes
      setParsed(null); setColumn(''); setInvert(false);
      setUploadErr(null); setJoinNote(null);
      if (closeTimer.current != null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    }
  }, [open]);
  useEffect(() => () => { if (closeTimer.current != null) window.clearTimeout(closeTimer.current); }, []);

  if (!open) return null;
  const inSet = new Set(layers.map((l) => l.id));
  const available = catalog.filter((c) => !inSet.has(c.id));
  const close = () => setUi({ addLayerOpen: false });

  const onFile = (file: File | undefined) => {
    setParsed(null); setColumn(''); setInvert(false); setUploadErr(null); setJoinNote(null);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadErr(`File is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB.`);
      return;
    }
    file.text().then((text) => {
      const res = parseUpload(text);
      if (!res.ok) { setUploadErr(res.error); return; }
      if (res.numericColumns.length === 0) {
        setUploadErr('No numeric property columns found (a column needs ≥80% numeric values).');
        return;
      }
      setParsed({ fileName: file.name, features: res.features, numericColumns: res.numericColumns });
      setColumn(res.numericColumns[0]);
    }).catch(() => setUploadErr('Could not read that file — try exporting it again.'));
  };

  const doAdd = () => {
    if (!parsed || !column || !grid) return;
    const raw = columnValues(parsed.features, column);
    const normalized = normalizeValues(raw, invert);
    const join = joinToGrid(grid.cells, parsed.features, normalized);
    const id = nextCustomId(catalog.map((c) => c.id));
    const def: LayerDef = {
      id,
      name: layerNameFromFile(parsed.fileName),
      description: `Uploaded from ${parsed.fileName}, column ${column}, min–max normalized${invert ? ', inverted' : ''}`,
      icon: 'upload',
      color: pickColor(PALETTE, catalog.map((c) => c.color), catalog.length),
      defaultWeight: 0,
      sourceFile: parsed.fileName,
      field: column,
      kind: 'village',
      allZero: false,
      defaultEnabled: false,
      histogram: computeHistogram(join.cellScores),
    };
    addCustomLayer(def, join.cellScores);
    setJoinNote(`Layer "${def.name}" added — matched ${join.matched}/${grid.cells.length} grid cells` +
      (join.byNearest > 0 ? ` (${join.byNearest} via nearest-feature fallback)` : '') + '.');
    // leave the join-quality note on screen briefly, then close
    closeTimer.current = window.setTimeout(close, 1800);
  };

  const range = parsed && column ? valueRange(columnValues(parsed.features, column)) : null;

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
        <div className="modal-scroll">
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

          <div className="upload-sec">
            <div className="overline">Upload GeoJSON</div>
            <p className="upload-hint">
              Polygon / MultiPolygon FeatureCollection, ≤10 MB, ≤5,000 features.
              Pick a numeric column; it is min–max normalized and joined to the 500-cell grid.
            </p>
            <input
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className="upload-input"
              aria-label="Upload a GeoJSON file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {uploadErr && <div className="upload-err" role="alert">{uploadErr}</div>}
            {parsed && !joinNote && (
              <>
                <div className="upload-row">
                  <label className="upload-lbl" htmlFor="upload-col">Column</label>
                  <select
                    id="upload-col"
                    className="upload-select"
                    value={column}
                    onChange={(e) => setColumn(e.target.value)}
                  >
                    {parsed.numericColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label className="upload-invert">
                    <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
                    invert (lower is better)
                  </label>
                </div>
                {range && (
                  <div className="upload-preview tnum">
                    {parsed.features.length.toLocaleString()} features · range {range.min.toLocaleString(undefined, { maximumFractionDigits: 1 })} – {range.max.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    {range.count < parsed.features.length ? ` · ${parsed.features.length - range.count} without a value` : ''}
                  </div>
                )}
                <button className="upload-add" onClick={doAdd}>Add layer</button>
              </>
            )}
            {joinNote && <div className="upload-note" role="status">✓ {joinNote}</div>}
          </div>
        </div>
        <div className="modal-foot">
          New layers start at weight 0 — raise their slider, then re-balance so the total is 100.
        </div>
      </div>
    </div>
  );
}
