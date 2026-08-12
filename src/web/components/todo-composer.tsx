import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateTodo } from '@/lib/todos'

export function TodoComposer() {
  const [title, setTitle] = useState('')
  const create = useCreateTodo()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    // Clear immediately; onError below puts the text back if the server refuses.
    setTitle('')
    create.mutate(trimmed, { onError: () => setTitle(trimmed) })
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What needs doing?"
        maxLength={200}
        aria-label="Todo title"
      />
      <Button type="submit" disabled={!title.trim() || create.isPending}>
        Add
      </Button>
    </form>
  )
}
