import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DocumentView } from "@/components/DocumentView";
import { PrintButton } from "@/components/client";
import { inr } from "@/lib/money";

export const metadata = { title: "Invoice", robots: { index: false } };

export default async function PublicInvoice({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await prisma.invoice.findUnique({ where: { publicToken: token }, include: { items: { orderBy: { sort: "asc" } }, contact: true, tenant: true } });
  if (!inv || inv.status === "draft") notFound();
  const open = ["issued", "partially_paid", "overdue"].includes(inv.status);
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-4xl items-center justify-between gap-3">
        <div className="text-sm">{open ? <>Balance due: <b>{inr(inv.balance)}</b></> : inv.status === "paid" ? "✅ Paid in full — thank you!" : `Status: ${inv.status}`}</div>
        <PrintButton />
      </div>
      <DocumentView doc={inv} tenant={inv.tenant} title="Tax Invoice" dateLabel="Due date" date2={inv.dueDate} />
      {open && (
        <div className="no-print card card-pad mx-auto mt-6 max-w-4xl text-sm">
          <div className="font-semibold">How to pay</div>
          <p className="mt-1 whitespace-pre-line text-muted">{inv.tenant.bankDetails ?? "Please contact us for payment details."}</p>
          <p className="mt-2 text-xs text-muted">Online payment (UPI / cards) appears here once a payment gateway is connected in Settings → Billing.</p>
        </div>
      )}
    </div>
  );
}
