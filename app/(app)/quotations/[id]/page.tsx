import Link from "next/link";
import { notFound } from "next/navigation";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton, PrintButton, CopyButton } from "@/components/client";
import { DocumentView } from "@/components/DocumentView";
import { submitAction, decideAction, markSentAction, convertAction, cancelQuotationAction, reviseAction } from "../actions";
import { fmtDate } from "@/lib/utils";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("quotation.view", "quotations");
  const q = await ctx.db.quotation.findFirst({ where: { id, ...(await scopeWhere(ctx, "quotation.view")) }, include: { items: { orderBy: { sort: "asc" } }, contact: true } });
  if (!q) notFound();
  const link = `${process.env.APP_URL ?? ""}/q/${q.publicToken}`;
  const canCreate = has(ctx, "quotation.create");
  return (
    <>
      <PageHeader back={{ href: "/quotations", label: "Quotations" }} title={<span className="flex items-center gap-2">{q.number} <StatusBadge status={q.status} /></span>}
        subtitle={`${q.contact.name} · ${q.viewCount} customer view${q.viewCount === 1 ? "" : "s"}${q.viewedAt ? ` · last viewed ${fmtDate(q.viewedAt, true)}` : ""}`}
        actions={<div className="no-print flex flex-wrap gap-2">
          {canCreate && ["draft", "rejected", "approved"].includes(q.status) && <Link href={`/quotations/${id}/edit`} className="btn-secondary">Edit</Link>}
          {canCreate && q.status === "draft" && <form action={submitAction.bind(null, id)}><SubmitButton>Submit for approval</SubmitButton></form>}
          {canCreate && q.status === "approved" && <form action={markSentAction.bind(null, id)}><SubmitButton>Mark as sent</SubmitButton></form>}
          {["approved", "sent", "viewed", "accepted"].includes(q.status) && <CopyButton text={link} label="Copy customer link" />}
          {has(ctx, "invoice.create") && ["accepted", "approved", "sent", "viewed"].includes(q.status) && <form action={convertAction.bind(null, id)}><SubmitButton>Convert to invoice</SubmitButton></form>}
          {q.status === "converted" && q.invoiceId && <Link href={`/invoices/${q.invoiceId}`} className="btn-secondary">View invoice</Link>}
          {canCreate && ["sent", "viewed", "rejected", "expired", "accepted"].includes(q.status) && <form action={reviseAction.bind(null, id)}><SubmitButton className="btn-secondary">New revision</SubmitButton></form>}
          {canCreate && !["converted", "cancelled"].includes(q.status) && <form action={cancelQuotationAction.bind(null, id)}><SubmitButton className="btn-ghost" confirm="Cancel this quotation?">Cancel</SubmitButton></form>}
          <PrintButton />
        </div>} />

      {q.status === "pending_approval" && (
        <Card className="no-print mb-6 border-amber-200 bg-amber-50/50" title="Approval required">
          <p className="mb-3 text-sm">Maximum line discount is <b>{q.maxDiscountPct}%</b>, above the requester's limit.</p>
          {has(ctx, "quotation.approve") ? (
            <form action={decideAction.bind(null, id)} className="flex flex-wrap gap-2">
              <input name="comment" placeholder="Comment (optional)" className="input max-w-sm" />
              <SubmitButton name="decision" value="approve">Approve</SubmitButton>
              <SubmitButton name="decision" value="reject" className="btn-danger">Reject</SubmitButton>
            </form>
          ) : <p className="text-sm text-muted">Waiting for a manager to approve.</p>}
        </Card>
      )}
      {q.status === "rejected" && q.rejectedReason && <Card className="no-print mb-6 border-red-200 bg-red-50/40"><p className="text-sm"><b>Rejected:</b> {q.rejectedReason}. Edit and resubmit.</p></Card>}
      {q.status === "accepted" && <Card className="no-print mb-6 border-green-200 bg-green-50/40"><p className="text-sm">Accepted by <b>{q.acceptedBy}</b> on {fmtDate(q.acceptedAt, true)}.</p></Card>}

      <DocumentView doc={q} tenant={ctx.tenant} title="Quotation" dateLabel="Valid until" date2={q.validUntil} />
    </>
  );
}
