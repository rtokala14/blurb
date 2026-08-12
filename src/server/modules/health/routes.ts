import { Elysia, t } from 'elysia'

const startedAt = Date.now()

export interface HealthDependencies {
  /** Resolves false when a dependency the process needs is unreachable. */
  checkReadiness: () => Promise<boolean>
}

/**
 * Two probes, because they answer different questions:
 *   /health        is the process alive?      (never touches the database)
 *   /health/ready  can it serve traffic?      (checks dependencies)
 * Point the container's liveness probe at the first and readiness at the second.
 */
export const healthRoutes = ({ checkReadiness }: HealthDependencies) =>
  new Elysia({ prefix: '/health', name: 'health' })
    .get('/', () => ({ status: 'ok' as const, uptimeMs: Date.now() - startedAt }), {
      response: t.Object({ status: t.Literal('ok'), uptimeMs: t.Integer() }),
    })
    .get(
      '/ready',
      async ({ set }) => {
        const ready = await checkReadiness()
        if (!ready) set.status = 503
        return { ready }
      },
      {
        response: { 200: t.Object({ ready: t.Boolean() }), 503: t.Object({ ready: t.Boolean() }) },
      },
    )
