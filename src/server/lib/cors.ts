import { Elysia } from 'elysia'

/**
 * Minimal CORS for the deployed shape: the SPA is served by this process, so
 * requests are same-origin and no headers are needed at all. This only exists
 * for the cases that fall outside that — a native client, or a separately
 * hosted preview build — and stays a handful of lines instead of a dependency.
 */
export const cors = (origins: string[]) =>
  new Elysia({ name: 'cors' }).onRequest(({ request, set }) => {
    const origin = request.headers.get('origin')
    if (!origin || !origins.includes(origin)) return

    set.headers['access-control-allow-origin'] = origin
    set.headers['access-control-allow-credentials'] = 'true'
    set.headers.vary = 'Origin'

    if (request.method === 'OPTIONS') {
      set.headers['access-control-allow-methods'] = 'GET,POST,PATCH,DELETE,OPTIONS'
      set.headers['access-control-allow-headers'] =
        request.headers.get('access-control-request-headers') ?? 'content-type'
      set.headers['access-control-max-age'] = '86400'
      return new Response(null, { status: 204, headers: set.headers as HeadersInit })
    }
  })
