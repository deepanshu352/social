import crypto from "node:crypto";
import { prisma } from "./prisma";

export const hashKey = (k: string) => crypto.createHash("sha256").update(k).digest("hex");

export function generateKey() {
  const key = `bos_live_${crypto.randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
}

const hits = new Map<string, { n: number; at: number }>();
/** 120 requests / minute per key (in-memory; move to Redis for multi-instance). */
function rateLimited(id: string) {
  const now = Date.now();
  const h = hits.get(id);
  if (!h || now - h.at > 60_000) { hits.set(id, { n: 1, at: now }); return false; }
  return ++h.n > 120;
}

export async function authenticateApiKey(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!key) return { error: "Missing API key (Authorization: Bearer bos_live_…)", status: 401 } as const;
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) }, include: { tenant: true } });
  if (!row || row.revokedAt) return { error: "Invalid or revoked API key", status: 401 } as const;
  if (["suspended", "cancelled"].includes(row.tenant.status)) return { error: "Workspace suspended", status: 403 } as const;
  if (!["professional", "enterprise"].includes(row.tenant.plan)) return { error: "API access requires the Professional plan", status: 403 } as const;
  if (rateLimited(row.id)) return { error: "Rate limit exceeded (120/min)", status: 429 } as const;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { key: row, tenant: row.tenant } as const;
}
