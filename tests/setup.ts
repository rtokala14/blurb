import { expect } from 'bun:test'
import * as matchers from '@testing-library/jest-dom/matchers'

/** jest-dom assertions (toBeInTheDocument, toHaveClass, …) for every test file. */
expect.extend(matchers as never)
