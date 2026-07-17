import { User } from 'npm:@supabase/supabase-js@2.39.8'
import { z } from 'npm:zod@^3.22.4'
import { handleCors } from './cors.ts'
import { getAuthenticatedUser } from './auth.ts'
import { err } from './response.ts'

export type HandlerContext = {
  user: User
  requestId: string
}

export type HandlerContextWithBody<T> = HandlerContext & { body: T }

type EdgeHandler = (req: Request, ctx: HandlerContext) => Promise<Response>
type EdgeHandlerWithBody<T> = (req: Request, ctx: HandlerContextWithBody<T>) => Promise<Response>

/**
 * Basic Edge Handler wrapper to manage CORS, Auth, and Request/Response lifecycle.
 */
export function createEdgeHandler(name: string, handler: EdgeHandler): void
export function createEdgeHandler<T>(name: string, schema: z.ZodType<T>, handler: EdgeHandlerWithBody<T>): void
export function createEdgeHandler<T>(
  name: string,
  schemaOrHandler: z.ZodType<T> | EdgeHandler,
  maybeHandler?: EdgeHandlerWithBody<T>,
): void {
  Deno.serve(async (req) => {
    const preflight = handleCors(req)
    if (preflight) return preflight

    const requestId = crypto.randomUUID()

    try {
      const user = await getAuthenticatedUser(req)
      
      if (maybeHandler !== undefined) {
        const raw = await req.json()
        const body = (schemaOrHandler as z.ZodType<T>).parse(raw)
        return await maybeHandler(req, { user, requestId, body })
      } else {
        return await (schemaOrHandler as EdgeHandler)(req, { user, requestId })
      }
    } catch (res) {
      if (res instanceof Response) return res
      return err('INTERNAL_ERROR', res instanceof Error ? res.message : 'Unexpected server error')
    }
  })
}
