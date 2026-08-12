import { expect } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * Browser environment for component tests. Loaded via `--preload`, never as a
 * plain import — Bun evaluates imported modules ahead of the importing file's
 * own statements, and @testing-library binds `screen` to `document.body` the
 * moment it is evaluated. A preload is the only hook that reliably runs first.
 *
 * It is also not a *global* preload (bunfig.toml): happy-dom replaces `Request`,
 * `Response` and `fetch` with browser-accurate implementations, which silently
 * change server-test behaviour — they refuse to set forbidden headers such as
 * Accept-Encoding, for one. Server tests run against Bun's own globals.
 *
 *   bun run test        both suites
 *   bun run test:web    component tests only
 */
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

// require, not import: a static import would hoist above the registration.
const matchers = require('@testing-library/jest-dom/matchers')
expect.extend(matchers)
