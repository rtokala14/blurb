import { mock } from "bun:test"

// `server-only` throws by design outside a server bundle; stub it for tests.
mock.module("server-only", () => ({}))
