import type { Todo } from '@server/modules/todos/model'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDeleteTodo, useToggleTodo } from '@/lib/todos'

/**
 * No useMemo/useCallback anywhere in this file on purpose: the React Compiler
 * inserts memoisation during the build, and hand-written hooks would only
 * compete with it.
 */
export function TodoList({ items }: { items: Todo[] }) {
  const toggle = useToggleTodo()
  const remove = useDeleteTodo()

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {items.map((todo) => (
        <li key={todo.id} className="flex items-center gap-3 px-4 py-3">
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => toggle.mutate(todo)}
            className="size-4 cursor-pointer accent-primary"
            aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
          />
          <span
            className={
              todo.completed
                ? 'flex-1 text-sm text-muted-foreground line-through'
                : 'flex-1 text-sm'
            }
          >
            {todo.title}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => remove.mutate(todo.id)}
            aria-label={`Delete "${todo.title}"`}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  )
}
