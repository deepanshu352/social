import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool, betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Ctx } from "./auth";
import { can, has, scopeWhere } from "./auth";
import { prisma } from "./prisma";
import { inr } from "./money";
import { audit } from "./audit";
import { daysAgo } from "./utils";
import { nextNumber } from "./db";

/**
 * AI platform layer (BRD §93–97).
 *  - Every tool runs with the signed-in user's RBAC scope: the AI can never see more than the user.
 *  - Only low-risk actions are exposed as tools (create follow-up). High-risk actions are not tools at all.
 *  - Every request is metered into AiUsage for per-tenant cost tracking.
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";
// Opus 5.5 list price, USD per 1M tokens (input / output) — used for estimated cost.
const PRICE = { in: 4, out: 20 };

export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

type Who = Ctx | { tenantId: string; membershipId?: string | null };
async function track(who: Who, feature: string, usage: { input_tokens: number; output_tokens: number }) {
  const tenantId = "tenant" in who ? who.tenant.id : who.tenantId;
  const membershipId = "membership" in who ? who.membership.id : who.membershipId ?? null;
  await prisma.aiUsage.create({
    data: {
      tenantId, membershipId, feature, model: AI_MODEL,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      costMicroUsd: Math.round(usage.input_tokens * PRICE.in + usage.output_tokens * PRICE.out),
    },
  });
}

export async function aiQuotaOk(ctx: Ctx) {
  const used = await ctx.db.aiUsage.count({ where: { createdAt: { gte: daysAgo(30) } } });
  return used < ctx.plan.limits.aiRequests;
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

export function aiErrorMessage(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return "AI is not configured correctly (invalid API key).";
  if (e instanceof Anthropic.RateLimitError) return "AI is busy right now — please retry in a minute.";
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? "network"}). Please retry.`;
  return e instanceof Error ? e.message : "AI request failed.";
}

// ───────────────────────────── Copilot tools ─────────────────────────────

function copilotTools(ctx: Ctx) {
  const db = ctx.db;
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) / 100 : x));
  const denied = (p: string) => `Permission denied: the current user lacks "${p}". Tell the user you cannot access this.`;

  const businessOverview = betaZodTool({
    name: "business_overview",
    description: "Key business metrics for the last N days: revenue invoiced & collected (INR), new leads, conversions, calls, outstanding & overdue receivables. Amounts are in rupees.",
    inputSchema: z.object({ days: z.number().int().min(1).max(365).describe("Look-back window in days, e.g. 1 for today, 7, 30") }),
    run: async ({ days }) => {
      const since = daysAgo(days);
      const leadW = await scopeWhere(ctx, "lead.view");
      const [newLeads, converted, calls, connected] = await Promise.all([
        db.lead.count({ where: { ...leadW, createdAt: { gte: since }, deletedAt: null } }),
        db.lead.count({ where: { ...leadW, status: "converted", updatedAt: { gte: since } } }),
        has(ctx, "call.view") ? db.callLog.count({ where: { ...(await scopeWhere(ctx, "call.view", "agentId", null)), startedAt: { gte: since } } }) : null,
        has(ctx, "call.view") ? db.callLog.count({ where: { ...(await scopeWhere(ctx, "call.view", "agentId", null)), startedAt: { gte: since }, talkSeconds: { gt: 0 } } }) : null,
      ]);
      const out: Record<string, unknown> = { window_days: days, new_leads: newLeads, leads_converted: converted, calls, calls_connected: connected };
      if (has(ctx, "report.view")) {
        const [inv, paid, outstanding, overdue] = await Promise.all([
          db.invoice.aggregate({ where: { issueDate: { gte: since }, status: { notIn: ["draft", "cancelled"] } }, _sum: { total: true }, _count: true }),
          db.payment.aggregate({ where: { receivedOn: { gte: since } }, _sum: { amount: true } }),
          db.invoice.aggregate({ where: { status: { in: ["issued", "partially_paid", "overdue"] } }, _sum: { balance: true } }),
          db.invoice.aggregate({ where: { status: { in: ["issued", "partially_paid", "overdue"] }, dueDate: { lt: new Date() } }, _sum: { balance: true }, _count: true }),
        ]);
        Object.assign(out, {
          revenue_invoiced: inv._sum.total ?? 0n, invoices_issued: inv._count, collected: paid._sum.amount ?? 0n,
          receivables_outstanding: outstanding._sum.balance ?? 0n, overdue_amount: overdue._sum.balance ?? 0n, overdue_invoices: overdue._count,
        });
      } else out.revenue = "hidden — user lacks report.view";
      return json(out);
    },
  });

  const findLeads = betaZodTool({
    name: "find_leads",
    description: "Search leads the user can see. Use for questions like 'hot leads without follow-up', 'new leads from Facebook', 'leads in Lucknow'. Returns up to `limit` leads with score, status, owner and last activity.",
    inputSchema: z.object({
      status: z.enum(["new", "contacted", "qualified", "unqualified", "converted", "lost"]).optional(),
      score_band: z.enum(["hot", "warm", "cold"]).optional(),
      source: z.string().optional().describe("e.g. facebook, google_ads, website, referral"),
      city: z.string().optional(),
      no_followup: z.boolean().optional().describe("Only leads with no follow-up scheduled"),
      idle_days: z.number().int().optional().describe("Only leads with no activity for at least this many days"),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async (q) => {
      if (!has(ctx, "lead.view")) return denied("lead.view");
      const where: Record<string, unknown> = { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null };
      if (q.status) where.status = q.status;
      if (q.score_band) where.scoreBand = q.score_band;
      if (q.source) where.source = q.source;
      if (q.city) where.city = { equals: q.city, mode: "insensitive" };
      if (q.no_followup) where.nextFollowUpAt = null;
      if (q.idle_days) where.OR = [{ lastActivityAt: null }, { lastActivityAt: { lt: daysAgo(q.idle_days) } }];
      const [total, leads] = await Promise.all([
        db.lead.count({ where }),
        db.lead.findMany({ where, orderBy: { score: "desc" }, take: q.limit ?? 15, include: { owner: { include: { user: true } } } }),
      ]);
      return json({
        total_matching: total,
        leads: leads.map((l) => ({
          number: l.number, name: l.name, company: l.companyName, status: l.status, score: l.score, band: l.scoreBand,
          source: l.source, city: l.city, budget_inr: l.budget, owner: l.owner?.user.name ?? "unassigned",
          next_follow_up: l.nextFollowUpAt, last_activity: l.lastActivityAt, link: `/leads/${l.id}`,
        })),
      });
    },
  });

  const overdueInvoices = betaZodTool({
    name: "overdue_invoices",
    description: "List unpaid invoices past their due date, optionally above a minimum balance in rupees, with customer and days overdue.",
    inputSchema: z.object({ min_amount_rupees: z.number().optional() }),
    run: async ({ min_amount_rupees }) => {
      if (!has(ctx, "invoice.view")) return denied("invoice.view");
      const invs = await db.invoice.findMany({
        where: {
          ...(await scopeWhere(ctx, "invoice.view")), status: { in: ["issued", "partially_paid", "overdue"] }, dueDate: { lt: new Date() },
          ...(min_amount_rupees ? { balance: { gte: BigInt(Math.round(min_amount_rupees * 100)) } } : {}),
        },
        include: { contact: true }, orderBy: { balance: "desc" }, take: 30,
      });
      return json(invs.map((i) => ({
        number: i.number, customer: i.contact.name, balance_inr: i.balance, total_inr: i.total,
        days_overdue: Math.floor((Date.now() - i.dueDate.getTime()) / 86400_000), link: `/invoices/${i.id}`,
      })));
    },
  });

  const teamPerformance = betaZodTool({
    name: "team_performance",
    description: "Per-salesperson / telecaller performance for the last N days: calls, connected calls, talk minutes, leads converted, deals won value.",
    inputSchema: z.object({ days: z.number().int().min(1).max(365) }),
    run: async ({ days }) => {
      if (!has(ctx, "call.view") && !has(ctx, "report.view")) return denied("report.view");
      const since = daysAgo(days);
      const scope = can(ctx, "report.view") === "all" ? {} : await scopeWhere(ctx, "call.view", "id", null);
      const members = await db.membership.findMany({ where: { status: "active", ...scope }, include: { user: true } });
      const rows = await Promise.all(members.map(async (m) => {
        const [calls, conn, talk, conv, won] = await Promise.all([
          db.callLog.count({ where: { agentId: m.id, startedAt: { gte: since } } }),
          db.callLog.count({ where: { agentId: m.id, startedAt: { gte: since }, talkSeconds: { gt: 0 } } }),
          db.callLog.aggregate({ where: { agentId: m.id, startedAt: { gte: since } }, _sum: { talkSeconds: true } }),
          db.lead.count({ where: { ownerId: m.id, status: "converted", updatedAt: { gte: since } } }),
          db.deal.aggregate({ where: { ownerId: m.id, closedAt: { gte: since }, stage: { type: "won" } }, _sum: { amount: true }, _count: true }),
        ]);
        return { name: m.user.name, calls, connected: conn, talk_minutes: Math.round((talk._sum.talkSeconds ?? 0) / 60), leads_converted: conv, deals_won: won._count, won_value_inr: won._sum.amount ?? 0n };
      }));
      return json(rows.sort((a, b) => b.calls - a.calls));
    },
  });

  const pipelineSummary = betaZodTool({
    name: "pipeline_summary",
    description: "Open deals grouped by pipeline stage with count, total value (INR) and probability-weighted value.",
    inputSchema: z.object({}),
    run: async () => {
      if (!has(ctx, "deal.view")) return denied("deal.view");
      const where = await scopeWhere(ctx, "deal.view");
      const stages = await db.pipelineStage.findMany({ orderBy: { order: "asc" } });
      const groups = await db.deal.groupBy({ by: ["stageId"], where, _sum: { amount: true }, _count: true });
      return json(stages.map((s) => {
        const g = groups.find((x) => x.stageId === s.id);
        const v = Number(g?._sum.amount ?? 0n);
        return { stage: s.name, type: s.type, deals: g?._count ?? 0, value_inr: v / 100, weighted_inr: Math.round((v * s.probability) / 100) / 100 };
      }));
    },
  });

  const topCustomers = betaZodTool({
    name: "top_customers",
    description: "Customers ranked by total invoiced value, with last invoice date and outstanding balance. Useful for churn / reactivation questions (long gap since last purchase).",
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    run: async ({ limit }) => {
      if (!has(ctx, "invoice.view")) return denied("invoice.view");
      const g = await db.invoice.groupBy({
        by: ["contactId"], where: { ...(await scopeWhere(ctx, "invoice.view")), status: { notIn: ["draft", "cancelled"] } },
        _sum: { total: true, balance: true }, _max: { issueDate: true }, _count: true,
        orderBy: { _sum: { total: "desc" } }, take: limit ?? 10,
      });
      const contacts = await db.contact.findMany({ where: { id: { in: g.map((x) => x.contactId) } } });
      return json(g.map((x) => ({
        customer: contacts.find((c) => c.id === x.contactId)?.name, invoices: x._count, total_inr: x._sum.total, outstanding_inr: x._sum.balance,
        last_invoice: x._max.issueDate, days_since_last: x._max.issueDate ? Math.floor((Date.now() - x._max.issueDate.getTime()) / 86400_000) : null,
      })));
    },
  });

  const createFollowup = betaZodTool({
    name: "create_followup",
    description: "LOW-RISK ACTION: schedule a follow-up task on a lead for the lead's owner (or the current user). Only call this when the user explicitly asks you to schedule/create a follow-up or reminder.",
    inputSchema: z.object({
      lead_number: z.number().int().describe("Lead number, e.g. 42 for LD-42"),
      due_in_hours: z.number().min(0.25).max(24 * 60),
      note: z.string().max(500),
    }),
    run: async ({ lead_number, due_in_hours, note }) => {
      if (!has(ctx, "followup.create")) return denied("followup.create");
      const lead = await db.lead.findFirst({ where: { number: lead_number, ...(await scopeWhere(ctx, "lead.view")) } });
      if (!lead) return `Lead LD-${lead_number} not found or not visible to this user.`;
      const dueAt = new Date(Date.now() + due_in_hours * 3600_000);
      const f = await db.followUp.create({ data: { tenantId: ctx.tenant.id, leadId: lead.id, assigneeId: lead.ownerId ?? ctx.membership.id, dueAt, note: `[AI] ${note}` } });
      await db.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: dueAt } });
      await db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: lead.id, type: "ai", body: `AI Copilot scheduled a follow-up for ${dueAt.toLocaleString("en-IN")}: ${note}`, actorId: ctx.membership.id } });
      await audit({ tenantId: ctx.tenant.id, actorName: `AI Copilot (for ${ctx.user.name})`, actorType: "ai", actorId: ctx.membership.id }, "followup.create", "FollowUp", f.id, null, { leadId: lead.id, dueAt, note });
      return `Follow-up created for LD-${lead_number} (${lead.name}) due ${dueAt.toISOString()}.`;
    },
  });

  const createTask = betaZodTool({
    name: "create_task",
    description: "LOW-RISK ACTION: create a task for the current user (or a named lead's owner). Only when the user asks to create a task / reminder / to-do.",
    inputSchema: z.object({ title: z.string().max(200), due_in_hours: z.number().min(0.25).max(24 * 90), priority: z.enum(["low", "medium", "high", "urgent"]).optional(), lead_number: z.number().int().optional() }),
    run: async ({ title, due_in_hours, priority, lead_number }) => {
      if (!has(ctx, "task.manage")) return denied("task.manage");
      const lead = lead_number ? await db.lead.findFirst({ where: { number: lead_number, ...(await scopeWhere(ctx, "lead.view")) } }) : null;
      const t = await db.task.create({ data: { tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "task"), title, priority: priority ?? "medium", dueAt: new Date(Date.now() + due_in_hours * 3600_000), assigneeId: ctx.membership.id, createdById: ctx.membership.id, leadId: lead?.id ?? null, source: "ai" } });
      await audit({ tenantId: ctx.tenant.id, actorName: `AI Copilot (for ${ctx.user.name})`, actorType: "ai", actorId: ctx.membership.id }, "task.create", "Task", t.id, null, { title });
      return `Task T-${t.number} “${title}” created, due ${t.dueAt?.toISOString()}. Link: /tasks`;
    },
  });

  const searchKb = betaZodTool({
    name: "search_knowledge_base",
    description: "Search the company's knowledge base (SOPs, policies, price lists, product manuals, FAQs) the user is allowed to read. Use for any question about company policy, process, product specs or pricing rules. Cite document titles in the answer.",
    inputSchema: z.object({ query: z.string().max(300) }),
    run: async ({ query }) => {
      if (!has(ctx, "kb.view")) return denied("kb.view");
      const hits = await kbSearch(ctx.tenant.id, ctx.membership.role.key, query);
      return hits.length ? json(hits) : "No matching knowledge-base documents.";
    },
  });

  const myHr = betaZodTool({
    name: "my_hr_summary",
    description: "The current user's own HR info: leave balances by type, pending leave requests, attendance this month (present/late days) and pending expense claims. Use for 'what is my leave balance', 'how many days was I late' etc.",
    inputSchema: z.object({}),
    run: async () => {
      if (!has(ctx, "hr.self")) return denied("hr.self");
      const { leaveBalances } = await import("./hr");
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [bal, att, pendingLeave, exp] = await Promise.all([
        leaveBalances(ctx.tenant.id, ctx.membership.id, ctx.tenant.leavePolicy as Record<string, number>),
        db.attendanceRecord.groupBy({ by: ["status"], where: { membershipId: ctx.membership.id, date: { gte: monthStart } }, _count: true }),
        db.leaveRequest.count({ where: { membershipId: ctx.membership.id, status: "pending" } }),
        db.expense.aggregate({ where: { membershipId: ctx.membership.id, status: { in: ["submitted", "approved"] } }, _sum: { amount: true }, _count: true }),
      ]);
      return json({ leave_balances: bal, pending_leave_requests: pendingLeave, attendance_this_month: Object.fromEntries(att.map((a) => [a.status, a._count])), pending_expense_claims: exp._count, pending_expense_inr: exp._sum.amount ?? 0n });
    },
  });

  return [businessOverview, findLeads, overdueInvoices, teamPerformance, pipelineSummary, topCustomers, createFollowup, createTask, searchKb, myHr];
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** AI Business Copilot (BRD §54): natural-language questions answered from live, permission-scoped data. */
export async function runCopilot(ctx: Ctx, history: ChatTurn[]): Promise<string> {
  const system = `You are the AI Business Copilot inside BizOS, an all-in-one business operating system.
You are helping ${ctx.user.name} (role: ${ctx.membership.role.name}) at ${ctx.tenant.name}, an Indian ${ctx.tenant.businessType} business. Currency is INR; use Indian notation (lakh / crore) for large amounts.

How to answer:
- Always fetch data with the tools before stating any number. Never invent figures.
- Structure: a direct answer first, then the supporting data (a short table or bullet list), a one-line explanation of why, and a "Recommended action".
- Tools already enforce the user's permissions. If a tool says permission denied, say so plainly; do not guess the hidden data.
- You may take only low-risk actions, and only when the user asks: create_followup and create_task. For anything else (refunds, discounts, deleting or cancelling records, salary changes, hiring decisions) explain that it needs a human with the right permission.
- For company policy, process, pricing rules or product questions, search the knowledge base first and cite the document titles you used.
- For the user's own leave, attendance or expenses use my_hr_summary.
- Link records using the "link" field as markdown links, e.g. [LD-42 Rahul](/leads/abc).
- Keep it concise. Today is ${new Date().toDateString()}.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({ role: t.role, content: t.content }));
  const runner = client().beta.messages.toolRunner({
    model: AI_MODEL,
    max_tokens: 16000,
    max_iterations: 8,
    system,
    messages,
    tools: copilotTools(ctx),
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  let last: Anthropic.Beta.BetaMessage | null = null;
  const usage = { input_tokens: 0, output_tokens: 0 };
  for await (const msg of runner) {
    last = msg;
    usage.input_tokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0);
    usage.output_tokens += msg.usage.output_tokens;
  }
  await track(ctx, "copilot", usage);
  if (!last) return "No response from AI.";
  if (last.stop_reason === "refusal") return "I can't help with that request.";
  return textOf(last.content) || "I couldn't produce an answer for that — try rephrasing.";
}

async function oneShot(ctx: Who, feature: string, system: string, prompt: string, effort: "low" | "medium" = "low") {
  const res = await client().beta.messages.create({
    model: AI_MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  await track(ctx, feature, res.usage);
  if (res.stop_reason === "refusal") return "AI declined to answer this request.";
  return textOf(res.content);
}

/** AI lead intelligence (BRD §15, §53): summary + purchase likelihood + next best action. */
export async function aiLeadInsight(ctx: Ctx, leadId: string) {
  const lead = await ctx.db.lead.findFirst({
    where: { id: leadId, ...(await scopeWhere(ctx, "lead.view")) },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 25 },
      calls: { orderBy: { startedAt: "desc" }, take: 10 },
      followUps: { orderBy: { dueAt: "desc" }, take: 5 },
    },
  });
  if (!lead) throw new Error("Lead not found");
  const facts = {
    name: lead.name, company: lead.companyName, source: lead.source, city: lead.city, product: lead.product,
    budget: lead.budget ? inr(lead.budget) : null, status: lead.status, score: lead.score, priority: lead.priority,
    created: lead.createdAt, last_activity: lead.lastActivityAt, next_followup: lead.nextFollowUpAt,
    calls: lead.calls.map((c) => ({ at: c.startedAt, talk_sec: c.talkSeconds, disposition: c.disposition, notes: c.notes })),
    timeline: lead.activities.map((a) => ({ at: a.createdAt, type: a.type, text: a.body })),
    followups: lead.followUps.map((f) => ({ due: f.dueAt, status: f.status, note: f.note })),
  };
  const text = await oneShot(
    ctx, "lead_insight",
    "You are a sales coach inside a CRM. Analyse one lead's data and reply in exactly this plain-text format:\nSummary: <2 sentences>\nPurchase likelihood: <Low|Medium|High> — <reason>\nMain objection: <or 'None recorded'>\nBest time to contact: <based on call history, or 'Not enough data'>\nNext best action: <one concrete action with timing>\nSuggested message: <a short WhatsApp/SMS the rep could send, in the lead's likely language (Hindi-English mix is fine for Indian leads)>",
    JSON.stringify(facts),
  );
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId, type: "ai", body: text, actorId: ctx.membership.id } });
  return text;
}

/** AI Business Brain morning briefing (BRD §95) from pre-computed metrics. */
export async function aiBriefing(ctx: Ctx, metrics: Record<string, unknown>) {
  return oneShot(
    ctx, "briefing",
    `You write the morning briefing for the owner of ${ctx.tenant.name}. From the JSON metrics, write 4-6 short bullet lines (what happened, what is at risk) using INR lakh notation, then "Recommended actions:" with 3 numbered, specific actions. Plain text, no markdown headings. Flag anomalies without accusing anyone.`,
    JSON.stringify(metrics), "medium",
  );
}


// ───────────────────────────── Knowledge base retrieval (BRD §56) ─────────────────────────────

const STOP = new Set(["the", "and", "for", "with", "what", "how", "are", "our", "you", "your", "can", "does", "is", "of", "to", "in", "on", "a", "an", "kya", "hai", "ka", "ki", "ke", "me", "mein"]);

/** Permission-aware full-text search over the tenant's knowledge base. Returns ranked snippets. */
export async function kbSearch(tenantId: string, roleKey: string, query: string) {
  const words = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))].slice(0, 12);
  if (!words.length) return [];
  const tsq = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "") + ":*").join(" | ");
  return prisma.$queryRaw<{ id: string; title: string; category: string; snippet: string; rank: number }[]>`
    SELECT id, title, category,
      ts_headline('simple', content, to_tsquery('simple', ${tsq}), 'MaxWords=70, MinWords=30, StartSel="", StopSel=""') AS snippet,
      ts_rank(to_tsvector('simple', title || ' ' || title || ' ' || content), to_tsquery('simple', ${tsq})) AS rank
    FROM "KnowledgeDoc"
    WHERE "tenantId" = ${tenantId}
      AND (cardinality("visibleToRoles") = 0 OR ${roleKey} = ANY("visibleToRoles"))
      AND to_tsvector('simple', title || ' ' || content) @@ to_tsquery('simple', ${tsq})
    ORDER BY rank DESC LIMIT 5`;
}

/** Answer a question strictly from the knowledge base, with citations. */
export async function aiKbAnswer(ctx: Ctx, question: string) {
  const hits = await kbSearch(ctx.tenant.id, ctx.membership.role.key, question);
  if (!hits.length) return { answer: "I couldn't find this in the knowledge base. Ask your admin to add the relevant SOP or policy.", sources: [] as string[] };
  const docs = await ctx.db.knowledgeDoc.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  const context = docs.map((d) => `<document title="${d.title}">\n${d.content.slice(0, 6000)}\n</document>`).join("\n");
  const answer = await oneShot(ctx, "kb_answer",
    `You answer employee questions for ${ctx.tenant.name} using ONLY the documents provided. If the documents don't contain the answer, say so. Keep it short and practical, and end with "Sources:" listing the document titles you used.`,
    `${context}\n\nQuestion: ${question}`);
  return { answer, sources: docs.map((d) => d.title) };
}

// ───────────────────────────── Structured AI helpers ─────────────────────────────

async function parseStructured<T extends z.ZodType>(who: Who, feature: string, schema: T, system: string, content: Anthropic.Beta.BetaContentBlockParam[] | string): Promise<z.infer<T> | null> {
  const res = await client().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  await track(who, feature, res.usage);
  if (res.stop_reason === "refusal") return null;
  return (res.parsed_output as z.infer<T> | null) ?? null;
}

const CaptureSchema = z.object({
  intent: z.enum(["new_lead", "update_existing", "follow_up_only", "quotation_request", "note_only"]),
  customer_name: z.string().nullable(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  products: z.array(z.object({ name: z.string(), quantity: z.number().nullable() })),
  budget_inr: z.number().nullable(),
  follow_up_at: z.string().nullable().describe("ISO 8601 datetime in Asia/Kolkata if a follow-up/delivery/meeting time is mentioned"),
  follow_up_type: z.enum(["call", "meeting", "whatsapp", "email"]).nullable(),
  note: z.string().describe("Clean one-paragraph summary of what was said, in English"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
});
export type Capture = z.infer<typeof CaptureSchema>;

/** Voice/Text-to-CRM (BRD §57): free text (English / Hindi / Hinglish) → structured CRM update proposal. */
export async function aiQuickCapture(ctx: Ctx, text: string) {
  const products = await ctx.db.product.findMany({ where: { isActive: true }, select: { name: true }, take: 200 });
  return parseStructured(ctx, "quick_capture", CaptureSchema,
    `You convert a salesperson's spoken or typed note (English, Hindi or Hinglish) into structured CRM data for ${ctx.tenant.name}. Today is ${new Date().toString()} (Asia/Kolkata). Resolve relative dates like "Friday" or "kal" to ISO datetimes; default time 11:00 if none given. Match product names to this catalogue where possible: ${products.map((p) => p.name).join("; ")}. Use null when something isn't stated — never invent phone numbers.`,
    text);
}

const ReceiptSchema = z.object({
  vendor_name: z.string().nullable(),
  bill_number: z.string().nullable(),
  bill_date: z.string().nullable().describe("YYYY-MM-DD"),
  category: z.enum(["Travel", "Fuel", "Food", "Office", "Marketing", "Equipment", "Accommodation", "Telecom", "Miscellaneous"]),
  total_amount_inr: z.number().nullable(),
  tax_amount_inr: z.number().nullable(),
  vendor_gstin: z.string().nullable(),
  description: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ReceiptData = z.infer<typeof ReceiptSchema>;

/** AI document processing (BRD §58): read a receipt / bill image or PDF into expense fields for human review. */
export async function aiScanReceipt(ctx: Ctx, file: { mime: string; data: Buffer }) {
  const b64 = file.data.toString("base64");
  const block: Anthropic.Beta.BetaContentBlockParam = file.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: file.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: b64 } };
  return parseStructured(ctx, "receipt_scan", ReceiptSchema,
    "You extract expense details from an Indian bill, receipt or invoice for an expense claim. Amounts in rupees. If the image is not a bill, set confidence low and leave fields null.",
    [block, { type: "text", text: "Extract the expense fields from this document." }]);
}

const TriageSchema = z.object({
  category: z.enum(["General", "Billing", "Delivery", "Product issue", "Installation", "Complaint", "Feature request"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]),
  summary: z.string(),
  suggested_reply: z.string(),
});

/** AI support triage (BRD §47) — used by workflows and the ticket screen. */
export async function aiTriageTicketSystem(tenantId: string, ticketId: string, membershipId?: string | null) {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, tenantId }, include: { contact: true } });
  if (!t) return "Ticket not found";
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const r = await parseStructured({ tenantId, membershipId }, "ticket_triage", TriageSchema,
    `You triage support tickets for ${tenant.name}, an Indian ${tenant.businessType} business. Choose category and priority (urgent = safety, outage, or angry high-value customer). Write a courteous, specific suggested reply (no promises of refunds or discounts).`,
    `Customer: ${t.contact?.name ?? "unknown"}\nSubject: ${t.subject}\nDescription: ${t.body ?? "(none)"}`);
  if (!r) return "AI declined to triage this ticket";
  await prisma.ticket.update({ where: { id: t.id }, data: { category: r.category, priority: r.priority, aiSummary: `${r.summary}\n\nSentiment: ${r.sentiment}\n\nSuggested reply:\n${r.suggested_reply}` } });
  return `AI triage: ${r.category} · ${r.priority} · ${r.sentiment}`;
}

/** AI lead qualification note for workflows (no user context; runs as the AI system actor). */
export async function aiQualifyLeadSystem(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) return "Lead not found";
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const text = await oneShot({ tenantId }, "lead_qualify",
    `You are a sales assistant for ${tenant.name}, an Indian ${tenant.businessType} business. From a new enquiry, write in plain text:\nLikely intent: ...\nQualification questions to ask: (3 bullets)\nPossible objections: ...\nSuggested first WhatsApp message: (short, friendly, Hinglish ok)`,
    JSON.stringify({ name: lead.name, company: lead.companyName, source: lead.source, campaign: lead.campaign, product: lead.product, city: lead.city, budget: lead.budget ? Number(lead.budget) / 100 : null, notes: lead.notes }));
  await prisma.activity.create({ data: { tenantId, leadId, type: "ai", body: text } });
  return "AI qualification note added";
}

/** AI writing assistant for outbound messages. */
export async function aiDraftMessage(ctx: Ctx, input: { channel: string; purpose: string; leadId?: string | null; contactId?: string | null }) {
  const [lead, contact] = await Promise.all([
    input.leadId ? ctx.db.lead.findFirst({ where: { id: input.leadId, ...(await scopeWhere(ctx, "lead.view")) }, include: { activities: { orderBy: { createdAt: "desc" }, take: 8 } } }) : null,
    input.contactId ? ctx.db.contact.findFirst({ where: { id: input.contactId } }) : null,
  ]);
  return oneShot(ctx, "draft_message",
    `You write ${input.channel} messages for ${ctx.user.name} at ${ctx.tenant.name} (India). ${input.channel === "whatsapp" || input.channel === "sms" ? "Max 60 words, warm and direct, Hinglish is fine if the context suggests Hindi." : "A short professional email: first line 'Subject: ...', then the body."} Never promise discounts, refunds or delivery dates that aren't in the context. Output only the message.`,
    JSON.stringify({ purpose: input.purpose, lead: lead && { name: lead.name, product: lead.product, status: lead.status, recent: lead.activities.map((a) => a.body) }, contact: contact && { name: contact.name, company: contact.companyName } }));
}
