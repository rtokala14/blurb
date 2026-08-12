#!/usr/bin/env bun
/**
 * Runs the API and the Vite dev server together, so `bun dev` is one command
 * and one Ctrl-C. Deliberately dependency-free.
 */
const processes = [
  Bun.spawn(['bun', '--watch', 'src/server/index.ts'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
  }),
  Bun.spawn(['bun', 'x', 'vite'], { stdio: ['inherit', 'inherit', 'inherit'] }),
]

const shutdown = () => {
  for (const child of processes) child.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// If either side dies, take the other down rather than leaving half a stack up.
await Promise.race(processes.map((child) => child.exited))
shutdown()
