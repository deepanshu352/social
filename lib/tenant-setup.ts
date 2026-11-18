import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES } from "./rbac";
import { RECIPES } from "./workflow-recipes";
import { DEFAULT_TEMPLATES } from "./messaging";
import { applyPack, packForBusiness } from "./industry";

type Tx = Prisma.TransactionClient | PrismaClient;

export const DEFAULT_STAGES = [
  { name: "New", probability: 5, type: "open" },
  { name: "Contacted", probability: 10, type: "open" },
  { name: "Qualified", probability: 25, type: "open" },
  { name: "Demo", probability: 40, type: "open" },
  { name: "Quotation", probability: 60, type: "open" },
  { name: "Negotiation", probability: 80, type: "open" },
  { name: "Won", probability: 100, type: "won" },
  { name: "Lost", probability: 0, type: "lost" },
];

/** Workflows switched on for every new company — the "it just works" automation baseline. */
export const STARTER_RECIPES = ["speed_to_lead", "referral_fast_lane", "missed_followup", "pre_due_reminder", "collections", "sla_escalation", "daily_digest", "leave_alert", "low_stock"];

export const STARTER_KB = [
  { title: "Leave & attendance policy", category: "HR", content: "Working hours are 9:30 AM to 6:30 PM, Monday to Saturday. Check in from the Attendance page; arriving more than 15 minutes after shift start is marked late. Three late marks in a month count as half a day of casual leave.\n\nAnnual leave: 12 casual leave, 8 sick leave and 15 earned leave per calendar year. Apply at least 2 days in advance for casual leave and 15 days in advance for earned leave. Sick leave over 2 days needs a medical certificate. Unused casual and sick leave lapse on 31 December; up to 10 earned leave days carry forward.\n\nAll leave is approved by your reporting manager in the Approvals inbox." },
  { title: "Expense & reimbursement policy", category: "Finance", content: "Claim business expenses within 30 days with a photo of the bill. Limits: local travel ₹1,500/day, food on field duty ₹500/day, hotel ₹3,500/night in metro cities and ₹2,500 elsewhere, fuel at actuals with odometer readings.\n\nClaims up to ₹10,000 need your manager's approval. Claims of ₹10,000 or more need manager and accounts approval. Approved claims are reimbursed in the next payroll cycle. Alcohol, fines and personal expenses are never reimbursed." },
  { title: "Discount & quotation approval policy", category: "Sales", content: "Sales executives may give up to 10% discount, sales managers up to 20%. Anything higher needs approval from the Company Admin and must be justified in the quotation notes. Quotations are valid for 15 days. Standard payment terms are 50% advance and the balance on delivery; credit terms need accounts approval." },
];

/** Seeds roles, pipeline, HO branch, approval policies, templates, starter workflows, knowledge and the industry pack. */
export async function provisionTenant(tx: Tx, tenantId: string, stateCode = "07", businessType = "other") {
  for (const r of DEFAULT_ROLES) {
    await tx.role.create({ data: { tenantId, key: r.key, name: r.name, isSystem: true, maxDiscount: r.maxDiscount, permissions: r.permissions } });
  }
  await tx.pipelineStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ ...s, tenantId, order: i })) });
  const branch = await tx.branch.create({ data: { tenantId, name: "Head Office", code: "HO", stateCode, isHeadOffice: true } });
  await tx.approvalPolicy.createMany({ data: [
    { tenantId, entity: "expense", name: "Expenses (any amount)", minAmount: 0n, levels: ["manager"] },
    { tenantId, entity: "expense", name: "Expenses ₹10,000+", minAmount: 1_000_000n, levels: ["manager", "accountant"] },
    { tenantId, entity: "leave", name: "Leave", minAmount: 0n, levels: ["manager"] },
    { tenantId, entity: "purchase_order", name: "Purchase orders", minAmount: 0n, levels: ["admin"] },
  ] });
  await tx.messageTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ tenantId, name: t.name, channel: t.channel, subject: t.subject ?? null, body: t.body })) });
  for (const key of STARTER_RECIPES) {
    const r = RECIPES.find((x) => x.key === key)!;
    if (r.industries && !r.industries.includes(businessType)) continue;
    await tx.workflow.create({ data: { tenantId, name: r.name, description: r.description, trigger: r.trigger, triggerConfig: (r.triggerConfig ?? {}) as object, conditions: (r.conditions ?? []) as object, steps: r.steps as object, recipeKey: r.key } });
  }
  await tx.knowledgeDoc.createMany({ data: STARTER_KB.map((d) => ({ ...d, tenantId })) });
  const pack = packForBusiness(businessType);
  if (pack) await applyPack(tx, tenantId, pack);
  return { branch, adminRole: await tx.role.findFirstOrThrow({ where: { tenantId, key: "admin" } }) };
}
