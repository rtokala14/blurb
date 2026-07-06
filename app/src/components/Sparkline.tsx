export default function Sparkline({ bins, color }: { bins: number[]; color: string }) {
  const max = Math.max(1, ...bins);
  const W = 96, H = 22, n = bins.length;
  const bw = W / n;
  return (
    <svg width={W} height={H} className="sparkline" aria-hidden>
      {bins.map((b, i) => {
        const h = (b / max) * (H - 2);
        return (
          <rect
            key={i}
            x={i * bw + 0.6}
            y={H - h}
            width={bw - 1.2}
            height={h}
            rx={1}
            fill={color}
            opacity={0.32 + 0.55 * (b / max)}
          />
        );
      })}
    </svg>
  );
}
