import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const supabaseMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
  setAuthSessionPersistence: vi.fn(),
}))

vi.mock('./lib/supabaseClient', () => ({
  setAuthSessionPersistence: supabaseMocks.setAuthSessionPersistence,
  supabase: {
    auth: {
      getSession: supabaseMocks.getSession,
      onAuthStateChange: supabaseMocks.onAuthStateChange,
      signUp: supabaseMocks.signUp,
      signInWithPassword: supabaseMocks.signInWithPassword,
      signOut: supabaseMocks.signOut,
      resetPasswordForEmail: supabaseMocks.resetPasswordForEmail,
      updateUser: supabaseMocks.updateUser,
      signInWithOAuth: supabaseMocks.signInWithOAuth,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  supabaseMocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
  supabaseMocks.onAuthStateChange.mockReturnValue({
    data: {
      subscription: { unsubscribe: vi.fn() },
    },
  })
})

describe('application routing', () => {
  it('redirects signed-out users from the product entry point to sign in', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })
})
