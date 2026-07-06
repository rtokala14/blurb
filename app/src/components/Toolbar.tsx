import { useAppStore } from '../store/useAppStore';

const OVERLAYS: { id: string; label: string; color: string }[] = [
  { id: 'expressway', label: 'Expressway', color: '#ffd166' },
  { id: 'railway', label: 'Railway', color: '#e8e8e2' },
  { id: 'statehighway', label: 'State highways', color: '#22d3ee' },
  { id: 'river', label: 'River', color: '#2f6fc0' },
];

export default function Toolbar() {
  const overlays = useAppStore((s) => s.overlays);
  const toggleOverlay = useAppStore((s) => s.toggleOverlay);
  const cvd = useAppStore((s) => s.ui.cvdSafeRamp);
  const panelOpen = useAppStore((s) => s.ui.panelOpen);
  const setUi = useAppStore((s) => s.setUi);

  return (
    <div className="toolbar glass">
      <button
        className={`chip ${panelOpen ? 'on' : ''}`}
        onClick={() => setUi({ panelOpen: !panelOpen })}
        title="Toggle control panel"
      >
        ☰ Panel
      </button>
      <span className="tb-sep" />
      <span className="overline tb-lbl">Overlays</span>
      {OVERLAYS.map((o) => (
        <button
          key={o.id}
          className={`chip ${overlays[o.id] ? 'on' : ''}`}
          onClick={() => toggleOverlay(o.id)}
        >
          <span className="dot" style={{ background: o.color }} />
          {o.label}
        </button>
      ))}
      <span className="tb-sep" />
      <button
        className={`chip ${cvd ? 'on' : ''}`}
        onClick={() => setUi({ cvdSafeRamp: !cvd })}
        title="Colorblind-safe blue ramp"
      >
        ◑ CVD-safe ramp
      </button>
    </div>
  );
}
