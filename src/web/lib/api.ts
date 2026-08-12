import { treaty } from '@elysiajs/eden'
import type { Api } from '@server/app'

/**
 * The typed RPC client.
 *
 * `Api` is a type-only import of the Elysia instance, so this costs nothing at
 * runtime — the bundle contains Eden's small fetch wrapper and nothing else —
 * while every path, parameter and response body is checked against the server
 * at compile time. Rename a route or change a field and this file fails to
 * build before anything ships.
 */
const client = treaty<Api>(typeof window === 'undefined' ? 'localhost' : window.location.origin)

export const api = client.api

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface EdenResult<T> {
  data: T | null
  error: { status: number; value: unknown } | null
}

function messageOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message: unknown }).message)
  }
  return 'Request failed'
}

/**
 * Eden returns `{ data, error }` rather than throwing. React Query wants a
 * rejected promise, so every call goes through here.
 */
export async function unwrap<T>(request: Promise<EdenResult<T>>): Promise<T> {
  const { data, error } = await request
  if (error) throw new ApiError(error.status, messageOf(error.value))
  return data as T
}
