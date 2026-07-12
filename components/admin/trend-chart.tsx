"use client"

import * as React from "react"

/**
 * Activity trend chart: three categorical series (turns, sessions,
 * documents) over the selected window. Built to the dataviz method:
 * 2px lines, hairline solid grid, 8px hover markers with a 2px surface
 * ring, legend, crosshair tooltip, and a table view alongside
 * (the relief for the light-mode contrast WARN). Palette slots validated for both surfaces.
 */

export interface TrendPoint {
  date: string
  sessions: number
  turns: number
  documents: number
  uniqueUsers: number
}

const SERIES = [
  { key: "turns" as const, label: "Turns", light: "#2a78d6", dark: "#3987e5" },
  { key: "sessions" as const, label: "Sessions", light: "#1baf7a", dark: "#199e70" },
  { key: "documents" as const, label: "Uploads", light: "#eda100", dark: "#c98500" },
]

const W = 720
const H = 220
const PAD = { top: 12, right: 56, bottom: 24, left: 40 }

function niceMax(value: number): number {
  if (value <= 5) return 5
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const [dark, setDark] = React.useState(false)

  React.useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const max = niceMax(
    Math.max(1, ...points.flatMap((p) => [p.sessions, p.turns, p.documents]))
  )
  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH

  const pathFor = (key: (typeof SERIES)[number]["key"]) =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join(" ")

  const gridSteps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f))
  const tickIdx = points.length <= 8
    ? points.map((_, i) => i)
    : [0, Math.floor(points.length / 2), points.length - 1]

  const surface = dark ? "#1a1a19" : "#fcfcfb"
  const gridColor = dark ? "#2c2c2a" : "#ececea"
  const textMuted = dark ? "#8a897f" : "#7a7975"
  const textPrimary = dark ? "#e8e7e0" : "#2b2a27"

  const hovered = hover !== null ? points[hover] : null

  return (
    <div className="relative">
      {/* legend — always present for ≥2 series */}
      <div className="mb-2 flex items-center gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs" style={{ color: textPrimary }}>
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: dark ? s.dark : s.light }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Daily activity: turns, sessions and documents"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}
      >
        {/* hairline grid + y ticks */}
        {gridSteps.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={gridColor}
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={textMuted}>
              {v.toLocaleString()}
            </text>
          </g>
        ))}
        {/* x ticks */}
        {tickIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize={10}
            fill={textMuted}
          >
            {points[i]?.date.slice(5)}
          </text>
        ))}
        {/* crosshair */}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke={textMuted}
            strokeWidth={1}
          />
        )}
        {/* series lines */}
        {SERIES.map((s) => (
          <path
            key={s.key}
            d={pathFor(s.key)}
            fill="none"
            stroke={dark ? s.dark : s.light}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* hover markers with surface ring */}
        {hovered !== null &&
          SERIES.map((s) => (
            <circle
              key={s.key}
              cx={x(hover!)}
              cy={y(hovered[s.key])}
              r={4}
              fill={dark ? s.dark : s.light}
              stroke={surface}
              strokeWidth={2}
            />
          ))}
      </svg>
      {/* tooltip */}
      {hovered !== null && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(x(hover!) / W) * 100}%`,
            top: 24,
            transform: x(hover!) > W * 0.7 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <p className="font-medium">{hovered.date}</p>
          {SERIES.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: dark ? s.dark : s.light }}
              />
              {s.label}: {hovered[s.key].toLocaleString()}
            </p>
          ))}
          <p className="text-muted-foreground">
            {hovered.uniqueUsers} active {hovered.uniqueUsers === 1 ? "user" : "users"}
          </p>
        </div>
      )}
    </div>
  )
}
