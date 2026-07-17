import { User } from 'npm:@supabase/supabase-js@2.39.8'

/**
 * Basic authentication placeholder to be fully implemented by the platform team.
 * Validates token presence and returns a mock user to satisfy agent type checks.
 */
export async function getAuthenticatedUser(req: Request): Promise<User> {
  const authHeader = req.headers.get('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response(
      JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Missing token' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return { id: 'mock-user-uuid', email: 'mock@adready.ai' } as User
}
