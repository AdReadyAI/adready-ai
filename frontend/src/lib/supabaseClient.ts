import { createClient, type SupportedStorage } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const authPersistenceKey = 'adready:auth-persistence'

type AuthPersistence = 'local' | 'session'

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars. Copy .env.example to .env and fill in real values.')
}

function getAuthPersistence(): AuthPersistence {
  if (typeof window === 'undefined') return 'local'
  return window.localStorage.getItem(authPersistenceKey) === 'session' ? 'session' : 'local'
}

function getBrowserStorage(persistence: AuthPersistence): Storage | null {
  if (typeof window === 'undefined') return null
  return persistence === 'local' ? window.localStorage : window.sessionStorage
}

export function setAuthSessionPersistence(rememberMe: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(authPersistenceKey, rememberMe ? 'local' : 'session')
}

const authStorage: SupportedStorage = {
  getItem(key) {
    return getBrowserStorage(getAuthPersistence())?.getItem(key) ?? null
  },
  setItem(key, value) {
    const persistence = getAuthPersistence()
    const primaryStorage = getBrowserStorage(persistence)
    const fallbackStorage = getBrowserStorage(persistence === 'local' ? 'session' : 'local')

    primaryStorage?.setItem(key, value)
    fallbackStorage?.removeItem(key)
  },
  removeItem(key) {
    getBrowserStorage('local')?.removeItem(key)
    getBrowserStorage('session')?.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: authStorage,
  },
})
