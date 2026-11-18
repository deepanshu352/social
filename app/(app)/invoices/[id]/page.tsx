import Link from "next/link";
import { notFound } from "next/navigation";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton, PrintButton, CopyButton } from "@/components/client";
import { DocumentView } from "@/components/DocumentView";
import { issueAction, paymentAction, cancelAction, reminderAction } from "../actions";
import { inr } from "@/lib/money";
import { fmtDate, titleCase } from "@/lib/utils";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("invoice.view", "invoices");
  const inv = await ctx.db.invoice.findFirst({ where: { id, ...(await scopeWhere(ctx, "invoice.view")) }, include: { items: { orderBy: { sort: "asc" } }, contact: true, payments: { orderBy: { receivedOn: "desc" } } } });
  if (!inv) notFound();
  const open = ["issued", "partially_paid", "overdue"].includes(inv.status);
  const late = open && inv.dueDate < new Date();
  return (
    <>
      <PageHeader back={{ href: "/invoices", label: "Invoices" }} title={<span className="flex items-center gap-2">{inv.number ?? "Draft invoice"} <StatusBadge status={late ? "overdue" : inv.status} /></span>}
        subtitle={`${inv.contact.name} · Balance ${inr(inv.balance)}${inv.remindersSent ? ` · ${inv.remindersSent} reminder(s) sent` : ""}`}
        actions={<div className="no-print flex flex-wrap gap-2">
          {inv.status === "draft" && has(ctx, "invoice.create") && <><Link href={`/invoices/${id}/edit`} className="btn-secondary">Edit</Link><form action={issueAction.bind(null, id)}><SubmitButton confirm="Issue this invoice? It will be locked and numbered.">Issue invoice</SubmitButton></form></>}
          {open && <CopyButton text={`${process.env.APP_URL ?? ""}/i/${inv.publicToken}`} label="Copy payment link" />}
          {open && <form action={reminderAction.bind(null, id)}><SubmitButton className="btn-secondary">Send reminder</SubmitButton></form>}
          <PrintButton />
        </div>} />

      {inv.status === "cancelled" && <Card className="mb-6 border-red-200 bg-red-50/40"><p className="text-sm"><b>Cancelled:</b> {inv.cancelledReason}</p></Card>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <DocumentView doc={inv} tenant={ctx.tenant} title="Tax Invoice" dateLabel="Due date" date2={inv.dueDate} />
        <div className="no-print space-y-4">
          <Card title="Payments">
            <div className="mb-3 flex justify-between text-sm"><span className="text-muted">Paid</span><span className="font-medium tabular-nums">{inr(inv.amountPaid)} / {inr(inv.total)}</span></div>
            <div className="mb-4 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-green-600" style={{ width: `${inv.total ? Math.min(100, (Number(inv.amountPaid) / Number(inv.total)) * 100) : 0}%` }} /></div>
            {inv.payments.map((p) => <div key={p.id} className="flex justify-between border-t border-line py-1.5 text-sm"><span>{fmtDate(p.receivedOn)} · {titleCase(p.method)}{p.reference && <span className="text-muted"> · {p.reference}</span>}</span><span className="tabular-nums">{inr(p.amount)}</span></div>)}
            {open && has(ctx, "payment.record") && (
              <form action={paymentAction.bind(null, id)} className="mt-4 space-y-2 border-t border-line pt-4">
                <div className="text-sm font-medium">Record payment</div>
                <input name="amount" required inputMode="decimal" defaultValue={Number(inv.balance) / 100} className="input" />
                <div className="grid grid-cols-2 gap-2">
                  <select name="method" className="input"><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="gateway">Payment gateway</option></select>
                  <input name="receivedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                </div>
                <input name="reference" placeholder="UTR / cheque no." className="input" />
                <SubmitButton className="btn-primary w-full">Record payment</SubmitButton>
              </form>
            )}
          </Card>
          {inv.status !== "cancelled" && inv.amountPaid === 0n && inv.status !== "draft" && has(ctx, "invoice.cancel") && (
            <Card title="Cancel invoice">
              <form action={cancelAction.bind(null, id)} className="space-y-2">
                <input name="reason" required placeholder="Reason (kept in audit log)" className="input" />
                <SubmitButton className="btn-danger w-full" confirm="Cancel this invoice? The number is retained.">Cancel invoice</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
