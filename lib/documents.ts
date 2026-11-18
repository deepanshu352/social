import type { Ctx } from "./auth";
import { scopeWhere } from "./auth";
import { computeDoc, type LineInput } from "./pricing";
import { nextNumber } from "./db";
import { fiscalYear, randomToken } from "./utils";
import { audit } from "./audit";
import { emit } from "./events";
import { notify, membersWithPerm } from "./notify";
import { invoiceStock } from "./inventory";

export type DocPayload = { contactId: string; placeOfSupply: string; items: LineInput[]; date2: string; terms?: string; notes?: string; dealId?: string | null };

export function parsePayload(fd: FormData): DocPayload {
  const p = JSON.parse(String(fd.get("payload") ?? "{}")) as DocPayload;
  if (!p.contactId) throw new Error("Select a customer");
  if (!p.items?.length) throw new Error("Add at least one line item");
  if (!p.date2 || isNaN(new Date(p.date2).getTime())) throw new Error("Pick a valid date");
  return p;
}

function itemRows(p: DocPayload, sellerState: string) {
  const t = computeDoc(p.items, sellerState, p.placeOfSupply);
  if (!t.lines.length) throw new Error("Add at least one line with a description and quantity");
  const rows = t.lines.map((l, i) => ({
    productId: l.productId || null, description: l.description.trim(), hsn: l.hsn || null, qty: l.qty, unit: l.unit || "pcs",
    unitPrice: BigInt(l.unitPrice), discountPct: l.discountPct, taxRate: l.taxRate, taxable: BigInt(l.taxable),
    cgst: BigInt(l.cgst), sgst: BigInt(l.sgst), igst: BigInt(l.igst), lineTotal: BigInt(l.lineTotal), sort: i,
  }));
  return {
    t, rows,
    totals: { subtotal: BigInt(t.subtotal), discount: BigInt(t.discount), tax: BigInt(t.tax), roundOff: BigInt(t.roundOff), total: BigInt(t.total) },
  };
}

// ───────────────────────────── Quotations ─────────────────────────────

export async function saveQuotation(ctx: Ctx, id: string | null, p: DocPayload) {
  const contact = await ctx.db.contact.findFirst({ where: { id: p.contactId } });
  if (!contact) throw new Error("Customer not found");
  const { rows, totals, t } = itemRows(p, ctx.tenant.stateCode);
  const common = { contactId: p.contactId, dealId: p.dealId || null, placeOfSupply: p.placeOfSupply, validUntil: new Date(p.date2), terms: p.terms || null, notes: p.notes || null, maxDiscountPct: t.maxDiscountPct, ...totals };
  if (id) {
    const q = await ctx.db.quotation.findFirst({ where: { id, ...(await scopeWhere(ctx, "quotation.view")) } });
    if (!q) throw new Error("Quotation not found");
    if (!["draft", "rejected", "approved"].includes(q.status)) throw new Error("Only draft quotations can be edited. Create a revision instead.");
    await ctx.db.quotation.update({ where: { id }, data: { ...common, status: "draft", items: { deleteMany: {}, create: rows } } });
    await audit(ctx, "quotation.update", "Quotation", id, { total: q.total }, { total: totals.total });
    return id;
  }
  const n = await nextNumber(ctx.tenant.id, `QT/${fiscalYear()}`);
  const q = await ctx.db.quotation.create({
    data: { ...common, tenantId: ctx.tenant.id, number: `QT/${fiscalYear()}/${String(n).padStart(4, "0")}`, ownerId: ctx.membership.id, branchId: ctx.membership.branchId, publicToken: randomToken(), items: { create: rows } },
  });
  await audit(ctx, "quotation.create", "Quotation", q.id, null, { number: q.number, total: totals.total });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: p.contactId, dealId: p.dealId || null, type: "system", body: `Quotation ${q.number} created`, actorId: ctx.membership.id } });
  return q.id;
}

/** Submit: auto-approve within the role's discount limit, else route to approvers (BRD §66). */
export async function submitQuotation(ctx: Ctx, id: string) {
  const q = await ctx.db.quotation.findFirst({ where: { id, ...(await scopeWhere(ctx, "quotation.view")) } });
  if (!q || q.status !== "draft") throw new Error("Only drafts can be submitted");
  const needs = q.maxDiscountPct > ctx.membership.role.maxDiscount && !ctx.perms["quotation.approve"];
  await ctx.db.quotation.update({ where: { id }, data: { status: needs ? "pending_approval" : "approved", approvedById: needs ? null : ctx.membership.id } });
  if (needs) {
    const approvers = (await membersWithPerm(ctx.tenant.id, "quotation.approve")).filter((m) => m !== ctx.membership.id);
    for (const a of approvers) await notify(ctx.tenant.id, a, `Approval needed: ${q.number}`, `${q.maxDiscountPct}% discount requested by ${ctx.user.name}`, `/quotations/${id}`);
  }
  await audit(ctx, needs ? "quotation.approval_requested" : "quotation.approved", "Quotation", id);
  return needs;
}

export async function decideQuotation(ctx: Ctx, id: string, approve: boolean, comment?: string) {
  if (!ctx.perms["quotation.approve"]) throw new Error("Not allowed to approve");
  const q = await ctx.db.quotation.findFirst({ where: { id, status: "pending_approval" } });
  if (!q) throw new Error("Nothing to approve");
  if (q.ownerId === ctx.membership.id && ctx.membership.role.key !== "admin") throw new Error("You cannot approve your own quotation");
  await ctx.db.quotation.update({ where: { id }, data: { status: approve ? "approved" : "rejected", approvedById: approve ? ctx.membership.id : null, rejectedReason: approve ? null : comment || "Rejected by approver" } });
  await notify(ctx.tenant.id, q.ownerId, `${q.number} ${approve ? "approved" : "rejected"}`, comment, `/quotations/${id}`);
  await audit(ctx, approve ? "quotation.approve" : "quotation.reject", "Quotation", id, null, { comment });
}

export async function quotationToInvoice(ctx: Ctx, id: string) {
  const q = await ctx.db.quotation.findFirst({ where: { id }, include: { items: true } });
  if (!q || !["accepted", "approved", "sent", "viewed"].includes(q.status)) throw new Error("Only approved/accepted quotations can be invoiced");
  if (q.invoiceId) return q.invoiceId;
  const inv = await ctx.db.invoice.create({
    data: {
      tenantId: ctx.tenant.id, contactId: q.contactId, quotationId: q.id, ownerId: q.ownerId, branchId: q.branchId, placeOfSupply: q.placeOfSupply,
      dueDate: new Date(Date.now() + 15 * 86400_000), subtotal: q.subtotal, discount: q.discount, tax: q.tax, roundOff: q.roundOff, total: q.total, balance: q.total,
      terms: ctx.tenant.invoiceTerms, notes: `Against quotation ${q.number}`, publicToken: randomToken(),
      items: { create: q.items.map(({ id: _i, quotationId: _q, ...it }) => it) },
    },
  });
  await ctx.db.quotation.update({ where: { id }, data: { status: "converted", invoiceId: inv.id } });
  await audit(ctx, "quotation.convert", "Quotation", id, null, { invoiceId: inv.id });
  return inv.id;
}

// ───────────────────────────── Invoices ─────────────────────────────

export async function saveInvoice(ctx: Ctx, id: string | null, p: DocPayload) {
  const contact = await ctx.db.contact.findFirst({ where: { id: p.contactId } });
  if (!contact) throw new Error("Customer not found");
  const { rows, totals } = itemRows(p, ctx.tenant.stateCode);
  const common = { contactId: p.contactId, placeOfSupply: p.placeOfSupply, dueDate: new Date(p.date2), terms: p.terms || null, notes: p.notes || null, ...totals, balance: totals.total };
  if (id) {
    const inv = await ctx.db.invoice.findFirst({ where: { id } });
    if (!inv || inv.status !== "draft") throw new Error("Issued invoices are locked. Cancel and re-issue to correct.");
    await ctx.db.invoice.update({ where: { id }, data: { ...common, items: { deleteMany: {}, create: rows } } });
    return id;
  }
  const inv = await ctx.db.invoice.create({ data: { ...common, tenantId: ctx.tenant.id, ownerId: ctx.membership.id, branchId: ctx.membership.branchId, publicToken: randomToken(), items: { create: rows } } });
  await audit(ctx, "invoice.create", "Invoice", inv.id, null, { total: totals.total });
  return inv.id;
}

/** Issue: assigns the gapless GST number (only issued invoices consume numbers) and locks the document. */
export async function issueInvoice(ctx: Ctx, id: string) {
  const inv = await ctx.db.invoice.findFirst({ where: { id } });
  if (!inv || inv.status !== "draft") throw new Error("Only drafts can be issued");
  if (inv.total <= 0n) throw new Error("Invoice total must be greater than zero");
  const fy = fiscalYear(new Date());
  const n = await nextNumber(ctx.tenant.id, `INV/${fy}`);
  const number = `INV/${fy}/${String(n).padStart(4, "0")}`;
  await ctx.db.invoice.update({ where: { id }, data: { number, status: "issued", issueDate: new Date() } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: inv.contactId, type: "system", body: `Invoice ${number} issued`, actorId: ctx.membership.id } });
  await audit(ctx, "invoice.issue", "Invoice", id, null, { number, total: inv.total });
  await invoiceStock(ctx.tenant.id, id, "out", ctx.membership.id);
  await emit(ctx.tenant.id, "invoice.issued", { id, number, contactId: inv.contactId, total: inv.total, ownerId: inv.ownerId });
  return number;
}

export async function recordPayment(ctx: Ctx, invoiceId: string, amount: bigint, method: string, reference: string | null, receivedOn: Date) {
  const inv = await ctx.db.invoice.findFirst({ where: { id: invoiceId } });
  if (!inv || !["issued", "partially_paid", "overdue"].includes(inv.status)) throw new Error("Invoice is not open for payment");
  if (amount <= 0n) throw new Error("Amount must be positive");
  if (amount > inv.balance) throw new Error(`Amount exceeds balance due`);
  const paid = inv.amountPaid + amount;
  const balance = inv.total - paid;
  const status = balance === 0n ? "paid" : "partially_paid";
  await ctx.db.$transaction([
    ctx.db.payment.create({ data: { tenantId: ctx.tenant.id, invoiceId, contactId: inv.contactId, amount, method, reference, receivedOn, createdById: ctx.membership.id } }),
    ctx.db.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid, balance, status } }),
  ]);
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: inv.contactId, type: "system", body: `Payment of ₹${(Number(amount) / 100).toLocaleString("en-IN")} received against ${inv.number} (${method})`, actorId: ctx.membership.id } });
  await audit(ctx, "payment.record", "Invoice", invoiceId, { balance: inv.balance }, { amount, method, reference, balance });
  await emit(ctx.tenant.id, "payment.received", { invoiceId, amount, method, contactId: inv.contactId, ownerId: inv.ownerId });
  if (status === "paid") await emit(ctx.tenant.id, "invoice.paid", { id: invoiceId, number: inv.number, contactId: inv.contactId, total: inv.total, ownerId: inv.ownerId });
}

export async function cancelInvoice(ctx: Ctx, id: string, reason: string) {
  if (!ctx.perms["invoice.cancel"]) throw new Error("Not allowed");
  const inv = await ctx.db.invoice.findFirst({ where: { id } });
  if (!inv || inv.status === "cancelled") throw new Error("Invoice not found");
  if (inv.amountPaid > 0n) throw new Error("Invoice has payments recorded — refund/void them first");
  if (!reason) throw new Error("A reason is required");
  await ctx.db.invoice.update({ where: { id }, data: { status: "cancelled", cancelledReason: reason, balance: 0n } });
  await audit(ctx, "invoice.cancel", "Invoice", id, { status: inv.status }, { status: "cancelled", reason });
  if (inv.status !== "draft") await invoiceStock(ctx.tenant.id, id, "back", ctx.membership.id);
}
