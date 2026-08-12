import { afterEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Todo } from '../../src/server/modules/todos/model'
import { TodoList } from '../../src/web/components/todo-list'

/**
 * Component tests run on Bun's test runner against happy-dom — no jsdom, no
 * separate vitest config, no second toolchain.
 */

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: 'write the migration',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(cleanup)

describe('<TodoList />', () => {
  it('renders an empty state when there is nothing to show', () => {
    render(<TodoList items={[]} />, { wrapper })
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('renders each todo with an accessible toggle', () => {
    render(<TodoList items={[todo(), todo({ id: 2, title: 'ship it' })]} />, { wrapper })

    expect(screen.getByText('write the migration')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mark "ship it" as complete' })).not.toBeChecked()
  })

  it('reflects completed state in the checkbox and styling', () => {
    render(<TodoList items={[todo({ completed: true })]} />, { wrapper })

    expect(
      screen.getByRole('checkbox', { name: 'Mark "write the migration" as incomplete' }),
    ).toBeChecked()
    expect(screen.getByText('write the migration')).toHaveClass('line-through')
  })
})
