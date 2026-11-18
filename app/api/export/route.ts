import { getCtx, has } from "@/lib/auth";
import { audit } from "@/lib/audit";

/** Full company data export (DPDP / portability, BRD §98). Streams JSON; secrets and file bytes are excluded. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx || !has(ctx, "data.export_all")) return new Response("Forbidden", { status: 403 });
  const db = ctx.db;
  const tables: [string, () => Promise<unknown[]>][] = [
    ["branches", () => db.branch.findMany()], ["teams", () => db.team.findMany()], ["roles", () => db.role.findMany()],
    ["members", () => db.membership.findMany({ include: { user: { select: { name: true, email: true, phone: true } } } })],
    ["leads", () => db.lead.findMany()], ["contacts", () => db.contact.findMany()], ["activities", () => db.activity.findMany()], ["followUps", () => db.followUp.findMany()],
    ["calls", () => db.callLog.findMany()], ["deals", () => db.deal.findMany()], ["products", () => db.product.findMany()],
    ["quotations", () => db.quotation.findMany({ include: { items: true } })], ["invoices", () => db.invoice.findMany({ include: { items: true } })], ["payments", () => db.payment.findMany()],
    ["tickets", () => db.ticket.findMany()], ["tasks", () => db.task.findMany()], ["projects", () => db.project.findMany()],
    ["expenses", () => db.expense.findMany()], ["attendance", () => db.attendanceRecord.findMany()], ["leave", () => db.leaveRequest.findMany()],
    ["vendors", () => db.vendor.findMany()], ["purchaseOrders", () => db.purchaseOrder.findMany()], ["stockMovements", () => db.stockMovement.findMany()],
    ["customObjects", () => db.customObject.findMany()], ["customFields", () => db.customFieldDef.findMany()], ["customRecords", () => db.customRecord.findMany()],
    ["knowledge", () => db.knowledgeDoc.findMany()], ["workflows", () => db.workflow.findMany()], ["messageTemplates", () => db.messageTemplate.findMany()], ["messages", () => db.messageLog.findMany()],
    ["auditLog", () => db.auditLog.findMany()],
  ];
  await audit(ctx, "data.export_all", "Tenant", ctx.tenant.id, null, { tables: tables.map((t) => t[0]) });
  const enc = new TextEncoder();
  const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(enc.encode(`{"company":${ser({ name: ctx.tenant.name, gstin: ctx.tenant.gstin, exportedAt: new Date(), exportedBy: ctx.user.email })}`));
      for (const [name, load] of tables) c.enqueue(enc.encode(`,"${name}":${ser(await load())}`));
      c.enqueue(enc.encode("}"));
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${ctx.tenant.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
}
