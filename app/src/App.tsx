import { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import type { GridData, Scores, LayerDef } from './types';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import RightDock from './components/RightDock';
import Legend from './components/Legend';
import Toolbar from './components/Toolbar';
import ErrorBanner from './components/ErrorBanner';
import StatTiles from './components/StatTiles';
import './App.css';

const base = import.meta.env.BASE_URL;

export default function App() {
  const load = useAppStore((s) => s.load);
  const loaded = useAppStore((s) => s.loaded);
  const panelOpen = useAppStore((s) => s.ui.panelOpen);
  const dockOpen = useAppStore((s) => s.ui.dockOpen);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(base + 'data/grid.json').then((r) => r.json() as Promise<GridData>),
      fetch(base + 'data/scores.json').then((r) => r.json() as Promise<Scores>),
      fetch(base + 'data/catalog.json').then((r) => r.json() as Promise<LayerDef[]>),
    ])
      .then(([grid, scores, catalog]) => load(grid, scores, catalog))
      .catch((e) => setErr(String(e)));
  }, [load]);

  return (
    <div className={`app-root ${panelOpen ? '' : 'panel-closed'} ${dockOpen ? 'dock-open' : 'dock-closed'}`}>
      <MapView />
      {loaded && (
        <>
          <div className="brand glass">
            <div className="brand-mark" />
            <div>
              <div className="brand-title">LAND USABILITY EXPLORER</div>
              <div className="brand-sub">Vadodara Region · 500-cell analysis grid</div>
            </div>
          </div>
          <div className="topbar">
            <Toolbar />
          </div>
          <ErrorBanner />
          {panelOpen && <ControlPanel />}
          <StatTiles />
          <RightDock />
          <Legend />
        </>
      )}
      {err && <div className="fatal">Failed to load data: {err}</div>}
      {!loaded && !err && <div className="booting"><div className="spinner" />Initializing grid…</div>}
    </div>
  );
}
