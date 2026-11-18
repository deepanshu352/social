import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { DocumentView } from "@/components/DocumentView";
import { PrintButton } from "@/components/client";
import { notify } from "@/lib/notify";
import { emit } from "@/lib/events";
import { audit } from "@/lib/audit";
import { fmtDate, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Quotation", robots: { index: false } };

async function respond(token: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const q = await prisma.quotation.findUnique({ where: { publicToken: token } });
  if (!q || !["sent", "viewed", "approved"].includes(q.status) || q.validUntil < new Date()) throw new Error("This quotation can no longer be accepted.");
  const accept = str(fd.get("decision")) === "accept";
  const name = str(fd.get("name"));
  if (accept && (!name || fd.get("agree") !== "on")) throw new Error("Type your name and tick the box to accept.");
  const h = await headers();
  await prisma.quotation.update({ where: { id: q.id }, data: accept ? { status: "accepted", acceptedAt: new Date(), acceptedBy: name } : { status: "rejected", rejectedReason: str(fd.get("reason")) || "Rejected by customer" } });
  await prisma.activity.create({ data: { tenantId: q.tenantId, contactId: q.contactId, dealId: q.dealId, type: "system", body: `Customer ${accept ? `accepted quotation ${q.number} (signed: ${name})` : `rejected quotation ${q.number}`}` } });
  await audit({ tenantId: q.tenantId, actorName: accept ? `Customer: ${name}` : "Customer", actorType: "system" }, accept ? "quotation.accepted" : "quotation.rejected_by_customer", "Quotation", q.id, null, { ip: h.get("x-forwarded-for"), userAgent: h.get("user-agent"), at: new Date().toISOString() });
  await notify(q.tenantId, q.ownerId, `${q.number} ${accept ? "accepted 🎉" : "rejected"} by customer`, accept ? `Signed by ${name}` : str(fd.get("reason")), `/quotations/${q.id}`);
  if (accept) await emit(q.tenantId, "quotation.accepted", { id: q.id, number: q.number, total: q.total, ownerId: q.ownerId, contactId: q.contactId });
  revalidatePath(`/q/${token}`);
});
}

export default async function PublicQuote({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await prisma.quotation.findUnique({ where: { publicToken: token }, include: { items: { orderBy: { sort: "asc" } }, contact: true, tenant: true } });
  if (!q || ["draft", "pending_approval", "cancelled"].includes(q.status)) notFound();
  await prisma.quotation.update({ where: { id: q.id }, data: { viewCount: { increment: 1 }, viewedAt: new Date(), status: q.status === "sent" ? "viewed" : undefined } });
  const canRespond = ["sent", "viewed", "approved"].includes(q.status) && q.validUntil >= new Date();
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="no-print mx-auto mb-4 flex max-w-4xl justify-end"><PrintButton /></div>
      <DocumentView doc={q} tenant={q.tenant} title="Quotation" dateLabel="Valid until" date2={q.validUntil} />
      <div className="no-print mx-auto mt-6 max-w-4xl">
        {q.status === "accepted" && <div className="card card-pad text-center text-sm">✅ Accepted by <b>{q.acceptedBy}</b> on {fmtDate(q.acceptedAt, true)}. Thank you!</div>}
        {q.status === "rejected" && <div className="card card-pad text-center text-sm">This quotation was declined.</div>}
        {canRespond && (
          <form action={respond.bind(null, token)} className="card card-pad space-y-3">
            <div className="font-semibold">Accept this quotation</div>
            <input name="name" placeholder="Type your full name as signature" className="input" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="agree" /> I accept the items, prices and terms above.</label>
            <div className="flex flex-wrap gap-2">
              <button name="decision" value="accept" className="btn-primary">Accept & sign</button>
              <input name="reason" placeholder="Reason, if declining" className="input max-w-xs" />
              <button name="decision" value="reject" className="btn-secondary">Decline</button>
            </div>
            <p className="text-xs text-muted">Your name, IP address and time are recorded as evidence of acceptance.</p>
          </form>
        )}
      </div>
    </div>
  );
}
