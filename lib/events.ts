import crypto from "node:crypto";
import { prisma } from "./prisma";
import { startWorkflows } from "./workflows";

export const EVENT_TYPES = [
  "lead.created", "lead.assigned", "lead.status_changed", "call.completed", "followup.missed", "deal.won", "deal.lost",
  "quotation.accepted", "invoice.issued", "invoice.paid", "invoice.overdue", "payment.received", "ticket.created",
  "task.completed", "expense.submitted", "leave.requested", "stock.low",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Publish a domain event: starts matching workflows (lib/workflows.ts) and delivers webhooks.
 * Money values in payloads are paise numbers.
 */
export async function emit(tenantId: string, type: EventType, payload: Record<string, unknown>) {
  const safe = JSON.parse(JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  await Promise.allSettled([startWorkflows(tenantId, type, safe), deliverWebhooks(tenantId, type, safe)]);
}

async function deliverWebhooks(tenantId: string, type: string, payload: unknown) {
  const hooks = await prisma.webhook.findMany({ where: { tenantId, isActive: true, events: { has: type } } });
  await Promise.allSettled(hooks.map(async (h) => {
    const status = await postSigned(h.url, type, payload, h.secret);
    await prisma.webhook.update({ where: { id: h.id }, data: { lastStatus: status, lastSentAt: new Date() } });
  }));
}

async function postSigned(url: string, event: string, data: unknown, secret?: string) {
  const body = JSON.stringify({ id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data });
  const headers: Record<string, string> = { "content-type": "application/json", "x-bizos-event": event };
  if (secret) headers["x-bizos-signature"] = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    return res.status;
  } catch {
    return 0;
  }
}
