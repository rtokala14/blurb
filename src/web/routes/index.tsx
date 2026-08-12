import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: Overview,
})

const pieces = [
  ['Runtime', 'Bun serves the API and the built SPA from one process, one image.'],
  ['API', 'Elysia + TypeBox. Schemas are the validators and the client types.'],
  ['RPC', 'Eden Treaty lifts the server type into the browser. No codegen step.'],
  ['Data', 'TanStack Router loaders prime a TanStack Query cache the components read.'],
  ['Database', 'Kysely over tedious, pointed at Azure SQL.'],
  ['UI', 'shadcn/ui on Base UI primitives, Tailwind v4, React Compiler.'],
  ['Offline', 'Installable PWA. The shell is precached; the API is never cached.'],
] as const

function Overview() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">bun-stack</h1>
        <p className="text-muted-foreground">
          A performance-first starting point: one runtime, one image, end-to-end types.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {pieces.map(([title, description]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            The todos route shows the loader → cache → optimistic-mutation path end to end.
          </p>
          <Button render={<Link to="/todos" />}>Open todos</Button>
        </CardContent>
      </Card>
    </div>
  )
}
