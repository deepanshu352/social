import crypto from "node:crypto";
import { after } from "next/server";
import { prisma } from "./prisma";
import { notify } from "./notify";
import { send, render, templateVars, type Channel } from "./messaging";
import { autoAssignLead } from "./assignment";
import { nextNumber } from "./db";
import { audit } from "./audit";

/**
 * Workflow automation engine (BRD §61–63) — WHEN → IF → THEN → WAIT → ELSE.
 *
 *  Trigger   an event (lead.created…), a scanner (lead.idle, invoice.due_soon…) or a schedule (daily / weekly)
 *  Steps     action | wait | condition (with then / else branches, nestable)
 *  Runs      each execution is a WorkflowRun with a step pointer (`path`), a log, and nextRunAt for WAIT.
 *            Runs execute after the HTTP response (next/server `after`), and the scheduler tick
 *            (/api/cron/tick or the in-process scheduler) resumes waiting runs and runs scanners.
 *  Context   entities are re-loaded on every resume, so "WAIT 2h → IF no call was made" sees fresh data.
 */

export type Cond = { field: string; op: "eq" | "neq" | "in" | "contains" | "gte" | "lte" | "empty" | "not_empty"; value?: string };
export type ActionType =
  | "send_message" | "notify" | "create_task" | "create_followup" | "update_lead" | "add_tag" | "assign_lead"
  | "escalate" | "update_ticket" | "ai_qualify_lead" | "ai_triage_ticket" | "webhook" | "send_digest" | "stop";
export type Step =
  | { id: string; type: "action"; action: ActionType; config: Record<string, any> }
  | { id: string; type: "wait"; amount: number; unit: "minutes" | "hours" | "days" }
  | { id: string; type: "condition"; match?: "all" | "any"; conditions: Cond[]; then: Step[]; else: Step[] };
type Path = (number | "then" | "else")[];

export const TRIGGERS: { key: string; label: string; kind: "event" | "scan" | "schedule"; group: string; config?: { key: string; label: string; type: "number" | "time" | "weekday"; default: number | string }[] }[] = [
  { key: "lead.created", label: "Lead is created", kind: "event", group: "Leads" },
  { key: "lead.assigned", label: "Lead is assigned", kind: "event", group: "Leads" },
  { key: "lead.status_changed", label: "Lead status changes", kind: "event", group: "Leads" },
  { key: "lead.idle", label: "Lead has no activity for N days", kind: "scan", group: "Leads", config: [{ key: "days", label: "Days idle", type: "number", default: 3 }] },
  { key: "call.completed", label: "Call outcome is saved", kind: "event", group: "Calling" },
  { key: "followup.missed", label: "Follow-up is missed", kind: "event", group: "Calling" },
  { key: "deal.won", label: "Deal is won", kind: "event", group: "Sales" },
  { key: "deal.lost", label: "Deal is lost", kind: "event", group: "Sales" },
  { key: "quotation.accepted", label: "Quotation is accepted", kind: "event", group: "Sales" },
  { key: "quotation.pending", label: "Quotation not accepted after N days", kind: "scan", group: "Sales", config: [{ key: "days", label: "Days after sending", type: "number", default: 2 }] },
  { key: "invoice.issued", label: "Invoice is issued", kind: "event", group: "Finance" },
  { key: "invoice.due_soon", label: "Invoice due in N days", kind: "scan", group: "Finance", config: [{ key: "days", label: "Days before due", type: "number", default: 3 }] },
  { key: "invoice.overdue", label: "Invoice becomes overdue", kind: "event", group: "Finance" },
  { key: "invoice.paid", label: "Invoice is fully paid", kind: "event", group: "Finance" },
  { key: "payment.received", label: "Payment is received", kind: "event", group: "Finance" },
  { key: "customer.inactive", label: "Customer hasn't bought in N days", kind: "scan", group: "Customers", config: [{ key: "days", label: "Days since last invoice", type: "number", default: 90 }] },
  { key: "ticket.created", label: "Support ticket is created", kind: "event", group: "Support" },
  { key: "ticket.sla_breach", label: "Ticket breaches SLA", kind: "scan", group: "Support" },
  { key: "task.overdue", label: "Task is overdue", kind: "scan", group: "Work" },
  { key: "expense.submitted", label: "Expense is submitted", kind: "event", group: "People" },
  { key: "leave.requested", label: "Leave is requested", kind: "event", group: "People" },
  { key: "stock.low", label: "Product stock falls below minimum", kind: "event", group: "Inventory" },
  { key: "schedule.daily", label: "Every day at a time", kind: "schedule", group: "Schedule", config: [{ key: "time", label: "Time (24h)", type: "time", default: "09:00" }] },
  { key: "schedule.weekly", label: "Every week", kind: "schedule", group: "Schedule", config: [{ key: "weekday", label: "Weekday (1=Mon)", type: "weekday", default: 1 }, { key: "time", label: "Time", type: "time", default: "09:00" }] },
];

export const ACTIONS: { key: ActionType; label: string; group: string }[] = [
  { key: "send_message", label: "Send email / WhatsApp / SMS", group: "Communicate" },
  { key: "notify", label: "Notify a person or role", group: "Communicate" },
  { key: "send_digest", label: "Send daily business digest", group: "Communicate" },
  { key: "create_task", label: "Create a task", group: "Work" },
  { key: "create_followup", label: "Schedule a follow-up call", group: "Work" },
  { key: "assign_lead", label: "Assign / re-assign lead", group: "Records" },
  { key: "update_lead", label: "Update lead status / priority", group: "Records" },
  { key: "add_tag", label: "Add tag to lead", group: "Records" },
  { key: "update_ticket", label: "Update ticket", group: "Records" },
  { key: "escalate", label: "Escalate to manager", group: "Records" },
  { key: "ai_qualify_lead", label: "AI: qualify lead & draft first message", group: "AI" },
  { key: "ai_triage_ticket", label: "AI: categorise ticket & suggest reply", group: "AI" },
  { key: "webhook", label: "Call a webhook (HTTPS)", group: "Integrations" },
  { key: "stop", label: "Stop workflow", group: "Flow" },
];

export const CONDITION_FIELDS = [
  "lead.status", "lead.source", "lead.city", "lead.priority", "lead.score", "lead.score_band", "lead.budget", "lead.owner_id", "lead.calls_since_start", "lead.connected_since_start", "lead.tags",
  "invoice.status", "invoice.balance", "invoice.total", "invoice.days_overdue",
  "quotation.status", "quotation.total", "contact.dnd", "contact.lifetime_value",
  "ticket.status", "ticket.priority", "ticket.category", "deal.amount", "task.status", "event.disposition", "event.amount", "event.status",
];

export const newStepId = () => crypto.randomUUID().slice(0, 8);

// ───────────────────────────── context ─────────────────────────────

type Ctx = Record<string, any>;
const rupees = (v: bigint | number | null | undefined) => (v == null ? null : Number(v) / 100);

const ID_KEYS: Record<string, string> = { lead: "leadId", invoice: "invoiceId", quotation: "quotationId", ticket: "ticketId", deal: "dealId", task: "taskId", expense: "expenseId", customer: "contactId" };

export function normalizePayload(trigger: string, payload: Record<string, any>) {
  const p = { ...payload };
  const k = ID_KEYS[trigger.split(".")[0]];
  if (k && !p[k] && p.id) p[k] = p.id;
  return p;
}

async function loadContext(tenantId: string, payload: Record<string, any>, startedAt = new Date()): Promise<Ctx> {
  const [lead, invoice, quotation, ticket, deal, task] = await Promise.all([
    payload.leadId ? prisma.lead.findFirst({ where: { id: payload.leadId, tenantId } }) : null,
    payload.invoiceId ? prisma.invoice.findFirst({ where: { id: payload.invoiceId, tenantId } }) : null,
    payload.quotationId ? prisma.quotation.findFirst({ where: { id: payload.quotationId, tenantId } }) : null,
    payload.ticketId ? prisma.ticket.findFirst({ where: { id: payload.ticketId, tenantId } }) : null,
    payload.dealId ? prisma.deal.findFirst({ where: { id: payload.dealId, tenantId } }) : null,
    payload.taskId ? prisma.task.findFirst({ where: { id: payload.taskId, tenantId } }) : null,
  ]);
  const contactId = payload.contactId ?? invoice?.contactId ?? quotation?.contactId ?? ticket?.contactId ?? deal?.contactId ?? lead?.contactId ?? null;
  const contact = contactId ? await prisma.contact.findFirst({ where: { id: contactId, tenantId } }) : null;
  const ctx: Ctx = { event: payload, _ids: { leadId: lead?.id ?? null, contactId, invoiceId: invoice?.id ?? null, quotationId: quotation?.id ?? null, ticketId: ticket?.id ?? null, dealId: deal?.id ?? null, taskId: task?.id ?? null } };
  if (lead) {
    const [calls, connected] = await Promise.all([
      prisma.callLog.count({ where: { tenantId, leadId: lead.id, startedAt: { gte: startedAt } } }),
      prisma.callLog.count({ where: { tenantId, leadId: lead.id, startedAt: { gte: startedAt }, talkSeconds: { gt: 0 } } }),
    ]);
    ctx.lead = { ...lead, budget: rupees(lead.budget), score_band: lead.scoreBand, owner_id: lead.ownerId, calls_since_start: calls, connected_since_start: connected, tags: lead.tags.join(",") };
  }
  if (invoice) ctx.invoice = { ...invoice, total: rupees(invoice.total), balance: rupees(invoice.balance), days_overdue: Math.max(0, Math.floor((Date.now() - invoice.dueDate.getTime()) / 86400_000)) };
  if (quotation) ctx.quotation = { ...quotation, total: rupees(quotation.total) };
  if (ticket) ctx.ticket = ticket;
  if (deal) ctx.deal = { ...deal, amount: rupees(deal.amount) };
  if (task) ctx.task = task;
  if (contact) {
    const ltv = await prisma.invoice.aggregate({ where: { tenantId, contactId: contact.id, status: { notIn: ["draft", "cancelled"] } }, _sum: { total: true } });
    ctx.contact = { ...contact, lifetime_value: rupees(ltv._sum.total ?? 0n) };
  }
  // Money in event payloads is always paise (see emit); expose rupees to conditions & templates.
  const ev: Record<string, any> = { ...payload };
  for (const k of ["amount", "total", "balance"]) if (typeof ev[k] === "number") ev[k] = ev[k] / 100;
  ctx.event = ev;
  ctx._owner = lead?.ownerId ?? deal?.ownerId ?? ticket?.assigneeId ?? task?.assigneeId ?? invoice?.ownerId ?? quotation?.ownerId ?? payload.ownerId ?? payload.agentId ?? payload.membershipId ?? null;
  return ctx;
}

const get = (o: Ctx, path: string) => path.split(".").reduce<any>((x, k) => (x == null ? undefined : x[k]), o);

export function evalConds(conds: Cond[], ctx: Ctx, match: "all" | "any" = "all") {
  if (!conds?.length) return true;
  const test = (c: Cond) => {
    const raw = get(ctx, c.field);
    const v = raw == null ? "" : String(raw).toLowerCase();
    const t = String(c.value ?? "").toLowerCase();
    switch (c.op) {
      case "eq": return v === t;
      case "neq": return v !== t;
      case "in": return t.split(",").map((s) => s.trim()).includes(v);
      case "contains": return v.includes(t);
      case "gte": return Number(raw) >= Number(c.value);
      case "lte": return Number(raw) <= Number(c.value);
      case "empty": return v === "" || v === "0" || v === "false";
      case "not_empty": return !(v === "" || v === "0" || v === "false");
      default: return false;
    }
  };
  return match === "any" ? conds.some(test) : conds.every(test);
}

// ───────────────────────────── step navigation ─────────────────────────────

function listAt(steps: Step[], parent: Path): Step[] {
  let list = steps;
  for (let i = 0; i < parent.length; i += 2) {
    const s = list[parent[i] as number];
    if (!s || s.type !== "condition") return [];
    list = s[parent[i + 1] as "then" | "else"] ?? [];
  }
  return list;
}
function stepAt(steps: Step[], path: Path): Step | undefined {
  return listAt(steps, path.slice(0, -1))[path[path.length - 1] as number];
}
function nextPath(steps: Step[], path: Path): Path | null {
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1] as number;
  if (idx + 1 < listAt(steps, parent).length) return [...parent, idx + 1];
  if (!parent.length) return null;
  return nextPath(steps, parent.slice(0, -1));
}

// ───────────────────────────── start & run ─────────────────────────────

/** Called for every domain event (lib/events.ts emit). */
export async function startWorkflows(tenantId: string, trigger: string, rawPayload: Record<string, any>) {
  const wfs = await prisma.workflow.findMany({ where: { tenantId, trigger, isActive: true } });
  if (!wfs.length) return;
  const payload = normalizePayload(trigger, rawPayload);
  for (const wf of wfs) await startRun(wf.id, tenantId, payload, null);
}

async function startRun(workflowId: string, tenantId: string, payload: Record<string, any>, dedupeKey: string | null) {
  const wf = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!wf) return null;
  const ctx = await loadContext(tenantId, payload);
  if (!evalConds(wf.conditions as Cond[], ctx)) return null;
  try {
    const run = await prisma.workflowRun.create({ data: { tenantId, workflowId, payload, status: "waiting", nextRunAt: new Date(), dedupeKey, path: [0] } });
    schedule(run.id);
    return run;
  } catch (e: any) {
    if (e?.code === "P2002") return null; // already ran for this dedupe key
    throw e;
  }
}

/** Run after the response when inside a request; otherwise immediately (cron / scripts). */
function schedule(runId: string) {
  try {
    after(() => processRun(runId));
  } catch {
    void processRun(runId);
  }
}

/** Atomically claims and executes a run until it completes, fails or reaches a WAIT. */
export async function processRun(runId: string) {
  const claimed = await prisma.workflowRun.updateMany({ where: { id: runId, status: "waiting", nextRunAt: { lte: new Date() } }, data: { status: "running" } });
  if (!claimed.count) return;
  const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId }, include: { workflow: true } });
  const steps = (run.workflow.steps ?? []) as Step[];
  const log = (run.log ?? []) as any[];
  let path: Path | null = run.path as Path;
  let status = "running", nextRunAt: Date | null = null, error: string | null = null;

  try {
    for (let guard = 0; guard < 60 && path; guard++) {
      const step = stepAt(steps, path);
      if (!step) { path = null; break; }
      const ctx = await loadContext(run.tenantId, run.payload as Record<string, any>, run.startedAt);
      if (step.type === "wait") {
        const ms = step.amount * (step.unit === "days" ? 86400_000 : step.unit === "hours" ? 3600_000 : 60_000);
        nextRunAt = new Date(Date.now() + ms);
        log.push({ at: new Date(), step: step.id, type: "wait", text: `Waiting ${step.amount} ${step.unit} (until ${nextRunAt.toISOString()})` });
        path = nextPath(steps, path);
        status = path ? "waiting" : "completed";
        break;
      }
      if (step.type === "condition") {
        const ok = evalConds(step.conditions, ctx, step.match);
        const branch = ok ? "then" : "else";
        log.push({ at: new Date(), step: step.id, type: "condition", text: `Condition ${ok ? "met → THEN" : "not met → ELSE"}` });
        path = (step[branch]?.length ? [...path, branch, 0] : nextPath(steps, path)) as Path | null;
        continue;
      }
      if (step.action === "stop") { log.push({ at: new Date(), step: step.id, type: "action", text: "Stopped" }); path = null; break; }
      const text = await runAction(run.tenantId, run.id, run.workflow.name, step.action, step.config ?? {}, ctx);
      log.push({ at: new Date(), step: step.id, type: "action", action: step.action, text });
      path = nextPath(steps, path);
    }
    if (!path && status === "running") status = "completed";
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
    log.push({ at: new Date(), type: "error", text: error });
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status, path: path ?? undefined, nextRunAt, log, error, finishedAt: ["completed", "failed"].includes(status) ? new Date() : null },
  });
  if (status === "completed" || status === "failed") {
    await prisma.workflow.update({ where: { id: run.workflowId }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), ...(status === "failed" ? { failCount: { increment: 1 } } : {}) } });
  }
}

async function managerOf(tenantId: string, membershipId?: string | null) {
  if (membershipId) {
    const m = await prisma.membership.findFirst({ where: { id: membershipId, tenantId } });
    if (m?.managerId) return m.managerId;
  }
  const admin = await prisma.membership.findFirst({ where: { tenantId, status: "active", role: { key: "admin" } }, orderBy: { createdAt: "asc" } });
  return admin?.id ?? null;
}

async function recipients(tenantId: string, spec: string | undefined, ctx: Ctx): Promise<string[]> {
  const s = spec || "owner";
  if (s === "owner") return ctx._owner ? [ctx._owner] : (await managerOf(tenantId)) ? [(await managerOf(tenantId))!] : [];
  if (s === "manager") { const m = await managerOf(tenantId, ctx._owner); return m ? [m] : []; }
  if (s.startsWith("member:")) return [s.slice(7)];
  if (s.startsWith("role:")) return (await prisma.membership.findMany({ where: { tenantId, status: "active", role: { key: s.slice(5) } }, select: { id: true } })).map((m) => m.id);
  return [];
}

async function runAction(tenantId: string, runId: string, wfName: string, action: ActionType, cfg: Record<string, any>, ctx: Ctx): Promise<string> {
  const ids = ctx._ids as Record<string, string | null>;
  const vars = { ...(await templateVars(tenantId, ids)), event: ctx.event };
  switch (action) {
    case "send_message": {
      let subject: string | null = cfg.subject ?? null, body: string = cfg.body ?? "", channel: Channel = cfg.channel ?? "whatsapp";
      if (cfg.templateId) {
        const t = await prisma.messageTemplate.findFirst({ where: { id: cfg.templateId, tenantId } });
        if (!t) return "Template not found — skipped";
        subject = t.subject; body = t.body; channel = t.channel as Channel;
      }
      if (cfg.to === "owner") {
        const ms = await recipients(tenantId, "owner", ctx);
        for (const m of ms) await notify(tenantId, m, render(subject ?? wfName, vars), render(body, vars));
        return `Notified owner: ${render(body, vars).slice(0, 80)}`;
      }
      const to = channel === "email" ? (vars as any)._to.email : (vars as any)._to.phone;
      const log = await send({ tenantId, channel, to, subject: subject ? render(subject, vars) : null, body: render(body, vars), leadId: ids.leadId, contactId: ids.contactId, workflowRunId: runId });
      return `${channel} → ${log.to}: ${log.status}${log.error ? ` (${log.error})` : ""}`;
    }
    case "notify": {
      const ms = await recipients(tenantId, cfg.to, ctx);
      const link = ids.leadId ? `/leads/${ids.leadId}` : ids.invoiceId ? `/invoices/${ids.invoiceId}` : ids.ticketId ? `/tickets?id=${ids.ticketId}` : ids.taskId ? `/tasks` : ids.contactId ? `/contacts/${ids.contactId}` : undefined;
      for (const m of ms) await notify(tenantId, m, render(cfg.title || wfName, vars), render(cfg.body || "", vars), link);
      return `Notified ${ms.length} person(s)`;
    }
    case "create_task": {
      const [assignee] = await recipients(tenantId, cfg.assignTo, ctx);
      const t = await prisma.task.create({
        data: {
          tenantId, number: await nextNumber(tenantId, "task"), title: render(cfg.title || wfName, vars), description: cfg.description ? render(cfg.description, vars) : `Created by workflow “${wfName}”`,
          assigneeId: assignee ?? null, priority: cfg.priority ?? "medium", dueAt: new Date(Date.now() + Number(cfg.dueInHours ?? 24) * 3600_000),
          leadId: ids.leadId, contactId: ids.contactId, source: "workflow",
        },
      });
      if (assignee) await notify(tenantId, assignee, `New task: ${t.title}`, `Due ${t.dueAt?.toLocaleString("en-IN")}`, "/tasks");
      return `Task T-${t.number} created`;
    }
    case "create_followup": {
      if (!ids.leadId && !ids.contactId) return "No lead/customer in context — skipped";
      const [assignee] = await recipients(tenantId, cfg.assignTo, ctx);
      if (!assignee) return "No assignee — skipped";
      const dueAt = new Date(Date.now() + Number(cfg.inHours ?? 2) * 3600_000);
      await prisma.followUp.create({ data: { tenantId, leadId: ids.leadId, contactId: ids.leadId ? null : ids.contactId, assigneeId: assignee, dueAt, note: render(cfg.note || wfName, vars) } });
      if (ids.leadId) {
        const next = await prisma.followUp.findFirst({ where: { tenantId, leadId: ids.leadId, status: "pending" }, orderBy: { dueAt: "asc" } });
        await prisma.lead.update({ where: { id: ids.leadId }, data: { nextFollowUpAt: next?.dueAt ?? dueAt } });
      }
      return `Follow-up scheduled for ${dueAt.toISOString()}`;
    }
    case "update_lead": {
      if (!ids.leadId) return "No lead — skipped";
      const field = cfg.field === "priority" ? "priority" : "status";
      const allowed = field === "priority" ? ["low", "medium", "high", "urgent"] : ["new", "contacted", "qualified", "unqualified", "lost"];
      if (!allowed.includes(cfg.value)) return `Invalid ${field} — skipped`;
      await prisma.lead.update({ where: { id: ids.leadId }, data: { [field]: cfg.value, ...(field === "status" && cfg.value === "lost" ? { lostReason: `Workflow: ${wfName}` } : {}) } });
      await prisma.activity.create({ data: { tenantId, leadId: ids.leadId, type: "system", body: `Workflow “${wfName}” set ${field} → ${cfg.value}` } });
      return `Lead ${field} → ${cfg.value}`;
    }
    case "add_tag": {
      if (!ids.leadId || !cfg.tag) return "No lead/tag — skipped";
      const l = await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadId } });
      if (!l.tags.includes(cfg.tag)) await prisma.lead.update({ where: { id: l.id }, data: { tags: [...l.tags, cfg.tag] } });
      return `Tagged “${cfg.tag}”`;
    }
    case "assign_lead": {
      if (!ids.leadId) return "No lead — skipped";
      if (cfg.mode === "member" && cfg.memberId) {
        await prisma.lead.update({ where: { id: ids.leadId }, data: { ownerId: cfg.memberId, assignedAt: new Date() } });
        await notify(tenantId, cfg.memberId, "Lead assigned to you by workflow", wfName, `/leads/${ids.leadId}`);
        return "Assigned to member";
      }
      const prev = ctx.lead?.ownerId;
      await prisma.lead.update({ where: { id: ids.leadId }, data: { ownerId: null } });
      const owner = await autoAssignLead(tenantId, ids.leadId);
      if (!owner && prev) await prisma.lead.update({ where: { id: ids.leadId }, data: { ownerId: prev } });
      return owner ? `Re-assigned by rules${owner === prev ? " (same owner)" : ""}` : "No rule matched — owner unchanged";
    }
    case "escalate": {
      const [mgr] = await recipients(tenantId, "manager", ctx);
      if (ids.leadId) await prisma.lead.update({ where: { id: ids.leadId }, data: { priority: "urgent" } });
      if (ids.ticketId) await prisma.ticket.update({ where: { id: ids.ticketId }, data: { priority: "urgent" } });
      if (mgr) await notify(tenantId, mgr, `Escalation: ${wfName}`, render(cfg.note || "Needs your attention", vars), ids.leadId ? `/leads/${ids.leadId}` : ids.ticketId ? `/tickets?id=${ids.ticketId}` : undefined);
      return `Escalated to manager${mgr ? "" : " (none found)"}`;
    }
    case "update_ticket": {
      if (!ids.ticketId) return "No ticket — skipped";
      const data: Record<string, string> = {};
      if (["low", "medium", "high", "urgent"].includes(cfg.priority)) data.priority = cfg.priority;
      if (["open", "in_progress", "resolved", "closed"].includes(cfg.status)) data.status = cfg.status;
      await prisma.ticket.update({ where: { id: ids.ticketId }, data });
      return `Ticket updated ${JSON.stringify(data)}`;
    }
    case "ai_qualify_lead": {
      if (!ids.leadId) return "No lead — skipped";
      const { aiEnabled, aiQualifyLeadSystem } = await import("./ai");
      if (!aiEnabled()) return "AI not configured — skipped";
      return aiQualifyLeadSystem(tenantId, ids.leadId);
    }
    case "ai_triage_ticket": {
      if (!ids.ticketId) return "No ticket — skipped";
      const { aiEnabled, aiTriageTicketSystem } = await import("./ai");
      if (!aiEnabled()) return "AI not configured — skipped";
      return aiTriageTicketSystem(tenantId, ids.ticketId);
    }
    case "webhook": {
      if (!/^https:\/\//.test(cfg.url ?? "")) return "Webhook URL must be https — skipped";
      const body = JSON.stringify({ workflow: wfName, event: ctx.event, ids });
      const secret = (await prisma.webhook.findFirst({ where: { tenantId } }))?.secret;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secret) headers["x-bizos-signature"] = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
      const r = await fetch(cfg.url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) }).catch(() => null);
      return `Webhook → ${r?.status ?? "network error"}`;
    }
    case "send_digest": {
      const ms = await recipients(tenantId, cfg.to || "role:admin", ctx);
      const digest = await dailyDigest(tenantId);
      for (const m of ms) {
        await notify(tenantId, m, "Your daily business digest", digest.slice(0, 900), "/dashboard");
        const mem = await prisma.membership.findUnique({ where: { id: m }, include: { user: true } });
        if (mem && cfg.email) await send({ tenantId, channel: "email", to: mem.user.email, subject: "Daily business digest", body: digest, workflowRunId: runId });
      }
      return `Digest sent to ${ms.length}`;
    }
    default:
      return `Unknown action ${action}`;
  }
}

export async function dailyDigest(tenantId: string) {
  const since = new Date(Date.now() - 86400_000), now = new Date();
  const [leads, calls, conn, paid, overdue, fu, tickets, tasks] = await Promise.all([
    prisma.lead.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.callLog.count({ where: { tenantId, startedAt: { gte: since } } }),
    prisma.callLog.count({ where: { tenantId, startedAt: { gte: since }, talkSeconds: { gt: 0 } } }),
    prisma.payment.aggregate({ where: { tenantId, receivedOn: { gte: since } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { tenantId, status: { in: ["issued", "partially_paid", "overdue"] }, dueDate: { lt: now } }, _sum: { balance: true }, _count: true }),
    prisma.followUp.count({ where: { tenantId, status: "pending", dueAt: { lt: new Date(now.getTime() + 86400_000) } } }),
    prisma.ticket.count({ where: { tenantId, status: { in: ["open", "in_progress"] }, dueAt: { lt: now } } }),
    prisma.task.count({ where: { tenantId, status: { not: "done" }, dueAt: { lt: now } } }),
  ]);
  const inr = (p?: bigint | null) => `₹${(Number(p ?? 0n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return [
    `Last 24 hours: ${leads} new leads · ${calls} calls (${conn} connected) · ${inr(paid._sum.amount)} collected.`,
    `Needs attention: ${overdue._count} overdue invoices (${inr(overdue._sum.balance)}) · ${fu} follow-ups due · ${tickets} tickets past SLA · ${tasks} overdue tasks.`,
  ].join("\n");
}

// ───────────────────────────── scheduler tick ─────────────────────────────

function tenantClock(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute), weekday: wd };
}

async function scan(wf: { id: string; tenantId: string; trigger: string; triggerConfig: any }) {
  const cfg = (wf.triggerConfig ?? {}) as Record<string, any>;
  const t = wf.tenantId, now = new Date();
  const days = Number(cfg.days ?? 3);
  const start = (payload: Record<string, any>, key: string) => startRun(wf.id, t, payload, key);
  let started = 0;
  const go = async (p: Promise<unknown>) => { if (await p) started++; };
  switch (wf.trigger) {
    case "lead.idle": {
      const leads = await prisma.lead.findMany({ where: { tenantId: t, deletedAt: null, status: { in: ["new", "contacted", "qualified"] }, lastActivityAt: { lt: new Date(now.getTime() - days * 86400_000) } }, take: 200 });
      for (const l of leads) await go(start({ leadId: l.id, ownerId: l.ownerId }, `${l.id}:${l.lastActivityAt?.toISOString().slice(0, 10)}`));
      break;
    }
    case "invoice.due_soon": {
      const inv = await prisma.invoice.findMany({ where: { tenantId: t, status: { in: ["issued", "partially_paid"] }, dueDate: { gte: now, lte: new Date(now.getTime() + days * 86400_000) } }, take: 200 });
      for (const i of inv) await go(start({ invoiceId: i.id, contactId: i.contactId, ownerId: i.ownerId }, `${i.id}:${i.dueDate.toISOString().slice(0, 10)}`));
      break;
    }
    case "quotation.pending": {
      const qs = await prisma.quotation.findMany({ where: { tenantId: t, status: { in: ["sent", "viewed"] }, updatedAt: { lt: new Date(now.getTime() - days * 86400_000) }, validUntil: { gt: now } }, take: 200 });
      for (const q of qs) await go(start({ quotationId: q.id, contactId: q.contactId, ownerId: q.ownerId }, q.id));
      break;
    }
    case "customer.inactive": {
      const g = await prisma.invoice.groupBy({ by: ["contactId"], where: { tenantId: t, status: { notIn: ["draft", "cancelled"] } }, _max: { issueDate: true } });
      const month = now.toISOString().slice(0, 7);
      for (const x of g.filter((x) => x._max.issueDate && x._max.issueDate < new Date(now.getTime() - Number(cfg.days ?? 90) * 86400_000)).slice(0, 200)) {
        const c = await prisma.contact.findUnique({ where: { id: x.contactId } });
        await go(start({ contactId: x.contactId, ownerId: c?.ownerId }, `${x.contactId}:${month}`));
      }
      break;
    }
    case "ticket.sla_breach": {
      const ts = await prisma.ticket.findMany({ where: { tenantId: t, status: { in: ["open", "in_progress"] }, dueAt: { lt: now } }, take: 200 });
      for (const k of ts) await go(start({ ticketId: k.id, contactId: k.contactId, ownerId: k.assigneeId }, `${k.id}:${k.dueAt?.toISOString()}`));
      break;
    }
    case "task.overdue": {
      const ts = await prisma.task.findMany({ where: { tenantId: t, status: { not: "done" }, dueAt: { lt: now } }, take: 200 });
      for (const k of ts) await go(start({ taskId: k.id, ownerId: k.assigneeId }, `${k.id}:${k.dueAt?.toISOString()}`));
      break;
    }
    case "schedule.daily":
    case "schedule.weekly": {
      const tenant = await prisma.tenant.findUnique({ where: { id: t } });
      const clock = tenantClock(tenant?.timezone ?? "Asia/Kolkata");
      const [h, m] = String(cfg.time ?? "09:00").split(":").map(Number);
      if (clock.minutes < h * 60 + (m || 0)) break;
      if (wf.trigger === "schedule.weekly" && clock.weekday !== Number(cfg.weekday ?? 1)) break;
      await go(start({ date: clock.date }, `${wf.trigger}:${clock.date}`));
      break;
    }
  }
  return started;
}

/** One scheduler tick: resume due WAIT steps, then run scanners (each workflow at most every 10 minutes). */
export async function tick(opts: { force?: boolean } = {}) {
  const due = await prisma.workflowRun.findMany({ where: { status: "waiting", nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: "asc" }, take: 100, select: { id: true } });
  for (const r of due) await processRun(r.id);
  const scanTriggers = TRIGGERS.filter((t) => t.kind !== "event").map((t) => t.key);
  const wfs = await prisma.workflow.findMany({
    where: { isActive: true, trigger: { in: scanTriggers }, ...(opts.force ? {} : { OR: [{ lastScanAt: null }, { lastScanAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }) },
  });
  let started = 0;
  for (const wf of wfs) {
    await prisma.workflow.update({ where: { id: wf.id }, data: { lastScanAt: new Date() } });
    started += await scan(wf);
  }
  // Runs started by scanners are queued as "waiting/now" — execute them in this tick.
  const fresh = await prisma.workflowRun.findMany({ where: { status: "waiting", nextRunAt: { lte: new Date() } }, take: 200, select: { id: true } });
  for (const r of fresh) await processRun(r.id);
  return { resumed: due.length, scanned: wfs.length, started };
}

export async function logWorkflowChange(ctx: { tenant: { id: string }; membership: { id: string }; user: { name: string } }, action: string, id: string, data?: unknown) {
  await audit(ctx as any, action, "Workflow", id, null, data);
}
