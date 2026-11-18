"use client";
import { useRef, useState } from "react";
import { Sparkles, Upload } from "lucide-react";
import { submitExpense } from "./actions";

const CATS = ["Travel", "Fuel", "Food", "Office", "Marketing", "Equipment", "Accommodation", "Telecom", "Miscellaneous"];

export function ExpenseForm() {
  const form = useRef<HTMLFormElement>(null);
  const [fileId, setFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, unknown> | null>(null);

  async function upload(file: File) {
    setBusy(true); setNote(null);
    const fd = new FormData(); fd.set("file", file);
    try {
      const r = await fetch("/api/ai/receipt", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Upload failed");
      setFileId(j.fileId);
      const x = j.extracted;
      if (x && form.current) {
        const f = form.current.elements as unknown as Record<string, HTMLInputElement>;
        if (x.total_amount_inr != null) f.amount.value = String(x.total_amount_inr);
        if (x.tax_amount_inr != null) f.taxAmount.value = String(x.tax_amount_inr);
        if (x.vendor_name) f.vendorName.value = x.vendor_name;
        if (x.bill_number) f.billNumber.value = x.bill_number;
        if (x.bill_date) f.expenseDate.value = x.bill_date;
        if (x.category) f.category.value = x.category;
        if (x.description) f.description.value = x.description;
        setAi(x);
        setNote(`AI filled the form (${x.confidence} confidence). Please check before submitting.`);
      } else setNote(j.note ?? "Receipt attached.");
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form ref={form} action={async (fd) => { await submitExpense(fd); form.current?.reset(); setFileId(""); setAi(null); setNote("Submitted for approval ✓"); }} className="space-y-3">
      <input type="hidden" name="receiptId" value={fileId} />
      {ai && <input type="hidden" name="aiExtracted" value={JSON.stringify(ai)} />}
      <label className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm ${fileId ? "border-green-400 bg-green-50/50" : "border-line hover:border-brand-500"}`}>
        {busy ? <><Sparkles className="animate-pulse text-fuchsia-600" size={20} />Reading receipt…</> : fileId ? <>✓ Receipt attached <span className="text-xs text-muted">click to replace</span></> : <><Upload size={20} className="text-muted" /><span><b>Upload bill / receipt</b> — photo or PDF</span><span className="text-xs text-muted">AI reads the amount, vendor, date and GST for you</span></>}
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {note && <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">{note}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label">Amount (₹) *</span><input name="amount" required inputMode="decimal" className="input" /></label>
        <label className="block"><span className="label">GST in bill (₹)</span><input name="taxAmount" inputMode="decimal" className="input" /></label>
        <label className="block"><span className="label">Category</span><select name="category" className="input">{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="block"><span className="label">Date *</span><input name="expenseDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></label>
        <label className="block"><span className="label">Vendor</span><input name="vendorName" className="input" /></label>
        <label className="block"><span className="label">Bill no.</span><input name="billNumber" className="input" /></label>
      </div>
      <label className="block"><span className="label">Purpose</span><input name="description" className="input" placeholder="e.g. Client visit — Noida site" /></label>
      <button className="btn-primary w-full" disabled={busy}>Submit claim</button>
    </form>
  );
}
