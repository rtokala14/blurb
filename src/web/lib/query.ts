import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Route loaders prime the cache; this keeps a navigation back to a
        // recently visited route from refetching immediately.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // Retrying a 4xx just burns a round trip — the answer will not change.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: false,
        // Preserve object identity across refetches so React Compiler's
        // memoisation actually holds and lists do not re-render on poll.
        structuralSharing: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
