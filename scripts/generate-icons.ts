#!/usr/bin/env bun
/**
 * Rasterises the SVG app icons into the PNG sizes installers require.
 *
 * The PNGs are committed, so this only needs re-running after the artwork
 * changes. Uses headless Chrome rather than an image library — one less
 * dependency, and it renders exactly what the browser would.
 *
 *   CHROME=/path/to/chrome bun run scripts/generate-icons.ts
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const CANDIDATES = [
  process.env.CHROME,
  // Prefer the headless shell: the full browser reserves window chrome, which
  // shows up as a clipped, letterboxed screenshot.
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((path): path is string => Boolean(path))

const chrome = CANDIDATES.find((path) => Bun.file(path).size > 0)
if (!chrome) {
  console.error(`No Chrome found. Set CHROME=/path/to/chrome. Tried:\n  ${CANDIDATES.join('\n  ')}`)
  process.exit(1)
}

const PUBLIC_DIR = 'src/web/public'
const TARGETS = [
  { source: 'icon.svg', out: 'icon-192.png', size: 192 },
  { source: 'icon.svg', out: 'icon-512.png', size: 512 },
  { source: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  // iOS ignores the manifest and masks this itself, so it must be full-bleed.
  { source: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
]

const scratch = join(process.env.TMPDIR ?? '/tmp', `icons-${process.pid}`)

for (const { source, out, size } of TARGETS) {
  const svg = await Bun.file(join(PUBLIC_DIR, source)).text()
  const page = join(scratch, `${out}.html`)

  await Bun.write(
    page,
    `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )

  const proc = Bun.spawn(
    [
      chrome,
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${join(PUBLIC_DIR, out)}`,
      `file://${page}`,
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )

  if ((await proc.exited) !== 0) {
    console.error(`✗ ${out}`)
    process.exit(1)
  }
  console.log(`✓ ${out} (${size}×${size})`)
}

await rm(scratch, { recursive: true, force: true })
