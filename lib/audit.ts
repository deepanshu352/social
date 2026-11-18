import type { Ctx } from "./auth";
import { prisma } from "./prisma";
import { sha256 } from "./security";

/**
 * Append-only, tamper-evident audit trail (BRD §88).
 * Each row stores hash = sha256(prevHash + canonical row). Rows for a tenant are chained under a
 * per-tenant advisory lock, so any edit or deletion of history breaks verification (see verifyAuditChain).
 * Never throws — audit failure must not break the request.
 */
export async function audit(
  ctx: Pick<Ctx, "tenant" | "membership" | "user"> | { tenantId: string; actorName: string; actorType?: string; actorId?: string },
  action: string,
  entity: string,
  entityId?: string | null,
  before?: unknown,
  after?: unknown,
) {
  try {
    const base = "tenant" in ctx
      ? { tenantId: ctx.tenant.id, actorId: ctx.membership.id, actorName: ctx.user.name, actorType: "user" }
      : { tenantId: ctx.tenantId, actorId: ctx.actorId ?? null, actorName: ctx.actorName, actorType: ctx.actorType ?? "system" };
    const row = { ...base, action, entity, entityId: entityId ?? null, before: json(before) ?? null, after: json(after) ?? null };
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${base.tenantId}))`;
      const last = await tx.auditLog.findFirst({ where: { tenantId: base.tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { hash: true } });
      const createdAt = new Date();
      const prevHash = last?.hash ?? "genesis";
      const hash = sha256(prevHash + canonical({ ...row, createdAt: createdAt.toISOString() }));
      await tx.auditLog.create({ data: { ...row, before: row.before ?? undefined, after: row.after ?? undefined, createdAt, prevHash, hash } });
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}

/**
 * Walks the chain from "genesis" by following prevHash → hash links and recomputes every hash.
 * Detects edited rows (hash mismatch), deleted rows (break in links) and inserted / forked rows (unreached or duplicate links).
 */
export async function verifyAuditChain(tenantId: string) {
  const rows = await prisma.auditLog.findMany({ where: { tenantId, hash: { not: null } } });
  const byPrev = new Map<string, typeof rows>();
  for (const r of rows) byPrev.set(r.prevHash ?? "", [...(byPrev.get(r.prevHash ?? "") ?? []), r]);
  let prev = "genesis", checked = 0;
  for (;;) {
    const next = byPrev.get(prev) ?? [];
    if (!next.length) break;
    const r = next[0];
    const expected = sha256(prev + canonical({
      tenantId: r.tenantId, actorId: r.actorId, actorName: r.actorName, actorType: r.actorType, action: r.action, entity: r.entity,
      entityId: r.entityId, before: r.before ?? null, after: r.after ?? null, createdAt: r.createdAt.toISOString(),
    }));
    if (next.length > 1 || r.hash !== expected) return { ok: false as const, checked: rows.length, brokenAt: r.id, at: r.createdAt, action: r.action };
    prev = r.hash!; checked++;
  }
  if (checked !== rows.length) {
    const reached = new Set<string>();
    let p = "genesis";
    for (;;) { const n = byPrev.get(p)?.[0]; if (!n) break; reached.add(n.id); p = n.hash!; }
    const orphan = rows.find((r) => !reached.has(r.id))!;
    return { ok: false as const, checked: rows.length, brokenAt: orphan.id, at: orphan.createdAt, action: orphan.action };
  }
  return { ok: true as const, checked };
}

function json(v: unknown) {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));
}

/** Stable JSON (sorted keys) so the hash is reproducible after a DB round-trip. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k] === undefined ? null : o[k])}`).join(",")}}`;
}
