// Extend Vitest with user-facing DOM assertions such as toBeVisible and toHaveTextContent.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
