import { prisma } from "./prisma";

/**
 * Omnichannel messaging (BRD §48–49). One send() for email / WhatsApp / SMS with:
 *  - {{variable}} templates rendered from workflow / record context
 *  - consent & DND enforcement for WhatsApp and SMS (opt-outs are never messaged)
 *  - provider adapters: Resend (email), Meta WhatsApp Cloud API, generic SMS webhook.
 *    Without credentials, messages are recorded as "simulated" so flows can be tested end to end.
 *  - every message logged to MessageLog and the customer timeline
 */
export type Channel = "email" | "whatsapp" | "sms";

export function render(tpl: string, vars: Record<string, unknown>) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), vars);
    return v == null ? "" : String(v);
  });
}

type SendInput = {
  tenantId: string; channel: Channel; to: string | null | undefined; subject?: string | null; body: string;
  leadId?: string | null; contactId?: string | null; workflowRunId?: string | null; sentById?: string | null;
};

export async function send(m: SendInput) {
  const base = { tenantId: m.tenantId, channel: m.channel, subject: m.subject ?? null, body: m.body, leadId: m.leadId ?? null, contactId: m.contactId ?? null, workflowRunId: m.workflowRunId ?? null, sentById: m.sentById ?? null };
  if (!m.to) return prisma.messageLog.create({ data: { ...base, to: "—", status: "failed", provider: "none", error: `No ${m.channel === "email" ? "email address" : "phone number"} on record` } });

  if (m.channel !== "email") {
    const dnd = await prisma.dndNumber.findUnique({ where: { tenantId_phone: { tenantId: m.tenantId, phone: m.to } } });
    const optedOut = m.contactId ? await prisma.contact.findFirst({ where: { id: m.contactId, dnd: true } }) : null;
    if (dnd || optedOut) return prisma.messageLog.create({ data: { ...base, to: m.to, status: "blocked", provider: "consent", error: "Recipient opted out / DND" } });
  }

  let status = "simulated", provider = "simulated", error: string | null = null;
  try {
    if (m.channel === "email" && process.env.RESEND_API_KEY) {
      provider = "resend";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "BizOS <noreply@example.com>", to: [m.to], subject: m.subject ?? "(no subject)", text: m.body }),
        signal: AbortSignal.timeout(10_000),
      });
      status = r.ok ? "sent" : "failed"; if (!r.ok) error = `Resend ${r.status}`;
    } else if (m.channel === "whatsapp" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
      provider = "whatsapp_cloud";
      // Free-form text is accepted inside the 24h customer-service window; outside it Meta requires an approved template.
      const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: m.to.replace("+", ""), type: "text", text: { body: m.body } }),
        signal: AbortSignal.timeout(10_000),
      });
      status = r.ok ? "sent" : "failed"; if (!r.ok) error = `WhatsApp ${r.status}`;
    } else if (m.channel === "sms" && process.env.SMS_WEBHOOK_URL) {
      provider = "sms_webhook";
      const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: m.to, text: m.body }), signal: AbortSignal.timeout(10_000) });
      status = r.ok ? "sent" : "failed"; if (!r.ok) error = `SMS ${r.status}`;
    }
  } catch (e) {
    status = "failed"; error = e instanceof Error ? e.message : "send failed";
  }
  const log = await prisma.messageLog.create({ data: { ...base, to: m.to, status, provider, error } });
  if (m.leadId || m.contactId) {
    await prisma.activity.create({
      data: {
        tenantId: m.tenantId, leadId: m.leadId ?? null, contactId: m.contactId ?? null, type: m.channel === "email" ? "email" : "whatsapp",
        body: `${m.channel.toUpperCase()} ${status === "failed" ? "failed" : status === "simulated" ? "queued (simulated)" : "sent"} to ${m.to}${m.subject ? ` — ${m.subject}` : ""}: ${m.body.slice(0, 280)}`,
        actorId: m.sentById ?? null,
      },
    });
  }
  return log;
}

/** Builds the {{variables}} available to templates for a lead / contact / invoice / quotation. */
export async function templateVars(tenantId: string, refs: { leadId?: string | null; contactId?: string | null; invoiceId?: string | null; quotationId?: string | null; ticketId?: string | null }) {
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const [tenant, lead, contact, invoice, quotation, ticket] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    refs.leadId ? prisma.lead.findFirst({ where: { id: refs.leadId, tenantId }, include: { owner: { include: { user: true } } } }) : null,
    refs.contactId ? prisma.contact.findFirst({ where: { id: refs.contactId, tenantId } }) : null,
    refs.invoiceId ? prisma.invoice.findFirst({ where: { id: refs.invoiceId, tenantId }, include: { contact: true } }) : null,
    refs.quotationId ? prisma.quotation.findFirst({ where: { id: refs.quotationId, tenantId }, include: { contact: true } }) : null,
    refs.ticketId ? prisma.ticket.findFirst({ where: { id: refs.ticketId, tenantId }, include: { contact: true } }) : null,
  ]);
  const rupees = (p?: bigint | null) => (p == null ? "" : `₹${(Number(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  const c = contact ?? invoice?.contact ?? quotation?.contact ?? ticket?.contact ?? null;
  return {
    company: { name: tenant?.name, phone: tenant?.phone, email: tenant?.email },
    lead: lead ? { name: lead.name, first_name: lead.name.split(" ")[0], phone: lead.phone, email: lead.email, product: lead.product, city: lead.city, number: `LD-${lead.number}` } : {},
    owner: lead?.owner ? { name: lead.owner.user.name } : {},
    contact: c ? { name: c.name, first_name: c.name.split(" ")[0], company: c.companyName, phone: c.phone, email: c.email } : {},
    invoice: invoice ? { number: invoice.number, total: rupees(invoice.total), balance: rupees(invoice.balance), due_date: invoice.dueDate.toLocaleDateString("en-IN"), link: `${app}/i/${invoice.publicToken}` } : {},
    quotation: quotation ? { number: quotation.number, total: rupees(quotation.total), valid_until: quotation.validUntil.toLocaleDateString("en-IN"), link: `${app}/q/${quotation.publicToken}` } : {},
    ticket: ticket ? { number: `#${ticket.number}`, subject: ticket.subject, status: ticket.status } : {},
    _to: {
      email: lead?.email ?? c?.email ?? null,
      phone: lead?.phone ?? c?.phone ?? null,
      leadId: lead?.id ?? null, contactId: c?.id ?? lead?.contactId ?? null,
    },
  };
}

export const DEFAULT_TEMPLATES: { name: string; channel: Channel; subject?: string; body: string }[] = [
  { name: "Lead welcome (WhatsApp)", channel: "whatsapp", body: "Namaste {{lead.first_name}} 🙏 Thank you for your enquiry about {{lead.product}} with {{company.name}}. {{owner.name}} from our team will call you shortly. Reply here anytime." },
  { name: "Lead welcome (Email)", channel: "email", subject: "Thanks for contacting {{company.name}}", body: "Hi {{lead.first_name}},\n\nThank you for your interest in {{lead.product}}. {{owner.name}} will get in touch with you today to understand your requirement.\n\nRegards,\n{{company.name}}" },
  { name: "Quotation follow-up", channel: "whatsapp", body: "Hi {{contact.first_name}}, sharing a gentle reminder about quotation {{quotation.number}} ({{quotation.total}}), valid till {{quotation.valid_until}}. View & accept here: {{quotation.link}}" },
  { name: "Payment reminder — before due", channel: "whatsapp", body: "Hi {{contact.first_name}}, invoice {{invoice.number}} for {{invoice.balance}} is due on {{invoice.due_date}}. Pay or download here: {{invoice.link}} — {{company.name}}" },
  { name: "Payment reminder — overdue", channel: "email", subject: "Overdue: invoice {{invoice.number}}", body: "Dear {{contact.name}},\n\nOur records show invoice {{invoice.number}} with a balance of {{invoice.balance}} was due on {{invoice.due_date}}. Kindly arrange payment at the earliest: {{invoice.link}}\n\nIf already paid, please ignore this message.\n\nRegards,\nAccounts, {{company.name}}" },
  { name: "Ticket acknowledgement", channel: "email", subject: "We received your request {{ticket.number}}", body: "Hi {{contact.first_name}},\n\nWe have logged your request \"{{ticket.subject}}\" as {{ticket.number}}. Our team will update you soon.\n\n{{company.name}} Support" },
  { name: "Win-back offer", channel: "whatsapp", body: "Hi {{contact.first_name}}, it's been a while! {{company.name}} has new stock and special rates this month. Reply YES and we'll share the latest price list." },
];
