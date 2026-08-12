import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/**
 * Compiles the service worker and injects a precache manifest built from what
 * the build actually emitted — bundled chunks *and* files copied from the
 * public directory, so the manifest and icons work offline too.
 *
 * The worker is compiled with Bun rather than being part of the app's module
 * graph: it has to land at a stable, unhashed URL at the root for its scope to
 * cover the whole app.
 */

/** Safe to keep in a versioned cache: content-hashed assets and the shell. */
const PRECACHEABLE = /\.(js|css|woff2?|svg|png|webmanifest|html)$/
const NEVER_PRECACHE = /(\.map$)|(^sw\.js$)/

export interface ServiceWorkerOptions {
  /** Source entry, e.g. `src/web/sw.ts`. */
  source: string
  /** Emitted filename, relative to the build output directory. */
  fileName?: string
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

export function serviceWorker({ source, fileName = 'sw.js' }: ServiceWorkerOptions): Plugin {
  let config: ResolvedConfig

  return {
    name: 'bun-stack:service-worker',
    apply: 'build',

    configResolved(resolved) {
      config = resolved
    },

    // closeBundle, not writeBundle: public assets are copied after the bundle
    // is written, and they belong in the precache list.
    async closeBundle() {
      const outDir = config.build.outDir

      const precache: string[] = []
      for await (const path of walk(outDir)) {
        const name = relative(outDir, path).split(sep).join('/')
        if (PRECACHEABLE.test(name) && !NEVER_PRECACHE.test(name)) precache.push(`/${name}`)
      }
      precache.sort()

      // Version derives from the precached file list, so a rebuild that changes
      // nothing produces an identical worker and clients are left alone.
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)

      const built = await Bun.build({
        entrypoints: [source],
        target: 'browser',
        // A classic worker, not a module: module service workers are still not
        // universally supported, and this file has no imports to justify one.
        format: 'iife',
        minify: true,
        define: {
          'self.__SW_VERSION__': JSON.stringify(version),
          'self.__SW_PRECACHE__': JSON.stringify(precache),
        },
      })

      if (!built.success) this.error(`service worker build failed:\n${built.logs.join('\n')}`)

      const [output] = built.outputs
      if (!output) {
        this.error('service worker build produced no output')
        return
      }

      await Bun.write(join(outDir, fileName), await output.text())
      console.log(`${fileName} — precaching ${precache.length} files (${version})`)
    },
  }
}
