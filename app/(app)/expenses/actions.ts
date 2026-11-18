"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { nextNumber } from "@/lib/db";
import { requestApproval } from "@/lib/approvals";
import { emit } from "@/lib/events";
import { audit } from "@/lib/audit";
import { rupeesToPaise } from "@/lib/money";
import { optStr, str } from "@/lib/utils";

/** Policy limits per claim (paise) used for anomaly flags (BRD §46, §77). */
const LIMITS: Record<string, number> = { Food: 50_000, Travel: 150_000, Fuel: 300_000, Accommodation: 350_000, Telecom: 200_000 };

export async function submitExpense(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("hr.self", { mod: "hr" });
  const amount = rupeesToPaise(str(fd.get("amount")));
  if (amount <= 0n) throw new Error("Enter the amount");
  const date = new Date(str(fd.get("expenseDate")) || Date.now());
  if (date > new Date()) throw new Error("Expense date can't be in the future");
  const category = str(fd.get("category")) || "Miscellaneous";
  const vendorName = optStr(fd.get("vendorName")), billNumber = optStr(fd.get("billNumber"));
  const receiptId = optStr(fd.get("receiptId"));
  const flags: string[] = [];
  if (LIMITS[category] && Number(amount) > LIMITS[category]) flags.push(`Above ${category} policy limit (₹${LIMITS[category] / 100})`);
  if (!receiptId) flags.push("No receipt attached");
  if (Date.now() - date.getTime() > 30 * 86400_000) flags.push("Submitted more than 30 days after the expense");
  const dup = await ctx.db.expense.findFirst({ where: { OR: [{ membershipId: ctx.membership.id, amount, expenseDate: date }, ...(billNumber ? [{ billNumber, vendorName }] : [])], status: { not: "rejected" } } });
  if (dup) flags.push(`Possible duplicate of EXP-${dup.number}`);
  if (receiptId) {
    const blob = await ctx.db.fileBlob.findFirst({ where: { id: receiptId, uploadedById: ctx.membership.id } });
    if (!blob) throw new Error("Receipt not found");
    const twins = await ctx.db.fileBlob.findMany({ where: { sha256: blob.sha256, NOT: { id: blob.id } }, select: { id: true } });
    if (twins.length && (await ctx.db.expense.findFirst({ where: { receiptId: { in: twins.map((t) => t.id) }, status: { not: "rejected" } } }))) flags.push("Same receipt file used on another claim");
  }
  const exp = await ctx.db.expense.create({
    data: {
      tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "expense"), membershipId: ctx.membership.id, category, vendorName, billNumber, amount,
      taxAmount: rupeesToPaise(str(fd.get("taxAmount"))), expenseDate: date, description: optStr(fd.get("description")), receiptId, flags, status: "submitted",
      aiExtracted: fd.get("aiExtracted") ? JSON.parse(String(fd.get("aiExtracted"))) : undefined,
    },
  });
  const req = await requestApproval(ctx, "expense", exp.id, `Expense EXP-${exp.number}: ${category} ₹${(Number(amount) / 100).toLocaleString("en-IN")} — ${ctx.user.name}`, amount);
  if (!req) await ctx.db.expense.update({ where: { id: exp.id }, data: { status: "approved" } });
  await audit(ctx, "expense.submit", "Expense", exp.id, null, { amount, category, flags });
  await emit(ctx.tenant.id, "expense.submitted", { id: exp.id, expenseId: exp.id, amount: Number(amount), category, membershipId: ctx.membership.id, ownerId: ctx.membership.id, flags: flags.join("; ") });
  revalidatePath("/expenses");
});
}

export async function reimburse(id: string) {
  return guarded(async () => {
  const ctx = await authorize("expense.reimburse");
  const e = await ctx.db.expense.findFirst({ where: { id, status: "approved" } });
  if (!e) throw new Error("Only approved claims can be reimbursed");
  await ctx.db.expense.update({ where: { id }, data: { status: "reimbursed", reimbursedAt: new Date() } });
  await ctx.db.notification.create({ data: { tenantId: ctx.tenant.id, membershipId: e.membershipId, title: `EXP-${e.number} reimbursed`, body: `₹${(Number(e.amount) / 100).toLocaleString("en-IN")}`, link: "/expenses" } });
  await audit(ctx, "expense.reimburse", "Expense", id);
  revalidatePath("/expenses");
});
}
