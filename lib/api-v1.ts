import { authenticateApiKey } from "./apikey";
import { tenantDb } from "./db";
import { json, jsonError } from "./api";

/** Wraps a public API v1 handler with API-key auth, plan check and rate limiting. */
export function v1(fn: (a: { req: Request; db: ReturnType<typeof tenantDb>; tenantId: string; keyName: string }) => Promise<Response>) {
  return async (req: Request) => {
    const auth = await authenticateApiKey(req);
    if ("error" in auth) return jsonError(auth.status === 429 ? "RATE_LIMITED" : "UNAUTHORIZED", auth.error!, auth.status);
    try {
      return await fn({ req, db: tenantDb(auth.tenant.id), tenantId: auth.tenant.id, keyName: auth.key.name });
    } catch (e) {
      return jsonError("BAD_REQUEST", e instanceof Error ? e.message : "Request failed");
    }
  };
}

export function page(req: Request) {
  const sp = new URL(req.url).searchParams;
  return { limit: Math.min(100, Math.max(1, Number(sp.get("limit")) || 25)), cursor: sp.get("cursor") || undefined, sp };
}

export const listResponse = <T extends { id: string }>(rows: T[], limit: number) =>
  json({ data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1].id : null });
