import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { TodoComposer } from '@/components/todo-composer'
import { TodoList } from '@/components/todo-list'
import { Skeleton } from '@/components/ui/skeleton'
import { todosQuery } from '@/lib/todos'

/**
 * The data-loading pattern this template standardises on:
 *
 *  1. the loader calls `ensureQueryData`, so the request starts the moment the
 *     link is hovered (defaultPreload: 'intent') rather than after the
 *     component mounts — no request waterfall;
 *  2. the component reads the same `queryOptions` with `useSuspenseQuery`, so
 *     it renders from cache with no loading branch and no `data` narrowing;
 *  3. mutations invalidate through the same key factory.
 */
export const Route = createFileRoute('/todos')({
  loader: ({ context }) => context.queryClient.ensureQueryData(todosQuery()),
  component: TodosPage,
  pendingComponent: TodosPending,
})

function TodosPage() {
  const { data } = useSuspenseQuery(todosQuery())

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Todos</h1>
        <p className="text-sm text-muted-foreground">
          Keyset paginated, optimistically updated, validated by the same schema on both ends.
        </p>
      </div>

      <TodoComposer />
      <TodoList items={data.items} />
    </div>
  )
}

function TodosPending() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
