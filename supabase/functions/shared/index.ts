import { createClient } from "npm:@supabase/supabase-js@2.39.8";

export function createSupabaseClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    },
  );
}

export function createSupabaseServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

export * from "./auth.ts";
export * from "./cors.ts";
export * from "./response.ts";
export * from "./handler.ts";
