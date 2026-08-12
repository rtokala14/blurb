import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { loadAssets, staticPlugin } from '../../src/server/static'

/**
 * Covers the headers the PWA depends on: an uncached, scope-granting service
 * worker, a correctly typed manifest, immutably cached hashed assets, and a
 * shell that survives a hard refresh on a client-side route.
 */

/** Small app under test: static assets in front, one API route behind them. */
const build = (assets: Awaited<ReturnType<typeof loadAssets>>) =>
  new Elysia().use(staticPlugin(assets, '/api')).get('/api/ping', () => 'pong')

let dir: string
let app: ReturnType<typeof build>

const get = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init))

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'static-'))
  await Bun.write(join(dir, 'index.html'), '<!doctype html><title>shell</title>')
  await Bun.write(join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  await Bun.write(join(dir, 'manifest.webmanifest'), '{"name":"test"}')
  await Bun.write(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  await Bun.write(join(dir, 'icon-192.png'), new Uint8Array([137, 80, 78, 71]))

  app = build(await loadAssets(dir))
})

afterAll(() => rm(dir, { recursive: true, force: true }))

describe('service worker', () => {
  it('is served uncached and allowed to control the whole origin', async () => {
    const response = await get('/sw.js')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('service-worker-allowed')).toBe('/')
    expect(response.headers.get('content-type')).toContain('text/javascript')
  })
})

describe('manifest', () => {
  it('is served with the manifest content type', async () => {
    const response = await get('/manifest.webmanifest')
    expect(response.headers.get('content-type')).toBe('application/manifest+json')
    // Must revalidate, or an install prompt can pin an old name/icon set.
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })
})

describe('hashed assets', () => {
  it('are immutable and compressed', async () => {
    const response = await get('/assets/app-abc123.js', {
      headers: { 'accept-encoding': 'br, gzip' },
    })
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-encoding')).toBe('br')
    expect(response.headers.get('vary')).toBe('Accept-Encoding')
  })

  it('answer 304 when the client already has them', async () => {
    const etag = (await get('/assets/app-abc123.js')).headers.get('etag') as string
    const response = await get('/assets/app-abc123.js', { headers: { 'if-none-match': etag } })
    expect(response.status).toBe(304)
  })
})

describe('SPA fallback', () => {
  it('serves the shell for a client-side route', async () => {
    const response = await get('/todos')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('shell')
  })

  it('does not shadow the API', async () => {
    expect(await (await get('/api/ping')).text()).toBe('pong')
  })

  it('404s a missing file rather than returning the shell', async () => {
    expect((await get('/assets/missing.js')).status).toBe(404)
  })

  it('leaves non-GET requests alone', async () => {
    expect((await get('/todos', { method: 'POST' })).status).toBe(404)
  })
})
