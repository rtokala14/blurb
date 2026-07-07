import { useAppStore, type Basemap } from '../store/useAppStore';

const BASEMAPS: { id: Basemap; label: string; title: string }[] = [
  { id: 'dark', label: 'Dark', title: 'Carto dark-matter basemap' },
  { id: 'light', label: 'Light', title: 'Carto positron basemap' },
  { id: 'satellite', label: 'Sat', title: 'Satellite — Esri world imagery' },
  { id: 'terrain', label: 'Terrain', title: 'Esri world topo' },
];

const OVERLAYS: { id: string; label: string; color: string }[] = [
  { id: 'expressway', label: 'Expressway', color: '#ffd166' },
  { id: 'railway', label: 'Railway', color: '#e8e8e2' },
  { id: 'statehighway', label: 'Highways', color: '#22d3ee' },
  { id: 'river', label: 'River', color: '#2f6fc0' },
];

export default function Toolbar() {
  const overlays = useAppStore((s) => s.overlays);
  const toggleOverlay = useAppStore((s) => s.toggleOverlay);
  const cvd = useAppStore((s) => s.ui.cvdSafeRamp);
  const relative = useAppStore((s) => s.ui.relativeRamp);
  const panelOpen = useAppStore((s) => s.ui.panelOpen);
  const basemap = useAppStore((s) => s.ui.basemap);
  const theme = useAppStore((s) => s.ui.theme);
  const setUi = useAppStore((s) => s.setUi);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div className="toolbar glass">
      <button
        className={`chip ${panelOpen ? 'on' : ''}`}
        onClick={() => setUi({ panelOpen: !panelOpen })}
        title="Toggle control panel"
        aria-label="Toggle control panel"
        aria-pressed={panelOpen}
      >
        ☰ Panel
      </button>
      <span className="tb-sep" />
      <div className="seg" role="group" aria-label="Basemap">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            className={basemap === b.id ? 'on' : ''}
            onClick={() => setBasemap(b.id)}
            title={b.title}
            aria-pressed={basemap === b.id}
          >
            {b.label}
          </button>
        ))}
      </div>
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
        className={`chip ${relative ? 'on' : ''}`}
        onClick={() => setUi({ relativeRamp: !relative })}
        title="Stretch the color ramp across the current score range so spatial contrast is maximized"
      >
        ◧ Contrast
      </button>
      <button
        className={`chip ${cvd ? 'on' : ''}`}
        onClick={() => setUi({ cvdSafeRamp: !cvd })}
        title="Switch to a colorblind-safe blue ramp"
      >
        ◑ CVD-safe
      </button>
      <span className="tb-sep" />
      <button
        className={`chip ${theme === 'light' ? 'on' : ''}`}
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        title="Toggle light / dark interface theme"
        aria-pressed={theme === 'light'}
      >
        ◐ Theme
      </button>
    </div>
  );
}
