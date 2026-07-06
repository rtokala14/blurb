import { useAppStore } from '../store/useAppStore';

export default function Legend() {
  const cvd = useAppStore((s) => s.ui.cvdSafeRamp);
  const gradient = cvd
    ? 'linear-gradient(90deg, #0d366b, #2f6fc0, #cde2fb)'
    : 'linear-gradient(90deg, #d03b3b, #fab219, #0ca30c)';
  return (
    <div className="legend glass">
      <div className="overline">Usability score</div>
      <div className="legend-bar" style={{ background: gradient }} />
      <div className="legend-scale tnum">
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
      <div className="legend-ends">
        <span>{cvd ? 'Low suitability' : 'Avoid'}</span>
        <span>{cvd ? 'High suitability' : 'Prime'}</span>
      </div>
    </div>
  );
}
