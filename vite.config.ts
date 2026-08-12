import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './scripts/sw-plugin.ts'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // The SPA is a self-contained root; server code never goes through Vite.
  root: 'src/web',
  envDir: r('.'),
  plugins: [
    // Must run before the React plugin: it generates the route tree that the
    // React plugin then transforms.
    tanstackRouter({
      target: 'react',
      routesDirectory: r('./src/web/routes'),
      generatedRouteTree: r('./src/web/routeTree.gen.ts'),
      // Splits each route's component into its own chunk while keeping loaders
      // in the main graph, so hover-prefetch stays a single small request.
      autoCodeSplitting: true,
    }),
    react(),
    // React Compiler: auto-memoises components, so app code needs no
    // useMemo/useCallback to avoid re-render cascades. Build-time only.
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // Emits dist/client/sw.js with a precache manifest taken from the build.
    serviceWorker({ source: r('./src/web/sw.ts') }),
  ],
  resolve: {
    alias: {
      '@': r('./src/web'),
      '@server': r('./src/server'),
      '@shared': r('./src/shared'),
    },
  },
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    // Bun and evergreen browsers only — no legacy transpile tax.
    target: 'es2022',
    sourcemap: 'hidden',
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Keep rarely-changing vendor code in its own long-lived chunk so an
        // app deploy does not invalidate it in browser caches. Routes are split
        // automatically by the router plugin.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin in dev, exactly like production.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: false,
      },
    },
  },
})
