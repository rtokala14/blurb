import { useAppStore } from '../store/useAppStore';
import RadarChart from './RadarChart';
import CellInspector from './CellInspector';

// Collapsible right-side panel: layer-profile radar always on top, full
// cell breakdown below when a cell is selected.
export default function RightDock() {
  const open = useAppStore((s) => s.ui.dockOpen);
  const setUi = useAppStore((s) => s.setUi);
  const selected = useAppStore((s) => s.selectedCell);

  if (!open) {
    return (
      <button className="dock-tab glass" onClick={() => setUi({ dockOpen: true })} title="Open analysis panel">
        ❮
      </button>
    );
  }

  return (
    <div className="right-dock glass">
      <div className="dock-head">
        <div>
          <div className="overline">Layer profile</div>
        </div>
        <button className="dock-collapse" onClick={() => setUi({ dockOpen: false })} title="Collapse panel">
          ❯
        </button>
      </div>
      <RadarChart />
      <div className="dock-scroll">
        {selected ? (
          <CellInspector />
        ) : (
          <div className="dock-hint">
            Hover cells to compare their profile against the grid average.
            Click a cell for its full usability breakdown.
          </div>
        )}
      </div>
    </div>
  );
}
