/**
 * Values that both the server and the browser bundle need to agree on.
 * Keep this file free of imports so it stays cheap on both sides.
 */

/** Every HTTP API route lives under this prefix; everything else is the SPA. */
export const API_PREFIX = '/api'

/** Upper bound the API enforces and the client paginates against. */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 20
