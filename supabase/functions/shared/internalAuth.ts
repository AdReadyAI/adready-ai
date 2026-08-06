/** Shared-secret auth for endpoints only ever called by our own DB triggers. */
import { err } from "./response.ts";

/** Constant-time comparison so a mismatched secret doesn't leak timing info. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

/** Throws the 401 Response unless the caller holds INTERNAL_TRIGGER_SECRET. */
export function assertInternalCaller(req: Request): void {
  const secret = Deno.env.get("INTERNAL_TRIGGER_SECRET");
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!secret || !timingSafeEqual(authHeader, `Bearer ${secret}`)) {
    throw err("UNAUTHENTICATED", "Missing or invalid internal credentials", 401);
  }
}
