import { createClient, User } from "@supabase/supabase-js";

function authError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHENTICATED", message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Validates the request's Supabase Bearer JWT and returns the authenticated user.
 */
export async function getAuthenticatedUser(req: Request): Promise<User> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw authError("Missing Bearer token", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "AUTH_CONFIGURATION_ERROR",
          message: "Supabase auth is not configured",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw authError("Invalid or expired token", 401);
  }

  return data.user;
}
