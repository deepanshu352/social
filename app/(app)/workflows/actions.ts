"use server";
import { guarded } from "@/lib/action";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { RECIPES } from "@/lib/workflow-recipes";
import { ACTIONS, TRIGGERS, newStepId, normalizePayload, processRun, type Step } from "@/lib/workflows";
import { prisma } from "@/lib/prisma";

const Cond = z.object({ field: z.string().min(1).max(60), op: z.enum(["eq", "neq", "in", "contains", "gte", "lte", "empty", "not_empty"]), value: z.string().max(300).optional() });
const StepSchema: z.ZodType<Step> = z.lazy(() => z.union([
  z.object({ id: z.string(), type: z.literal("action"), action: z.enum(ACTIONS.map((a) => a.key) as [string, ...string[]]) as any, config: z.record(z.string(), z.any()) }),
  z.object({ id: z.string(), type: z.literal("wait"), amount: z.number().min(1).max(10000), unit: z.enum(["minutes", "hours", "days"]) }),
  z.object({ id: z.string(), type: z.literal("condition"), match: z.enum(["all", "any"]).optional(), conditions: z.array(Cond).max(10), then: z.array(StepSchema).max(30), else: z.array(StepSchema).max(30) }),
]));
const Payload = z.object({
  name: z.string().min(2).max(120), description: z.string().max(500).optional().nullable(), isActive: z.boolean(),
  trigger: z.enum(TRIGGERS.map((t) => t.key) as [string, ...string[]]), triggerConfig: z.record(z.string(), z.any()),
  conditions: z.array(Cond).max(10), steps: z.array(StepSchema).min(1, "Add at least one step").max(40),
});

function count(steps: Step[]): number {
  return steps.reduce((n, s) => n + 1 + (s.type === "condition" ? count(s.then) + count(s.else) : 0), 0);
}
function validateUrls(steps: Step[]) {
  for (const s of steps) {
    if (s.type === "action" && s.action === "webhook" && !/^https:\/\//.test(String(s.config.url ?? ""))) throw new Error("Webhook steps need an https:// URL");
    if (s.type === "condition") { validateUrls(s.then); validateUrls(s.else); }
  }
}

export async function saveWorkflow(id: string | null, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage", { mod: "workflows" });
  const parsed = Payload.safeParse(JSON.parse(String(fd.get("payload") ?? "{}")));
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const p = parsed.data;
  if (count(p.steps) > 80) throw new Error("Workflows are limited to 80 steps");
  validateUrls(p.steps);
  const data = { name: p.name, description: p.description ?? null, isActive: p.isActive, trigger: p.trigger, triggerConfig: p.triggerConfig, conditions: p.conditions, steps: p.steps as object };
  if (id) {
    const before = await ctx.db.workflow.findFirstOrThrow({ where: { id } });
    await ctx.db.workflow.update({ where: { id }, data });
    await audit(ctx, "workflow.update", "Workflow", id, { trigger: before.trigger, steps: before.steps }, { trigger: p.trigger, steps: p.steps });
  } else {
    const wf = await ctx.db.workflow.create({ data: { ...data, tenantId: ctx.tenant.id, createdById: ctx.membership.id } });
    await audit(ctx, "workflow.create", "Workflow", wf.id, null, { name: p.name, trigger: p.trigger });
    id = wf.id;
  }
  revalidatePath("/workflows");
  redirect(`/workflows/${id}?saved=1`);
});
}

export async function installRecipe(key: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage", { mod: "workflows" });
  const r = RECIPES.find((x) => x.key === key);
  if (!r) throw new Error("Unknown recipe");
  const remap = (steps: Step[]): Step[] => steps.map((s) => s.type === "condition" ? { ...s, id: newStepId(), then: remap(s.then), else: remap(s.else) } : { ...s, id: newStepId() });
  const wf = await ctx.db.workflow.create({
    data: { tenantId: ctx.tenant.id, name: r.name, description: r.description, trigger: r.trigger, triggerConfig: (r.triggerConfig ?? {}) as object, conditions: (r.conditions ?? []) as object, steps: remap(r.steps) as object, recipeKey: r.key, createdById: ctx.membership.id },
  });
  await audit(ctx, "workflow.install_recipe", "Workflow", wf.id, null, { recipe: key });
  redirect(`/workflows/${wf.id}?installed=1`);
});
}

export async function toggleWorkflow(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  const wf = await ctx.db.workflow.findFirstOrThrow({ where: { id } });
  await ctx.db.workflow.update({ where: { id }, data: { isActive: !wf.isActive } });
  await audit(ctx, wf.isActive ? "workflow.pause" : "workflow.activate", "Workflow", id);
  revalidatePath("/workflows");
});
}

export async function deleteWorkflow(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  await ctx.db.workflow.delete({ where: { id } });
  await audit(ctx, "workflow.delete", "Workflow", id);
  redirect("/workflows");
});
}

export async function duplicateWorkflow(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  const wf = await ctx.db.workflow.findFirstOrThrow({ where: { id } });
  const copy = await ctx.db.workflow.create({ data: { tenantId: ctx.tenant.id, name: `${wf.name} (copy)`, description: wf.description, trigger: wf.trigger, triggerConfig: wf.triggerConfig as object, conditions: wf.conditions as object, steps: wf.steps as object, isActive: false, createdById: ctx.membership.id } });
  redirect(`/workflows/${copy.id}`);
});
}

/** Runs the workflow once now against the most recent matching record, ignoring its trigger. */
export async function testRun(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage", { mod: "workflows" });
  const wf = await ctx.db.workflow.findFirstOrThrow({ where: { id } });
  const entity = wf.trigger.split(".")[0];
  let payload: Record<string, any> = { test: true, ownerId: ctx.membership.id };
  if (entity === "lead") { const l = await ctx.db.lead.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } }); if (l) payload = { ...payload, leadId: l.id, ownerId: l.ownerId ?? ctx.membership.id, source: l.source }; }
  if (entity === "invoice" || entity === "payment") { const i = await ctx.db.invoice.findFirst({ where: { status: { not: "draft" } }, orderBy: { issueDate: "desc" } }); if (i) payload = { ...payload, invoiceId: i.id, contactId: i.contactId, amount: Number(i.total) }; }
  if (entity === "quotation") { const q = await ctx.db.quotation.findFirst({ orderBy: { createdAt: "desc" } }); if (q) payload = { ...payload, quotationId: q.id, contactId: q.contactId }; }
  if (entity === "ticket") { const t = await ctx.db.ticket.findFirst({ orderBy: { createdAt: "desc" } }); if (t) payload = { ...payload, ticketId: t.id, contactId: t.contactId }; }
  if (entity === "deal") { const d = await ctx.db.deal.findFirst({ orderBy: { createdAt: "desc" } }); if (d) payload = { ...payload, dealId: d.id, contactId: d.contactId }; }
  if (entity === "customer") { const c = await ctx.db.contact.findFirst({ orderBy: { createdAt: "desc" } }); if (c) payload = { ...payload, contactId: c.id }; }
  if (entity === "task") { const t = await ctx.db.task.findFirst({ orderBy: { createdAt: "desc" } }); if (t) payload = { ...payload, taskId: t.id }; }
  const run = await prisma.workflowRun.create({ data: { tenantId: ctx.tenant.id, workflowId: id, payload: normalizePayload(wf.trigger, payload), status: "waiting", nextRunAt: new Date() } });
  await processRun(run.id);
  await audit(ctx, "workflow.test_run", "Workflow", id, null, { runId: run.id });
  redirect(`/workflows/runs/${run.id}`);
});
}

export async function cancelRun(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  await ctx.db.workflowRun.updateMany({ where: { id, status: { in: ["waiting", "running"] } }, data: { status: "cancelled", finishedAt: new Date(), nextRunAt: null } });
  revalidatePath(`/workflows/runs/${id}`);
});
}

export async function saveTemplate(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  const id = String(fd.get("id") ?? "");
  const data = { name: String(fd.get("name")).trim(), channel: String(fd.get("channel")), subject: String(fd.get("subject") ?? "").trim() || null, body: String(fd.get("body")).trim() };
  if (!data.name || !data.body || !["email", "whatsapp", "sms"].includes(data.channel)) throw new Error("Name, channel and body are required");
  if (id) await ctx.db.messageTemplate.update({ where: { id }, data });
  else await ctx.db.messageTemplate.create({ data: { ...data, tenantId: ctx.tenant.id } });
  revalidatePath("/workflows/templates");
  redirect("/workflows/templates");
});
}

export async function deleteTemplate(id: string) {
  return guarded(async () => {
  const ctx = await authorize("workflow.manage");
  await ctx.db.messageTemplate.delete({ where: { id } });
  revalidatePath("/workflows/templates");
});
}
