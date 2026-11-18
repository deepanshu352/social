"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, scopeWhere, type Ctx } from "@/lib/auth";
import { createLead, parseCsv } from "@/lib/leads";
import { nextNumber } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { notify } from "@/lib/notify";
import { rescoreLead } from "@/lib/scoring";
import { rupeesToPaise } from "@/lib/money";
import { optStr, str, normalizePhone } from "@/lib/utils";
import { parseCustom } from "@/lib/custom";
import type { LeadStatus } from "@prisma/client";

async function loadLead(ctx: Ctx, id: string, perm = "lead.view") {
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null, ...(await scopeWhere(ctx, perm)) } });
  if (!lead) throw new Error("Lead not found or not accessible");
  return lead;
}

export async function createLeadAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.create");
  const custom = parseCustom(await ctx.db.customFieldDef.findMany({ where: { entity: "lead" } }), fd);
  // Users who can't assign keep the leads they create; managers may leave owner blank to apply assignment rules.
  const ownerId = ctx.perms["lead.assign"] ? optStr(fd.get("ownerId")) : ctx.membership.id;
  const lead = await createLead(ctx.tenant.id, {
    name: str(fd.get("name")), phone: optStr(fd.get("phone")), email: optStr(fd.get("email")), companyName: optStr(fd.get("companyName")),
    source: optStr(fd.get("source")), campaign: optStr(fd.get("campaign")), product: optStr(fd.get("product")), city: optStr(fd.get("city")),
    state: optStr(fd.get("state")), language: optStr(fd.get("language")), budget: optStr(fd.get("budget")), priority: optStr(fd.get("priority")),
    notes: optStr(fd.get("notes")), ownerId, tags: str(fd.get("tags")).split(",").map((t) => t.trim()).filter(Boolean), custom,
  }, { membershipId: ctx.membership.id, name: ctx.user.name, branchId: ctx.membership.branchId });
  redirect(`/leads/${lead.id}`);
});
}

export async function updateLeadAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.edit");
  const before = await loadLead(ctx, id, "lead.edit");
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity: "lead" } });
  const data = {
    name: str(fd.get("name")) || before.name,
    // masked users never see the real number, so the phone field is only written when it was on the form
    ...(fd.has("phone") ? { phone: normalizePhone(optStr(fd.get("phone"))) } : {}),
    email: optStr(fd.get("email")), custom: parseCustom(defs, fd, (before.custom ?? {}) as Record<string, unknown>) as object,
    companyName: optStr(fd.get("companyName")), city: optStr(fd.get("city")), state: optStr(fd.get("state")), language: optStr(fd.get("language")),
    product: optStr(fd.get("product")), campaign: optStr(fd.get("campaign")),
    budget: optStr(fd.get("budget")) ? rupeesToPaise(str(fd.get("budget"))) : null,
    priority: (optStr(fd.get("priority")) ?? before.priority) as any,
    tags: str(fd.get("tags")).split(",").map((t) => t.trim()).filter(Boolean),
  };
  await ctx.db.lead.update({ where: { id }, data });
  await audit(ctx, "lead.update", "Lead", id, before, data);
  await rescoreLead(ctx.tenant.id, id);
  revalidatePath(`/leads/${id}`);
});
}

export async function changeStatusAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.edit");
  const lead = await loadLead(ctx, id, "lead.edit");
  const status = str(fd.get("status")) as LeadStatus;
  const lostReason = optStr(fd.get("lostReason"));
  if (status === "lost" && !lostReason) throw new Error("A lost reason is required");
  if (status === lead.status) return;
  await ctx.db.lead.update({ where: { id }, data: { status, lostReason: status === "lost" ? lostReason : null, lastActivityAt: new Date(), firstResponseAt: lead.firstResponseAt ?? (status !== "new" ? new Date() : null) } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, type: "status_change", body: `Status changed ${lead.status} → ${status}${lostReason ? ` (${lostReason})` : ""}`, actorId: ctx.membership.id } });
  await audit(ctx, "lead.status", "Lead", id, { status: lead.status }, { status, lostReason });
  await emit(ctx.tenant.id, "lead.status_changed", { id, leadId: id, from: lead.status, status, ownerId: lead.ownerId, source: lead.source });
  await rescoreLead(ctx.tenant.id, id);
  revalidatePath(`/leads/${id}`);
});
}

export async function assignLeadAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.assign");
  const lead = await loadLead(ctx, id);
  const ownerId = str(fd.get("ownerId"));
  const owner = await ctx.db.membership.findFirst({ where: { id: ownerId, status: "active" }, include: { user: true } });
  if (!owner) throw new Error("Invalid user");
  await ctx.db.lead.update({ where: { id }, data: { ownerId, assignedAt: new Date() } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, type: "system", body: `Assigned to ${owner.user.name} by ${ctx.user.name}`, actorId: ctx.membership.id } });
  await notify(ctx.tenant.id, ownerId, `Lead assigned to you: ${lead.name}`, `by ${ctx.user.name}`, `/leads/${id}`);
  await audit(ctx, "lead.assign", "Lead", id, { ownerId: lead.ownerId }, { ownerId });
  await emit(ctx.tenant.id, "lead.assigned", { id, leadId: id, ownerId });
  revalidatePath(`/leads/${id}`);
});
}

export async function bulkAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.view");
  const ids = fd.getAll("ids").map(String);
  const op = str(fd.get("op"));
  if (!ids.length) return;
  const visible = await ctx.db.lead.findMany({ where: { id: { in: ids }, ...(await scopeWhere(ctx, "lead.view")) }, select: { id: true } });
  const vids = visible.map((v) => v.id);
  if (op === "assign") {
    if (!ctx.perms["lead.assign"]) throw new Error("Not allowed");
    const ownerId = str(fd.get("ownerId"));
    await ctx.db.lead.updateMany({ where: { id: { in: vids } }, data: { ownerId, assignedAt: new Date() } });
    await notify(ctx.tenant.id, ownerId, `${vids.length} leads assigned to you`, `by ${ctx.user.name}`, "/leads");
  } else if (op === "delete") {
    if (!ctx.perms["lead.delete"]) throw new Error("Not allowed");
    await ctx.db.lead.updateMany({ where: { id: { in: vids } }, data: { deletedAt: new Date() } });
  } else if (op === "tag") {
    const tag = str(fd.get("tag"));
    if (tag) for (const l of await ctx.db.lead.findMany({ where: { id: { in: vids } } })) {
      if (!l.tags.includes(tag)) await ctx.db.lead.update({ where: { id: l.id }, data: { tags: [...l.tags, tag] } });
    }
  }
  await audit(ctx, `lead.bulk.${op}`, "Lead", null, null, { ids: vids });
  revalidatePath("/leads");
});
}

export async function addNoteAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.view");
  await loadLead(ctx, id);
  const body = str(fd.get("body"));
  if (!body) return;
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, type: (str(fd.get("type")) || "note") as any, body, actorId: ctx.membership.id } });
  await ctx.db.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
  await rescoreLead(ctx.tenant.id, id);
  revalidatePath(`/leads/${id}`);
});
}

export async function addFollowUpAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("followup.create");
  const lead = await loadLead(ctx, id);
  const dueAt = new Date(str(fd.get("dueAt")));
  if (isNaN(dueAt.getTime())) throw new Error("Pick a date and time");
  await ctx.db.followUp.create({ data: { tenantId: ctx.tenant.id, leadId: id, assigneeId: lead.ownerId ?? ctx.membership.id, dueAt, type: str(fd.get("type")) || "call", note: optStr(fd.get("note")) } });
  const next = await ctx.db.followUp.findFirst({ where: { leadId: id, status: "pending" }, orderBy: { dueAt: "asc" } });
  await ctx.db.lead.update({ where: { id }, data: { nextFollowUpAt: next?.dueAt ?? null } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, type: "system", body: `Follow-up scheduled for ${dueAt.toLocaleString("en-IN", { timeZone: ctx.tenant.timezone })}`, actorId: ctx.membership.id } });
  revalidatePath(`/leads/${id}`);
});
}

export async function convertLeadAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("lead.edit");
  const lead = await loadLead(ctx, id, "lead.edit");
  if (lead.status === "converted" && lead.contactId) redirect(`/contacts/${lead.contactId}`);
  const contact = lead.contactId
    ? await ctx.db.contact.findFirstOrThrow({ where: { id: lead.contactId } })
    : await ctx.db.contact.create({
        data: { tenantId: ctx.tenant.id, name: lead.name, companyName: lead.companyName, phone: lead.phone, email: lead.email, ownerId: lead.ownerId, branchId: lead.branchId, stateCode: optStr(fd.get("stateCode")) ?? ctx.tenant.stateCode, tags: lead.tags },
      });
  let dealId: string | null = null;
  if (fd.get("createDeal") === "on") {
    const stage = await ctx.db.pipelineStage.findFirst({ where: { name: "Qualified" } }) ?? await ctx.db.pipelineStage.findFirstOrThrow({ orderBy: { order: "asc" } });
    const deal = await ctx.db.deal.create({
      data: { tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "deal"), title: str(fd.get("dealTitle")) || `${lead.companyName ?? lead.name} — ${lead.product ?? "Deal"}`, stageId: stage.id, contactId: contact.id, leadId: lead.id, ownerId: lead.ownerId, branchId: lead.branchId, amount: rupeesToPaise(str(fd.get("dealAmount")) || Number(lead.budget ?? 0n) / 100) },
    });
    dealId = deal.id;
  }
  await ctx.db.lead.update({ where: { id }, data: { status: "converted", contactId: contact.id, lastActivityAt: new Date() } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, contactId: contact.id, type: "status_change", body: `Converted to customer${dealId ? " and deal created" : ""}`, actorId: ctx.membership.id } });
  await audit(ctx, "lead.convert", "Lead", id, null, { contactId: contact.id, dealId });
  await emit(ctx.tenant.id, "lead.status_changed", { id, leadId: id, from: lead.status, status: "converted", ownerId: lead.ownerId });
  redirect(dealId ? `/pipeline?highlight=${dealId}` : `/contacts/${contact.id}`);
});
}

export async function importLeadsAction(_: unknown, fd: FormData): Promise<{ ok?: string; error?: string }> {
  const ctx = await authorize("lead.import");
  const file = fd.get("file");
  const text = file instanceof File && file.size ? await file.text() : str(fd.get("csv"));
  if (!text) return { error: "Upload a CSV file or paste CSV text." };
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "CSV needs a header row and at least one lead." };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const col = (row: string[], ...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0 && row[i]?.trim()) return row[i].trim(); } return null; };
  const skipDup = fd.get("skipDuplicates") === "on";
  let created = 0, skipped = 0;
  for (const r of rows.slice(1, 5001)) {
    const name = col(r, "name", "fullname", "leadname", "contactname");
    if (!name) { skipped++; continue; }
    const phone = col(r, "phone", "mobile", "phonenumber", "contact");
    if (skipDup && phone && (await ctx.db.lead.findFirst({ where: { phone: normalizePhone(phone), deletedAt: null } }))) { skipped++; continue; }
    await createLead(ctx.tenant.id, {
      name, phone, email: col(r, "email", "emailaddress"), companyName: col(r, "company", "companyname", "organisation", "organization"),
      source: col(r, "source") ?? "import", city: col(r, "city", "location"), state: col(r, "state"), product: col(r, "product", "interest"),
      campaign: col(r, "campaign"), budget: col(r, "budget"), language: col(r, "language"), notes: col(r, "notes", "remarks"),
    }, { membershipId: ctx.membership.id, name: `${ctx.user.name} (import)`, branchId: ctx.membership.branchId });
    created++;
  }
  await audit(ctx, "lead.import", "Lead", null, null, { created, skipped });
  revalidatePath("/leads");
  return { ok: `Imported ${created} leads${skipped ? `, skipped ${skipped}` : ""}. Assignment rules and automations were applied.` };
}
