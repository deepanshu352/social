import { authorize, scopeWhere } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { createLead } from "@/lib/leads";
import { nextNumber } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Capture } from "@/lib/ai";

/** Voice/Text-to-CRM step 2: the user confirmed — apply the chosen updates. */
export const POST = handle(async (req: Request) => {
  const ctx = await authorize("lead.edit", { mod: "ai" });
  const { capture: c, leadId, actions } = (await req.json()) as { capture: Capture; leadId?: string | null; actions: { lead: boolean; note: boolean; followUp: boolean; task: boolean } };
  const done: { label: string; href: string }[] = [];
  let id = leadId ?? null;
  if (id && !(await ctx.db.lead.findFirst({ where: { id, ...(await scopeWhere(ctx, "lead.view")) } }))) throw new Error("Lead not accessible");
  if (!id && actions.lead) {
    if (!ctx.perms["lead.create"]) throw new Error("You can't create leads");
    const lead = await createLead(ctx.tenant.id, {
      name: c.customer_name || "Unknown (voice note)", phone: c.phone, companyName: c.company, city: c.city, source: "phone",
      product: c.products.map((p) => `${p.name}${p.quantity ? ` × ${p.quantity}` : ""}`).join(", ") || null,
      budget: c.budget_inr ?? null, priority: c.priority, notes: c.note,
    }, { membershipId: ctx.membership.id, name: `${ctx.user.name} (AI quick capture)`, branchId: ctx.membership.branchId });
    if (!ctx.perms["lead.assign"]) await ctx.db.lead.update({ where: { id: lead.id }, data: { ownerId: ctx.membership.id } });
    id = lead.id; done.push({ label: `Created lead LD-${lead.number}`, href: `/leads/${lead.id}` });
  }
  if (id && actions.note) {
    await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: id, type: "ai", body: `Quick capture: ${c.note}${c.products.length ? `\nProducts: ${c.products.map((p) => `${p.name}${p.quantity ? ` × ${p.quantity}` : ""}`).join(", ")}` : ""}`, actorId: ctx.membership.id } });
    await ctx.db.lead.update({ where: { id }, data: { lastActivityAt: new Date(), ...(c.priority === "urgent" || c.priority === "high" ? { priority: c.priority } : {}) } });
    done.push({ label: "Note added to timeline", href: `/leads/${id}` });
  }
  if (id && actions.followUp && c.follow_up_at) {
    const dueAt = new Date(c.follow_up_at);
    if (!isNaN(dueAt.getTime())) {
      await ctx.db.followUp.create({ data: { tenantId: ctx.tenant.id, leadId: id, assigneeId: ctx.membership.id, dueAt, type: c.follow_up_type ?? "call", note: c.note.slice(0, 200) } });
      await ctx.db.lead.update({ where: { id }, data: { nextFollowUpAt: dueAt } });
      done.push({ label: `Follow-up on ${dueAt.toLocaleString("en-IN")}`, href: "/followups" });
    }
  }
  if (actions.task && c.products.length) {
    const t = await ctx.db.task.create({ data: { tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "task"), title: `Prepare quotation: ${c.products.map((p) => `${p.name}${p.quantity ? ` × ${p.quantity}` : ""}`).join(", ")} for ${c.customer_name ?? "customer"}`, assigneeId: ctx.membership.id, createdById: ctx.membership.id, leadId: id, dueAt: new Date(Date.now() + 4 * 3600_000), priority: "high", source: "ai" } });
    done.push({ label: `Task T-${t.number} to prepare quotation`, href: `/tasks?id=${t.id}` });
  }
  await audit({ tenantId: ctx.tenant.id, actorName: `AI quick capture (for ${ctx.user.name})`, actorType: "ai", actorId: ctx.membership.id }, "ai.quick_capture", "Lead", id, null, { actions, done: done.map((d) => d.label) });
  return json({ done });
});
