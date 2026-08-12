import type { Todo, TodoPage } from '@server/modules/todos/model'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './api'

/**
 * One place that knows how todos are fetched and cached.
 *
 * Query keys live in a factory so an invalidation can never drift from the key
 * it is meant to match, and `queryOptions` makes the same definition usable
 * from a route loader (`ensureQueryData`) and a component (`useSuspenseQuery`)
 * with identical types.
 */

export const todoKeys = {
  all: ['todos'] as const,
  list: (filter: TodoFilter) => [...todoKeys.all, 'list', filter] as const,
}

export interface TodoFilter {
  completed?: boolean
  limit?: number
}

export const todosQuery = (filter: TodoFilter = {}) =>
  queryOptions({
    queryKey: todoKeys.list(filter),
    queryFn: () =>
      unwrap(
        api.todos.get({
          query: {
            limit: filter.limit ?? 20,
            ...(filter.completed === undefined ? {} : { completed: filter.completed }),
          },
        }),
      ),
  })

export function useCreateTodo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (title: string) => unwrap(api.todos.post({ title })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.all }),
  })
}

export function useToggleTodo(filter: TodoFilter = {}) {
  const queryClient = useQueryClient()
  const key = todoKeys.list(filter)

  return useMutation({
    mutationFn: (todo: Todo) =>
      unwrap(api.todos({ id: todo.id }).patch({ completed: !todo.completed })),

    // Optimistic update: the checkbox flips on click, not a round trip later.
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<TodoPage>(key)

      queryClient.setQueryData<TodoPage>(
        key,
        (page) =>
          page && {
            ...page,
            items: page.items.map((item) =>
              item.id === todo.id ? { ...item, completed: !item.completed } : item,
            ),
          },
      )

      return { previous }
    },

    onError: (_error, _todo, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useDeleteTodo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => unwrap(api.todos({ id }).delete()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.all }),
  })
}
