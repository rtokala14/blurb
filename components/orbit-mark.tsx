import { cn } from "@/lib/utils"

/** The full brand glyph: planet ring + orbit swoosh fused into one filled path. */
const GLYPH_D =
  "m234.4 181.4c7.89 17.69 12.03 30.31 4.54 34.41-6.98 3.84-16.61-0.63-32.64-7.46 21.56-21.56 37.65-49.41 37.65-82.6 0-61.74-47.16-119.3-118.8-119.3-34.47 0-64.52 13.7-85.22 35.68-6.68-11.83-9.89-24.56-4.08-29.35 5.96-4.95 18.66-0.61 29.15 1.95l0.34-0.91c-11.2-5.9-25.8-8.37-31.77-3.88-8.26 6.26-6.83 19.41 0.37 37.73-9.5 11.22-16.6 24.14-21.54 39.1l-0.56 0.76c-5.1 12.3-6.25 25.04-6.25 37.74 0 59.46 48.49 118.2 116.8 118.2 14.88 0 28.49-3.04 45.93-8.31l0.81-0.68c9.1-4.47 18.89-10.66 28.52-19.62-8.98 7.25-18.14 12.54-27.2 16.32l-0.6 0.18c-5.05 2.24-11.94 3.75-15.07 4.21-8.54 2.57-15.89 3.07-27.78 3.07-60.79 0-112-49.83-112-111.8 0-9.79 1.57-19.84 3.57-27.72 3.26-10.1 6.63-18.38 11.36-27.2l0.1-0.13c3.11-4.72 5.83-8.09 9.57-13.05l5.61 9.37 0.22 0.63c16.35 25.05 35.78 49.3 53.39 67.11 1.89-2.73 6.36-3.74 8.83-5.26l0.12-0.91c-21.6-22.7-41.65-45.78-57.6-72.13l-4.05-6.26c21.03-22.7 47.77-35.32 78.65-35.32 63.42 0 113.5 50.14 113.5 112.8 0 29.31-11.74 57.97-33.19 80.15-8.76-4.96-16.87-10.04-20.93-12.83-2.84 2.13-5.32 2.82-10.21 4.14 5.07 3.49 9.13 6.36 13.55 8.75 11.32 5.85 27.67 13.65 41.59 13.65 7.03 0 14.24-3.05 14.84-12.32 0.73-9.42-5.93-21.66-9.53-28.92z"

/** The three sparkle stars (the satellite), in glyph coordinates. */
const STAR_DS = [
  "m148.1 124.2 12.42-5.25c1.7-0.74 2.7-2.19 3.4-4.17l4.55-10.23 0.51 0.01 4.84 12.37c0.5 1.34 1.48 2.39 2.9 2.93l12.07 4.42v0.41l-12.81 5.26c-1.41 0.63-2.46 2.4-3.05 3.93l-4.3 11.04h-0.53l-4.48-12.33c-0.7-1.71-2.02-2.82-3.66-3.5l-11.86-4.46v-0.43z",
  "m106.1 143.1 8.94-3.43c1.23-0.56 1.99-1.96 2.52-3.43l2.48-7.17h0.38l3.35 9.28c0.39 0.99 1.13 1.82 2.22 2.24l7.77 3.19v0.31l-9.08 4.22c-1.03 0.47-1.82 1.81-2.25 2.97l-2.23 6.58h-0.39l-3.35-8.5c-0.52-1.28-1.52-2.11-2.76-2.62l-7.6-3.29v-0.35z",
  "m123.5 186.4 16.23-6.94c2.11-0.94 3.78-2.41 4.64-4.76l6.06-14.55 0.65 0.01 6.88 16.81c0.65 1.68 1.9 2.83 3.68 3.53l16.31 6.6v0.51l-16.72 6.94c-1.78 0.8-3.44 2.36-4.22 4.5l-6.2 14.65h-0.65l-6.41-16.49c-0.92-2.14-2.84-3.32-4.97-4.19l-15.28-6.11v-0.51z",
]

/**
 * Centreline of the orbit swoosh, extended into a full front-side pass:
 * in from the top-left tail, diagonally across the planet's face, out the
 * bottom-right rim, then swinging up to slip behind the planet. Used both
 * for the trail stroke and (inline, below) as the satellite's offset-path.
 */
const ORBIT_PATH_D =
  "M 22 12 C 34 32, 54 64, 80 98 C 102 126, 146 170, 184 202 C 198 214, 212 222, 224 219 C 237 215, 243 203, 240 186"

/**
 * The Orbit wordmark glyph — a planet ring crossed by an orbit swoosh, with
 * a three-sparkle "satellite" cluster riding the line. The static mark is a
 * frozen frame of the orbit. When `animated`, the satellite travels the
 * orbit line while the trail draws behind it, slips behind the planet at
 * the right edge, and re-enters from the top-left. `speed="stream"` is the
 * faster tempo for the live agent-response indicator. Renders in
 * `currentColor` (set `text-primary` etc. on a parent).
 */
export function OrbitMark({
  className,
  animated = false,
  speed = "idle",
  title,
}: {
  className?: string
  animated?: boolean
  speed?: "idle" | "stream"
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 250 250"
      className={cn("orbit-mark", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-animated={animated ? speed : undefined}
    >
      {title ? <title>{title}</title> : null}
      <g className="orbit-static" fill="currentColor">
        <path d={GLYPH_D} />
        {STAR_DS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {animated ? (
        <g className="orbit-anim">
          <circle className="orbit-planet" cx="125" cy="125.5" r="115.5" />
          <path className="orbit-trail" d={ORBIT_PATH_D} pathLength={100} />
          <g
            className="orbit-satellite"
            style={{ offsetPath: `path("${ORBIT_PATH_D}")` }}
          >
            <g className="orbit-satellite-scale">
              {/* A single sparkle rides the orbit, recentred on the local
                  origin and scaled up a touch from its glyph size. */}
              <path
                className="orbit-star"
                fill="currentColor"
                transform="scale(1.2) translate(-150.7 -186.9)"
                d={STAR_DS[2]}
              />
            </g>
          </g>
        </g>
      ) : null}
    </svg>
  )
}
