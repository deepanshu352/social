"use client";
import { useActionState } from "react";
import { importLeadsAction } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState(importLeadsAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="file" name="file" accept=".csv,text/csv" className="input" />
      <div className="text-center text-xs text-muted">— or paste CSV —</div>
      <textarea name="csv" rows={8} className="input font-mono text-xs" placeholder={"name,phone,email,company,source,city,budget,product\nRahul Verma,9876543210,rahul@example.com,Verma Traders,facebook,Delhi,50000,Steel pipes"} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="skipDuplicates" defaultChecked /> Skip rows whose phone already exists</label>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Importing…" : "Import leads"}</button>
    </form>
  );
}
