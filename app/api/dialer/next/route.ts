import type { Prisma } from "@prisma/client";
import { authorize, scopeWhere, phoneFor } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Power dialer queue (BRD §17): next lead for this agent.
 * Priority: due follow-ups first, then highest score among fresh leads.
 * Skips DND numbers, leads without phone, and leads dialled in the last `retryGapMinutes`.
 */
export const POST = handle(async (req: Request) => {
  const ctx = await authorize("call.make", { mod: "dialer" });
  const body = await req.json().catch(() => ({}));
  const skip: string[] = Array.isArray(body.skip) ? body.skip.slice(-500) : [];
  const retryGap = Number(body.retryGapMinutes ?? 60);
  const recent = await ctx.db.callLog.findMany({ where: { startedAt: { gt: new Date(Date.now() - retryGap * 60_000) }, leadId: { not: null } }, select: { leadId: true } });
  const dnd = (await ctx.db.dndNumber.findMany({ select: { phone: true } })).map((d) => d.phone);
  const where: Prisma.LeadWhereInput = {
    ...(await scopeWhere(ctx, "lead.view")),
    ...(body.mine !== false ? { ownerId: ctx.membership.id } : {}),
    deletedAt: null, phone: { not: null, notIn: dnd.length ? dnd : ["__"] },
    status: { in: body.statuses?.length ? body.statuses : ["new", "contacted", "qualified"] },
    id: { notIn: [...skip, ...recent.map((r) => r.leadId!)].concat("__") },
    ...(body.source ? { source: body.source } : {}),
  };
  const due = await ctx.db.lead.findFirst({ where: { ...where, nextFollowUpAt: { lte: new Date() } }, orderBy: { nextFollowUpAt: "asc" } });
  const lead = due ?? (await ctx.db.lead.findFirst({ where, orderBy: [{ score: "desc" }, { createdAt: "asc" }] }));
  const remaining = await ctx.db.lead.count({ where });
  if (!lead) return json({ lead: null, remaining: 0 });
  const activities = await prisma.activity.findMany({ where: { tenantId: ctx.tenant.id, leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 5 });
  return json({ lead: { ...lead, phone: phoneFor(ctx, lead.phone) }, activities, remaining, reason: due ? "Follow-up due" : "Top-scored lead" });
});
