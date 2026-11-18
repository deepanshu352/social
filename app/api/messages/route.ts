import { authorize, scopeWhere } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { render, send, templateVars, type Channel } from "@/lib/messaging";

/** Send (or preview, with ?preview=1) a one-off message to a lead / customer. */
export const POST = handle(async (req: Request) => {
  const ctx = await authorize("message.send");
  const b = await req.json();
  const channel = b.channel as Channel;
  if (!["email", "whatsapp", "sms"].includes(channel)) return jsonError("VALIDATION", "Invalid channel", 422);
  if (b.leadId && !(await ctx.db.lead.findFirst({ where: { id: b.leadId, ...(await scopeWhere(ctx, "lead.view")) } }))) return jsonError("NOT_FOUND", "Lead not found", 404);
  if (b.contactId && !(await ctx.db.contact.findFirst({ where: { id: b.contactId, ...(await scopeWhere(ctx, "contact.view")) } }))) return jsonError("NOT_FOUND", "Customer not found", 404);
  const vars = await templateVars(ctx.tenant.id, { leadId: b.leadId, contactId: b.contactId });
  let subject: string | null = b.subject ?? null, body: string = b.body ?? "";
  if (b.templateId) {
    const t = await ctx.db.messageTemplate.findFirst({ where: { id: b.templateId } });
    if (!t) return jsonError("NOT_FOUND", "Template not found", 404);
    subject = t.subject; body = t.body;
  }
  subject = subject ? render(subject, vars) : null;
  body = render(body, vars);
  if (!body.trim()) return jsonError("VALIDATION", "Message is empty", 422);
  if (new URL(req.url).searchParams.get("preview")) return json({ subject, body, to: channel === "email" ? vars._to.email : vars._to.phone });
  const log = await send({ tenantId: ctx.tenant.id, channel, to: channel === "email" ? vars._to.email : vars._to.phone, subject, body, leadId: b.leadId ?? vars._to.leadId, contactId: b.contactId ?? vars._to.contactId, sentById: ctx.membership.id });
  return json({ status: log.status, error: log.error });
});
