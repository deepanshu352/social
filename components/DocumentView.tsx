import type { Contact, Tenant } from "@prisma/client";
import { inr } from "@/lib/money";
import { stateName } from "@/lib/india";
import { fmtDate } from "@/lib/utils";

type Item = { id: string; description: string; hsn: string | null; qty: number; unit: string; unitPrice: bigint; discountPct: number; taxRate: number; taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint; lineTotal: bigint };
type Doc = { number: string | null; issueDate: Date; placeOfSupply: string; subtotal: bigint; discount: bigint; tax: bigint; roundOff: bigint; total: bigint; terms: string | null; notes: string | null; items: Item[]; contact: Contact };

/** Printable GST document (tax invoice / quotation). Used internally and on public links. */
export function DocumentView({ doc, tenant, title, dateLabel, date2, extra }: { doc: Doc; tenant: Tenant; title: string; dateLabel: string; date2: Date; extra?: React.ReactNode }) {
  const inter = tenant.stateCode !== doc.placeOfSupply;
  const sum = (k: "cgst" | "sgst" | "igst" | "taxable") => doc.items.reduce((a, i) => a + i[k], 0n);
  return (
    <div className="print-area card mx-auto max-w-4xl p-8 text-sm">
      <div className="flex flex-wrap justify-between gap-6 border-b border-line pb-6">
        <div>
          <div className="text-xl font-semibold">{tenant.name}</div>
          <div className="mt-1 whitespace-pre-line text-muted">{tenant.address}</div>
          {tenant.gstin && <div className="mt-1">GSTIN: <b>{tenant.gstin}</b></div>}
          <div className="text-muted">{[tenant.phone, tenant.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold uppercase tracking-wide text-brand-700">{title}</div>
          <div className="mt-1">No. <b>{doc.number ?? "DRAFT"}</b></div>
          <div className="text-muted">Date: {fmtDate(doc.issueDate)}</div>
          <div className="text-muted">{dateLabel}: {fmtDate(date2)}</div>
          {extra}
        </div>
      </div>
      <div className="grid gap-6 border-b border-line py-5 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase text-muted">Bill to</div>
          <div className="mt-1 font-medium">{doc.contact.companyName ?? doc.contact.name}</div>
          {doc.contact.companyName && <div>{doc.contact.name}</div>}
          <div className="whitespace-pre-line text-muted">{doc.contact.address}</div>
          {doc.contact.gstin && <div>GSTIN: {doc.contact.gstin}</div>}
        </div>
        <div className="md:text-right">
          <div className="text-xs font-semibold uppercase text-muted">Place of supply</div>
          <div className="mt-1">{stateName(doc.placeOfSupply)} ({doc.placeOfSupply})</div>
          <div className="text-muted">{inter ? "Inter-state supply (IGST)" : "Intra-state supply (CGST + SGST)"}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="my-4 w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase text-muted">
            <th className="py-2">#</th><th>Item</th><th>HSN/SAC</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Disc</th><th className="text-right">Taxable</th><th className="text-right">GST</th><th className="text-right">Amount</th>
          </tr></thead>
          <tbody>{doc.items.map((it, i) => (
            <tr key={it.id} className="border-b border-line/70">
              <td className="py-2">{i + 1}</td><td>{it.description}</td><td>{it.hsn ?? "—"}</td>
              <td className="text-right tabular-nums">{it.qty} {it.unit}</td><td className="text-right tabular-nums">{inr(it.unitPrice)}</td>
              <td className="text-right">{it.discountPct ? `${it.discountPct}%` : "—"}</td><td className="text-right tabular-nums">{inr(it.taxable)}</td>
              <td className="text-right">{it.taxRate / 100}%</td><td className="text-right tabular-nums">{inr(it.lineTotal)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-between gap-6">
        <div className="max-w-md space-y-3 text-xs text-muted">
          {doc.notes && <div><b className="text-ink">Notes:</b> {doc.notes}</div>}
          {doc.terms && <div className="whitespace-pre-line"><b className="text-ink">Terms:</b> {doc.terms}</div>}
          {tenant.bankDetails && <div className="whitespace-pre-line"><b className="text-ink">Bank / UPI:</b> {tenant.bankDetails}</div>}
        </div>
        <div className="w-72 space-y-1">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular-nums">{inr(doc.subtotal)}</span></div>
          {doc.discount > 0n && <div className="flex justify-between"><span className="text-muted">Discount</span><span className="tabular-nums">− {inr(doc.discount)}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Taxable value</span><span className="tabular-nums">{inr(sum("taxable"))}</span></div>
          {inter ? <div className="flex justify-between"><span className="text-muted">IGST</span><span className="tabular-nums">{inr(sum("igst"))}</span></div> : <>
            <div className="flex justify-between"><span className="text-muted">CGST</span><span className="tabular-nums">{inr(sum("cgst"))}</span></div>
            <div className="flex justify-between"><span className="text-muted">SGST</span><span className="tabular-nums">{inr(sum("sgst"))}</span></div>
          </>}
          {doc.roundOff !== 0n && <div className="flex justify-between"><span className="text-muted">Round off</span><span className="tabular-nums">{inr(doc.roundOff)}</span></div>}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{inr(doc.total)}</span></div>
        </div>
      </div>
      <div className="mt-10 text-right text-xs text-muted">For {tenant.name}<div className="mt-8">Authorised signatory</div></div>
    </div>
  );
}
