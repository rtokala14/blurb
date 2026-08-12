import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { UpdatePrompt } from '@/components/update-prompt'

export interface RouterContext {
  queryClient: QueryClient
}

// Dev-only: the dynamic import sits behind a statically false condition in
// production, so the bundler drops it entirely.
const Devtools = import.meta.env.DEV ? lazy(() => import('@/components/devtools')) : () => null

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => <p className="p-8 text-muted-foreground">That page does not exist.</p>,
})

function RootLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3 text-sm">
          <span className="font-medium">bun-stack</span>
          <Link
            to="/"
            className="text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
          >
            Overview
          </Link>
          <Link
            to="/todos"
            className="text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
          >
            Todos
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Outlet />
      </main>

      <UpdatePrompt />

      <Suspense>
        <Devtools />
      </Suspense>
    </div>
  )
}
