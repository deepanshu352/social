import type { Ctx } from "./auth";
import { scopeWhere } from "./auth";
import { prisma } from "./prisma";
import { complianceCheck, DISPOSITIONS, getProvider } from "./telephony";
import { rescoreLead } from "./scoring";
import { emit } from "./events";
import { audit } from "./audit";
import { fmtDuration } from "./utils";
import type { LeadStatus } from "@prisma/client";

export async function startCall(ctx: Ctx, target: { leadId?: string | null; contactId?: string | null }) {
  let phone: string | null = null, leadId: string | null = null, contactId: string | null = null;
  if (target.leadId) {
    const lead = await ctx.db.lead.findFirst({ where: { id: target.leadId, deletedAt: null, ...(await scopeWhere(ctx, "lead.view")) } });
    if (!lead) throw new Error("Lead not found");
    phone = lead.phone; leadId = lead.id; contactId = lead.contactId;
  } else if (target.contactId) {
    const c = await ctx.db.contact.findFirst({ where: { id: target.contactId, ...(await scopeWhere(ctx, "contact.view")) } });
    if (!c) throw new Error("Customer not found");
    phone = c.phone; contactId = c.id;
  }
  if (!phone) throw new Error("No phone number on this record");
  const active = await ctx.db.callLog.findFirst({ where: { agentId: ctx.membership.id, status: { in: ["initiated", "ringing", "in_progress"] }, startedAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
  if (active) {
    // auto-close stale/abandoned calls older than 2 minutes, otherwise block parallel calls
    if (Date.now() - active.startedAt.getTime() > 2 * 60_000) {
      await ctx.db.callLog.update({ where: { id: active.id }, data: { status: "failed", endedAt: new Date(), disposition: active.disposition ?? "no_answer" } });
    } else throw new Error("Finish your current call (save its outcome) before starting another.");
  }
  const gate = await complianceCheck(ctx.tenant, phone);
  await audit(ctx, gate.ok ? "call.allowed" : "call.blocked", "CallLog", null, null, { phone, leadId, reason: gate.ok ? null : gate.code });
  if (!gate.ok) throw new Error(gate.message);

  const provider = getProvider();
  const { providerCallId } = await provider.placeCall({ agentNumber: "", customerNumber: phone, record: true });
  const call = await ctx.db.callLog.create({
    data: { tenantId: ctx.tenant.id, leadId, contactId, agentId: ctx.membership.id, toNumber: phone, status: "ringing", provider: provider.name, providerCallId },
  });
  return call;
}

export async function updateCall(ctx: Ctx, id: string, body: { action: string; disposition?: string; notes?: string; callbackAt?: string | null }) {
  const call = await ctx.db.callLog.findFirst({ where: { id, agentId: ctx.membership.id } });
  if (!call) throw new Error("Call not found");
  const now = new Date();
  switch (body.action) {
    case "answer":
      return ctx.db.callLog.update({ where: { id }, data: { status: "in_progress", answeredAt: now } });
    case "end": {
      const talk = call.answeredAt ? Math.round((now.getTime() - call.answeredAt.getTime()) / 1000) : 0;
      return ctx.db.callLog.update({
        where: { id },
        data: { status: "completed", endedAt: now, talkSeconds: talk, recordingUrl: call.provider === "mock" ? null : call.recordingUrl },
      });
    }
    case "no_answer":
    case "busy":
      return ctx.db.callLog.update({ where: { id }, data: { status: body.action, endedAt: now } });
    case "dispose":
      return disposeCall(ctx, call.id, body);
    default:
      throw new Error("Unknown action");
  }
}

const RANK: Record<string, number> = { new: 0, contacted: 1, qualified: 2, unqualified: 2, lost: 3, converted: 4 };

async function disposeCall(ctx: Ctx, id: string, body: { disposition?: string; notes?: string; callbackAt?: string | null }) {
  const d = DISPOSITIONS.find((x) => x.key === body.disposition);
  if (!d) throw new Error("Choose a valid disposition");
  const callbackAt = body.callbackAt ? new Date(body.callbackAt) : null;
  if (d.callback && (!callbackAt || isNaN(callbackAt.getTime()))) throw new Error("Pick a callback time");
  const existing = await ctx.db.callLog.findFirstOrThrow({ where: { id } });
  const call = await ctx.db.callLog.update({
    where: { id },
    data: {
      disposition: d.key, notes: body.notes || null, callbackAt, endedAt: existing.endedAt ?? new Date(),
      status: ["ringing", "initiated", "in_progress"].includes(existing.status) ? (d.category === "not_connected" ? "no_answer" : "completed") : existing.status,
    },
  });
  const tenantId = ctx.tenant.id;
  const text = `Call ${d.label}${call.talkSeconds ? ` · ${fmtDuration(call.talkSeconds)}` : ""}${body.notes ? ` — ${body.notes}` : ""}`;
  await ctx.db.activity.create({ data: { tenantId, leadId: call.leadId, contactId: call.contactId, type: "call", body: text, meta: { callId: id }, actorId: ctx.membership.id } });

  if (d.dnd) {
    await prisma.dndNumber.upsert({ where: { tenantId_phone: { tenantId, phone: call.toNumber } }, create: { tenantId, phone: call.toNumber, reason: "Opt-out on call" }, update: {} });
    if (call.contactId) await ctx.db.contact.update({ where: { id: call.contactId }, data: { dnd: true } });
  }

  if (call.leadId) {
    const lead = await ctx.db.lead.findFirstOrThrow({ where: { id: call.leadId } });
    const data: Record<string, unknown> = { lastActivityAt: new Date(), firstResponseAt: lead.firstResponseAt ?? new Date() };
    let newStatus = lead.status;
    if (d.leadStatus) {
      const target = d.leadStatus as LeadStatus;
      // never move a lead backwards (e.g. qualified → contacted), but always allow lost / converted
      if (target === "lost" || target === "converted" || RANK[target] > RANK[lead.status]) newStatus = target;
    } else if (lead.status === "new") newStatus = "contacted";
    if (newStatus !== lead.status) {
      data.status = newStatus;
      if (newStatus === "lost") data.lostReason = d.label;
      await ctx.db.activity.create({ data: { tenantId, leadId: lead.id, type: "status_change", body: `Status changed ${lead.status} → ${newStatus} (call disposition)`, actorId: ctx.membership.id } });
    }
    // complete the follow-up that this call satisfied
    const due = await ctx.db.followUp.findFirst({ where: { leadId: lead.id, status: "pending", dueAt: { lte: new Date(Date.now() + 3600_000) } }, orderBy: { dueAt: "asc" } });
    if (due) await ctx.db.followUp.update({ where: { id: due.id }, data: { status: "done", completedAt: new Date(), outcome: d.label } });
    if (callbackAt) await ctx.db.followUp.create({ data: { tenantId, leadId: lead.id, assigneeId: lead.ownerId ?? ctx.membership.id, dueAt: callbackAt, type: "call", note: `Callback: ${d.label}${body.notes ? ` — ${body.notes}` : ""}` } });
    const next = await ctx.db.followUp.findFirst({ where: { leadId: lead.id, status: "pending" }, orderBy: { dueAt: "asc" } });
    data.nextFollowUpAt = next?.dueAt ?? null;
    await ctx.db.lead.update({ where: { id: lead.id }, data });
    await rescoreLead(tenantId, lead.id);
    if (newStatus !== lead.status) await emit(tenantId, "lead.status_changed", { id: lead.id, leadId: lead.id, from: lead.status, status: newStatus, ownerId: lead.ownerId });
  }
  await emit(tenantId, "call.completed", { id, leadId: call.leadId, contactId: call.contactId, agentId: call.agentId, ownerId: call.agentId, disposition: d.key, talkSeconds: call.talkSeconds });
  return call;
}
