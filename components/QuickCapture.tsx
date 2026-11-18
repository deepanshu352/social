"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Sparkles, X } from "lucide-react";

type Capture = { intent: string; customer_name: string | null; company: string | null; phone: string | null; city: string | null; products: { name: string; quantity: number | null }[]; budget_inr: number | null; follow_up_at: string | null; follow_up_type: string | null; note: string; priority: string };

/** Voice / text → CRM (BRD §57). Speak or type in English, Hindi or Hinglish; review; apply. */
export function QuickCapture({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ capture: Capture; match: { id: string; name: string; number: number } | null; products: { id: string; name: string }[] } | null>(null);
  const [acts, setActs] = useState({ lead: true, note: true, followUp: true, task: true });
  const [done, setDone] = useState<{ label: string; href: string }[] | null>(null);
  const rec = useRef<any>(null);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("open-quick-capture", h);
    return () => window.removeEventListener("open-quick-capture", h);
  }, []);

  function mic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setErr("Voice input isn't supported in this browser — type instead."); return; }
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); r.lang = "en-IN"; r.interimResults = true; r.continuous = true;
    r.onresult = (e: any) => setText(Array.from(e.results).map((x: any) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  }
  async function parse() {
    setBusy(true); setErr(null); setRes(null); setDone(null);
    try { const r = await fetch("/api/ai/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message); setRes(j); setActs({ lead: !j.match, note: true, followUp: !!j.capture.follow_up_at, task: j.capture.products.length > 0 }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function apply() {
    if (!res) return;
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/ai/capture/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capture: res.capture, leadId: res.match?.id ?? null, actions: acts }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message); setDone(j.done); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const reset = () => { setText(""); setRes(null); setDone(null); setErr(null); };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost hidden sm:inline-flex" title="AI quick capture (voice / text → CRM)"><Sparkles size={17} className="text-fuchsia-600" /><span className="hidden lg:inline">Quick capture</span></button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI quick capture">
            <div className="flex items-center justify-between border-b border-line px-5 py-3"><div className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-fuchsia-600" />Quick capture</div><button onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="space-y-3 p-5">
              {!enabled && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI isn&apos;t configured on this server (ANTHROPIC_API_KEY).</p>}
              {!done && (<>
                <div className="relative">
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="input pr-12" placeholder={"“Rahul Verma from Verma Traders, 98765 43210, wants 50 GI pipes 25mm, delivery Friday, call him kal 11 baje”"} />
                  <button type="button" onClick={mic} className={`absolute right-2 top-2 rounded-full p-2 ${listening ? "animate-pulse bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`} aria-label="Dictate">{listening ? <MicOff size={16} /> : <Mic size={16} />}</button>
                </div>
                {!res && <button onClick={parse} disabled={!enabled || busy || !text.trim()} className="btn-primary w-full">{busy ? "Understanding…" : "Understand note"}</button>}
              </>)}
              {res && !done && (
                <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
                  <div className="grid grid-cols-[100px_1fr] gap-y-1">
                    <span className="text-muted">Customer</span><span>{res.capture.customer_name ?? "—"}{res.capture.company && ` · ${res.capture.company}`}</span>
                    <span className="text-muted">Phone</span><span>{res.capture.phone ?? "—"}</span>
                    <span className="text-muted">Products</span><span>{res.capture.products.map((p) => `${p.name}${p.quantity ? ` × ${p.quantity}` : ""}`).join(", ") || "—"}</span>
                    <span className="text-muted">Follow-up</span><span>{res.capture.follow_up_at ? new Date(res.capture.follow_up_at).toLocaleString("en-IN") : "—"}</span>
                    <span className="text-muted">Priority</span><span className="capitalize">{res.capture.priority}</span>
                    <span className="text-muted">Summary</span><span>{res.capture.note}</span>
                  </div>
                  <div className="border-t border-line pt-3">
                    {res.match ? <p className="mb-2">Matches existing lead <Link className="link" href={`/leads/${res.match.id}`}>LD-{res.match.number} {res.match.name}</Link></p> : <label className="flex items-center gap-2"><input type="checkbox" checked={acts.lead} onChange={(e) => setActs({ ...acts, lead: e.target.checked })} /> Create a new lead</label>}
                    <label className="flex items-center gap-2"><input type="checkbox" checked={acts.note} onChange={(e) => setActs({ ...acts, note: e.target.checked })} /> Add note to timeline</label>
                    {res.capture.follow_up_at && <label className="flex items-center gap-2"><input type="checkbox" checked={acts.followUp} onChange={(e) => setActs({ ...acts, followUp: e.target.checked })} /> Schedule follow-up</label>}
                    {res.capture.products.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={acts.task} onChange={(e) => setActs({ ...acts, task: e.target.checked })} /> Create task to prepare quotation</label>}
                  </div>
                  <div className="flex gap-2"><button onClick={apply} disabled={busy} className="btn-primary flex-1">{busy ? "Saving…" : "Apply to CRM"}</button><button onClick={() => setRes(null)} className="btn-secondary">Edit</button></div>
                </div>
              )}
              {done && <div className="space-y-2"><p className="font-medium text-green-700">Done ✓</p><ul className="space-y-1 text-sm">{done.map((d) => <li key={d.label}><Link className="link" href={d.href} onClick={() => setOpen(false)}>{d.label}</Link></li>)}</ul><button onClick={reset} className="btn-secondary w-full">Capture another</button></div>}
              {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
