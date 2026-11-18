"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { authorize, scopeWhere } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { nextNumber } from "@/lib/db";
import { rupeesToPaise } from "@/lib/money";
import { optStr, str } from "@/lib/utils";

export async function moveDeal(dealId: string, stageId: string, lostReason?: string) {
  return guarded(async () => {
  const ctx = await authorize("deal.edit");
  const deal = await ctx.db.deal.findFirst({ where: { id: dealId, ...(await scopeWhere(ctx, "deal.view")) }, include: { stage: true } });
  const stage = await ctx.db.pipelineStage.findFirst({ where: { id: stageId } });
  if (!deal || !stage) throw new Error("Not found");
  if (deal.stageId === stageId) return;
  if (stage.type === "lost" && !lostReason) throw new Error("Lost reason required");
  await ctx.db.deal.update({ where: { id: dealId }, data: { stageId, closedAt: stage.type === "open" ? null : new Date(), lostReason: stage.type === "lost" ? lostReason : null } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, dealId, leadId: deal.leadId, contactId: deal.contactId, type: "status_change", body: `Deal “${deal.title}” moved ${deal.stage.name} → ${stage.name}${lostReason ? ` (${lostReason})` : ""}`, actorId: ctx.membership.id } });
  await audit(ctx, "deal.move", "Deal", dealId, { stage: deal.stage.name }, { stage: stage.name });
  if (stage.type === "won") await emit(ctx.tenant.id, "deal.won", { id: dealId, ownerId: deal.ownerId, amount: deal.amount, contactId: deal.contactId });
  if (stage.type === "lost") await emit(ctx.tenant.id, "deal.lost", { id: dealId, ownerId: deal.ownerId, reason: lostReason });
  revalidatePath("/pipeline");
});
}

export async function createDealAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("deal.edit");
  const stage = await ctx.db.pipelineStage.findFirstOrThrow({ where: { type: "open" }, orderBy: { order: "asc" } });
  await ctx.db.deal.create({
    data: {
      tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "deal"), title: str(fd.get("title")) || "New deal",
      stageId: str(fd.get("stageId")) || stage.id, contactId: optStr(fd.get("contactId")), ownerId: ctx.membership.id,
      branchId: ctx.membership.branchId, amount: rupeesToPaise(str(fd.get("amount"))),
      expectedClose: optStr(fd.get("expectedClose")) ? new Date(str(fd.get("expectedClose"))) : null,
    },
  });
  revalidatePath("/pipeline");
});
}
