"use client";
import { useMemo, useState } from "react";
import { computeDoc, type LineInput } from "@/lib/pricing";
import { Trash2, Plus } from "lucide-react";

type Product = { id: string; name: string; sku: string; price: number; taxRate: number; hsn: string | null; unit: string };
type Contact = { id: string; name: string; stateCode: string | null; companyName: string | null };
export type DocInitial = { contactId?: string; placeOfSupply?: string; items: LineInput[]; date2?: string; terms?: string; notes?: string; dealId?: string | null };

const rs = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = (): LineInput => ({ description: "", qty: 1, unit: "pcs", unitPrice: 0, discountPct: 0, taxRate: 1800, hsn: "", productId: null });

/** Shared GST line-item editor for quotations and invoices. Totals preview uses the same engine as the server. */
export function DocEditor({ kind, contacts, products, sellerState, states, initial, action, maxDiscount, submitLabel }: {
  kind: "quotation" | "invoice"; contacts: Contact[]; products: Product[]; sellerState: string; states: [string, string][];
  initial: DocInitial; action: (fd: FormData) => void | Promise<void>; maxDiscount?: number; submitLabel: string;
}) {
  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [pos, setPos] = useState(initial.placeOfSupply ?? contacts.find((c) => c.id === initial.contactId)?.stateCode ?? sellerState);
  const [items, setItems] = useState<LineInput[]>(initial.items.length ? initial.items : [blank()]);
  const [date2, setDate2] = useState(initial.date2 ?? "");
  const [terms, setTerms] = useState(initial.terms ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const totals = useMemo(() => computeDoc(items, sellerState, pos), [items, sellerState, pos]);
  const inter = sellerState !== pos;
  const overLimit = maxDiscount != null && totals.maxDiscountPct > maxDiscount;

  const set = (i: number, patch: Partial<LineInput>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const pickProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (p) set(i, { productId: p.id, description: p.name, unitPrice: p.price, taxRate: p.taxRate, hsn: p.hsn ?? "", unit: p.unit });
  };

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify({ contactId, placeOfSupply: pos, items, date2, terms, notes, dealId: initial.dealId ?? null })} />
      <div className="card card-pad grid gap-4 md:grid-cols-3">
        <label className="block"><span className="label">Customer *</span>
          <select required value={contactId} onChange={(e) => { setContactId(e.target.value); const c = contacts.find((x) => x.id === e.target.value); if (c?.stateCode) setPos(c.stateCode); }} className="input">
            <option value="">Select customer…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.companyName ? ` — ${c.companyName}` : ""}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Place of supply</span>
          <select value={pos} onChange={(e) => setPos(e.target.value)} className="input">{states.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <span className="mt-1 block text-xs text-muted">{inter ? "Inter-state → IGST" : "Intra-state → CGST + SGST"}</span>
        </label>
        <label className="block"><span className="label">{kind === "quotation" ? "Valid until" : "Due date"}</span>
          <input type="date" value={date2} onChange={(e) => setDate2(e.target.value)} required className="input" />
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="table min-w-[900px]">
          <thead><tr><th className="w-[28%]">Item</th><th>HSN/SAC</th><th className="w-24">Qty</th><th className="w-32">Rate (₹)</th><th className="w-24">Disc %</th><th className="w-28">GST</th><th className="text-right">Amount</th><th className="w-8"></th></tr></thead>
          <tbody>
            {items.map((l, i) => {
              const line = computeDoc([l], sellerState, pos).lines[0];
              return (
                <tr key={i}>
                  <td>
                    <select value={l.productId ?? ""} onChange={(e) => pickProduct(i, e.target.value)} className="input mb-1 py-1 text-xs">
                      <option value="">— pick product or type below —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                    <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" className="input py-1.5" />
                  </td>
                  <td><input value={l.hsn ?? ""} onChange={(e) => set(i, { hsn: e.target.value })} className="input py-1.5" /></td>
                  <td><input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} className="input py-1.5" /></td>
                  <td><input type="number" min={0} step="0.01" value={l.unitPrice / 100} onChange={(e) => set(i, { unitPrice: Math.round(Number(e.target.value) * 100) })} className="input py-1.5" /></td>
                  <td><input type="number" min={0} max={100} step="0.5" value={l.discountPct} onChange={(e) => set(i, { discountPct: Number(e.target.value) })} className={`input py-1.5 ${maxDiscount != null && l.discountPct > maxDiscount ? "border-amber-500" : ""}`} /></td>
                  <td><select value={l.taxRate} onChange={(e) => set(i, { taxRate: Number(e.target.value) })} className="input py-1.5">{[0, 500, 1200, 1800, 2800].map((t) => <option key={t} value={t}>{t / 100}%</option>)}</select></td>
                  <td className="text-right tabular-nums">{line ? rs(line.lineTotal) : "—"}</td>
                  <td><button type="button" onClick={() => setItems((xs) => xs.length > 1 ? xs.filter((_, k) => k !== i) : [blank()])} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-line p-3"><button type="button" onClick={() => setItems((xs) => [...xs, blank()])} className="btn-ghost btn-sm"><Plus size={14} /> Add line</button></div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="card card-pad space-y-3">
          <label className="block"><span className="label">Terms & conditions</span><textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} className="input" /></label>
          <label className="block"><span className="label">Notes to customer</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" /></label>
        </div>
        <div className="card card-pad space-y-1.5 text-sm">
          <Row k="Subtotal" v={rs(totals.subtotal)} />
          {totals.discount > 0 && <Row k="Discount" v={"− " + rs(totals.discount)} />}
          <Row k="Taxable value" v={rs(totals.taxable)} />
          {inter ? <Row k="IGST" v={rs(totals.igst)} /> : <><Row k="CGST" v={rs(totals.cgst)} /><Row k="SGST" v={rs(totals.sgst)} /></>}
          {totals.roundOff !== 0 && <Row k="Round off" v={rs(totals.roundOff)} />}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{rs(totals.total)}</span></div>
          {overLimit && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">Discount above your {maxDiscount}% limit — this quotation will need manager approval.</p>}
          <button className="btn-primary mt-3 w-full" disabled={!contactId || !totals.lines.length}>{submitLabel}</button>
        </div>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="tabular-nums">{v}</span></div>;
}
