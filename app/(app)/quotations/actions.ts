"use server";
import { guarded } from "@/lib/action";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, scopeWhere } from "@/lib/auth";
import { decideQuotation, parsePayload, quotationToInvoice, saveQuotation, submitQuotation } from "@/lib/documents";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";

export async function createQuotationAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  const id = await saveQuotation(ctx, null, parsePayload(fd));
  redirect(`/quotations/${id}`);
});
}
export async function updateQuotationAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  await saveQuotation(ctx, id, parsePayload(fd));
  redirect(`/quotations/${id}`);
});
}
export async function submitAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  await submitQuotation(ctx, id);
  revalidatePath(`/quotations/${id}`);
});
}
export async function decideAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("quotation.approve");
  await decideQuotation(ctx, id, str(fd.get("decision")) === "approve", str(fd.get("comment")));
  revalidatePath(`/quotations/${id}`);
});
}
export async function markSentAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  const q = await ctx.db.quotation.findFirst({ where: { id, ...(await scopeWhere(ctx, "quotation.view")) } });
  if (!q || q.status !== "approved") throw new Error("Only approved quotations can be sent");
  await ctx.db.quotation.update({ where: { id }, data: { status: "sent" } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: q.contactId, dealId: q.dealId, type: "email", body: `Quotation ${q.number} sent to customer`, actorId: ctx.membership.id } });
  await audit(ctx, "quotation.send", "Quotation", id);
  revalidatePath(`/quotations/${id}`);
});
}
export async function convertAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("invoice.create");
  const invId = await quotationToInvoice(ctx, id);
  redirect(`/invoices/${invId}`);
});
}
export async function cancelQuotationAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  await ctx.db.quotation.update({ where: { id }, data: { status: "cancelled" } });
  await audit(ctx, "quotation.cancel", "Quotation", id);
  revalidatePath(`/quotations/${id}`);
});
}
export async function reviseAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("quotation.create");
  const q = await ctx.db.quotation.findFirst({ where: { id }, include: { items: true } });
  if (!q) throw new Error("Not found");
  const newId = await saveQuotation(ctx, null, {
    contactId: q.contactId, dealId: q.dealId, placeOfSupply: q.placeOfSupply, date2: new Date(Date.now() + 15 * 86400_000).toISOString(),
    terms: q.terms ?? "", notes: `Revision of ${q.number}`,
    items: q.items.map((i) => ({ productId: i.productId, description: i.description, hsn: i.hsn, qty: i.qty, unit: i.unit, unitPrice: Number(i.unitPrice), discountPct: i.discountPct, taxRate: i.taxRate })),
  });
  redirect(`/quotations/${newId}/edit`);
});
}
