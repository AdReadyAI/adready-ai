import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('application routing', () => {
  it('redirects the product entry point to the upload flow', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    // This protects the first user-visible step while the upload page grows beyond its scaffold.
    expect(await screen.findByRole('heading', { name: 'Upload' })).toBeVisible()
  })
})
