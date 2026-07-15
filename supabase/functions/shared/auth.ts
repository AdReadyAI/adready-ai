/**
 * auth.ts — Shared Supabase JWT authentication for all edge functions.
 */

// Verifies the Bearer JWT in the Authorization header.
// Returns null if valid, or a 401 Response if invalid/missing.
export async function verifyAuth(req: Request): Promise<Response | null> {
  // 1. Extract Authorization header
  // 2. Verify JWT against Supabase JWT secret
  // 3. Return null on success, Response(401) on failure
  return null; // placeholder
}
