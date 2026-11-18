"use server";
import { guarded } from "@/lib/action";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { cancelInvoice, issueInvoice, parsePayload, recordPayment, saveInvoice } from "@/lib/documents";
import { rupeesToPaise } from "@/lib/money";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { optStr, str } from "@/lib/utils";

export async function createInvoiceAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("invoice.create");
  redirect(`/invoices/${await saveInvoice(ctx, null, parsePayload(fd))}`);
});
}
export async function updateInvoiceAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("invoice.create");
  await saveInvoice(ctx, id, parsePayload(fd));
  redirect(`/invoices/${id}`);
});
}
export async function issueAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("invoice.create");
  await issueInvoice(ctx, id);
  revalidatePath(`/invoices/${id}`);
});
}
export async function paymentAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("payment.record");
  await recordPayment(ctx, id, rupeesToPaise(str(fd.get("amount"))), str(fd.get("method")) || "upi", optStr(fd.get("reference")), new Date(str(fd.get("receivedOn")) || Date.now()));
  revalidatePath(`/invoices/${id}`);
});
}
export async function cancelAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("invoice.cancel");
  await cancelInvoice(ctx, id, str(fd.get("reason")));
  revalidatePath(`/invoices/${id}`);
});
}
export async function reminderAction(id: string) {
  return guarded(async () => {
  const ctx = await authorize("invoice.view");
  const inv = await ctx.db.invoice.findFirstOrThrow({ where: { id }, include: { contact: true } });
  // Integration point: send via email / WhatsApp provider with the public link.
  await ctx.db.invoice.update({ where: { id }, data: { remindersSent: { increment: 1 } } });
  await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: inv.contactId, type: "email", body: `Payment reminder sent for ${inv.number} (balance ₹${(Number(inv.balance) / 100).toLocaleString("en-IN")})`, actorId: ctx.membership.id } });
  await audit(ctx, "invoice.reminder", "Invoice", id);
  await notify(ctx.tenant.id, ctx.membership.id, `Reminder queued for ${inv.contact.name}`, inv.number ?? undefined, `/invoices/${id}`);
  revalidatePath(`/invoices/${id}`);
});
}
