import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { Elysia } from 'elysia'

/**
 * Serves the built SPA out of memory.
 *
 * Everything — bytes, ETag, and the Brotli/gzip variants — is computed once at
 * boot, so a request costs a Map lookup and a `new Response`. No disk I/O, no
 * per-request compression, no `stat` syscall.
 */

interface Asset {
  body: Uint8Array
  brotli?: Uint8Array
  gzip?: Uint8Array
  type: string
  etag: string
  cacheControl: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

// Source maps are excluded deliberately: they are large, only ever fetched
// with devtools open, and compressing them at boot dominates start-up time.
const COMPRESSIBLE = /\.(html|js|css|json|svg|txt|webmanifest)$/
/** Above this, compression at boot costs more than it saves. */
const MAX_PRECOMPRESS_BYTES = 2 * 1024 * 1024

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

export async function loadAssets(rootDir: string): Promise<Map<string, Asset>> {
  const startedAt = performance.now()
  const assets = new Map<string, Asset>()

  for await (const path of walk(rootDir)) {
    const body = new Uint8Array(await Bun.file(path).arrayBuffer())
    const url = `/${relative(rootDir, path).split(sep).join('/')}`
    const ext = url.slice(url.lastIndexOf('.'))

    // Vite fingerprints everything under /assets, so those can be cached
    // forever. Anything else (index.html, icons, manifest) must revalidate or
    // a deploy will not reach browsers that already have the old copy.
    const immutable = url.startsWith('/assets/')

    const compressible = COMPRESSIBLE.test(url) && body.byteLength <= MAX_PRECOMPRESS_BYTES
    assets.set(url, {
      body,
      ...(compressible
        ? {
            brotli: brotliCompressSync(body, {
              params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
            }),
            gzip: gzipSync(body, { level: 9 }),
          }
        : {}),
      type: MIME[ext] ?? 'application/octet-stream',
      etag: `"${Bun.hash(body).toString(36)}"`,
      cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
  }

  console.log(
    `[static] prepared ${assets.size} assets in ${Math.round(performance.now() - startedAt)}ms`,
  )
  return assets
}

function respond(asset: Asset, request: Request): Response {
  if (request.headers.get('if-none-match') === asset.etag) {
    return new Response(null, {
      status: 304,
      headers: { etag: asset.etag, 'cache-control': asset.cacheControl },
    })
  }

  const accepted = request.headers.get('accept-encoding') ?? ''
  const [body, encoding] =
    asset.brotli && accepted.includes('br')
      ? [asset.brotli, 'br']
      : asset.gzip && accepted.includes('gzip')
        ? [asset.gzip, 'gzip']
        : [asset.body, undefined]

  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'content-type': asset.type,
    'content-length': String(body.byteLength),
    'cache-control': asset.cacheControl,
    etag: asset.etag,
  }
  if (encoding) {
    headers['content-encoding'] = encoding
    headers.vary = 'Accept-Encoding'
  }

  return new Response(body as BodyInit, { headers })
}

/**
 * Mounts the SPA. Unknown paths fall through to index.html so client-side
 * routing works on a hard refresh; unknown /api paths are left alone.
 */
export const staticPlugin = (assets: Map<string, Asset>, apiPrefix: string) => {
  const index = assets.get('/index.html')

  return new Elysia({ name: 'static' }).onRequest(({ request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return

    const path = new URL(request.url).pathname
    if (path.startsWith(apiPrefix)) return

    const asset = assets.get(path)
    if (asset) return respond(asset, request)

    // SPA fallback — but never for something that looks like a missing file.
    if (index && !path.includes('.')) return respond(index, request)
  })
}
