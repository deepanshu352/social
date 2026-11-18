"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";

export function AskKb() {
  const [q, setQ] = useState("");
  const [a, setA] = useState<{ answer: string; sources: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card card-pad">
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await fetch("/api/ai/kb", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message); setA(j); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask: How many casual leaves do I get? What's the hotel limit for travel?" className="input" />
        <button disabled={busy || !q.trim()} className="btn-primary"><Sparkles size={15} />{busy ? "Thinking…" : "Ask AI"}</button>
      </form>
      {a && <div className="mt-4 whitespace-pre-wrap rounded-lg bg-brand-50/60 p-4 text-sm leading-relaxed">{a.answer}</div>}
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
    </div>
  );
}
