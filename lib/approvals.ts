import type { Ctx } from "./auth";
import { prisma } from "./prisma";
import { notify } from "./notify";
import { audit } from "./audit";

/**
 * Generic multi-level approval engine (BRD §66).
 * A policy (entity + minimum amount) defines ordered approver role levels, e.g. expense ≥ ₹10,000:
 * sales_manager → accountant → admin. Each level must approve; any rejection ends the request.
 * Requesters can never approve their own request. Company admins can approve any level.
 */
export type ApprovalEntity = "expense" | "leave" | "purchase_order";

export async function levelsFor(tenantId: string, entity: ApprovalEntity, amount: bigint = 0n): Promise<string[]> {
  const policies = await prisma.approvalPolicy.findMany({ where: { tenantId, entity, isActive: true, minAmount: { lte: amount } }, orderBy: { minAmount: "desc" } });
  if (policies.length) return policies[0].levels;
  // sensible defaults when no policy is configured
  return entity === "purchase_order" ? ["admin"] : ["manager"];
}

/** Opens an approval. Returns null when no approval is needed (empty levels → auto-approved). */
export async function requestApproval(ctx: Ctx, entity: ApprovalEntity, entityId: string, title: string, amount: bigint | null) {
  const levels = await levelsFor(ctx.tenant.id, entity, amount ?? 0n);
  if (!levels.length) return null;
  const req = await prisma.approvalRequest.create({ data: { tenantId: ctx.tenant.id, entity, entityId, title, amount, requestedById: ctx.membership.id, levels } });
  await notifyLevel(ctx.tenant.id, req.id);
  await audit(ctx, "approval.request", "ApprovalRequest", req.id, null, { entity, entityId, levels, amount });
  return req;
}

async function approversAt(tenantId: string, requestedById: string, levelKey: string): Promise<string[]> {
  if (levelKey === "manager") {
    const m = await prisma.membership.findUnique({ where: { id: requestedById } });
    if (m?.managerId) return [m.managerId];
    levelKey = "admin";
  }
  const ms = await prisma.membership.findMany({ where: { tenantId, status: "active", role: { key: levelKey } }, select: { id: true } });
  return ms.map((m) => m.id).filter((id) => id !== requestedById);
}

async function notifyLevel(tenantId: string, requestId: string) {
  const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
  for (const m of await approversAt(tenantId, r.requestedById, r.levels[r.level])) {
    await notify(tenantId, m, `Approval needed: ${r.title}`, `Level ${r.level + 1} of ${r.levels.length}`, "/approvals");
  }
}

export async function canDecide(ctx: Ctx, r: { requestedById: string; levels: string[]; level: number; status: string }) {
  if (r.status !== "pending" || r.requestedById === ctx.membership.id) return false;
  if (ctx.membership.role.key === "admin") return true;
  return (await approversAt(ctx.tenant.id, r.requestedById, r.levels[r.level])).includes(ctx.membership.id);
}

/** Records a decision; returns the final status once the chain completes ("approved" | "rejected"), else "pending". */
export async function decide(ctx: Ctx, requestId: string, approve: boolean, comment?: string) {
  const r = await prisma.approvalRequest.findFirst({ where: { id: requestId, tenantId: ctx.tenant.id } });
  if (!r) throw new Error("Approval not found");
  if (!(await canDecide(ctx, r))) throw new Error("You can't decide this approval (not your level, or it's your own request).");
  const history = [...((r.history as any[]) ?? []), { level: r.level, by: ctx.user.name, byId: ctx.membership.id, decision: approve ? "approved" : "rejected", comment: comment || null, at: new Date() }];
  const done = !approve || r.level + 1 >= r.levels.length;
  const status = !approve ? "rejected" : done ? "approved" : "pending";
  await prisma.approvalRequest.update({ where: { id: r.id }, data: { history, level: done ? r.level : r.level + 1, status, decidedAt: done ? new Date() : null } });
  await audit(ctx, approve ? "approval.approve" : "approval.reject", "ApprovalRequest", r.id, { level: r.level }, { status, comment });
  if (status === "pending") await notifyLevel(ctx.tenant.id, r.id);
  else await notify(ctx.tenant.id, r.requestedById, `${r.title}: ${status}`, comment || `by ${ctx.user.name}`, "/approvals?tab=mine");
  return { status, request: r };
}
