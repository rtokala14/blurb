import { createRouter } from '@tanstack/react-router'
import { createQueryClient } from '@/lib/query'
import { routeTree } from './routeTree.gen'

export function createAppRouter() {
  const queryClient = createQueryClient()

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Start loading on hover/touch-start instead of on click.
    defaultPreload: 'intent',
    // Preloading should not second-guess the query cache; React Query owns
    // freshness, the router just triggers the loader.
    defaultPreloadStaleTime: 0,
    // Only show a pending UI if the wait is long enough to notice, which stops
    // fast navigations from flashing a skeleton.
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    scrollRestoration: true,
  })

  return { router, queryClient }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>['router']
  }
}
