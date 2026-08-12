import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

/**
 * Teaches `bun:test` about the jest-dom matchers registered in tests/setup.ts.
 */
declare module 'bun:test' {
  interface Matchers<T = unknown> extends TestingLibraryMatchers<never, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<never, unknown> {}
}
