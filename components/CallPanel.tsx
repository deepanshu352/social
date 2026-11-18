"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, PhoneMissed } from "lucide-react";

type Disp = { key: string; label: string; callback?: boolean };
type Phase = "idle" | "dialing" | "ringing" | "connected" | "wrapup" | "saving";

/**
 * Click-to-call widget (BRD §16). Server enforces permissions, DND and calling hours.
 * With the mock provider the agent drives answer/end; real providers push status via webhook
 * and this widget polls the call record.
 */
export function CallPanel({ leadId, contactId, name, phone, dispositions, onDone, autoStart }: {
  leadId?: string; contactId?: string; name: string; phone: string | null; dispositions: Disp[]; onDone?: () => void; autoStart?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [disp, setDisp] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(false);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => { if (autoStart && !started.current && phone) { started.current = true; start(); } }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  async function api(url: string, body: object, method = "POST") {
    const r = await fetch(url, { method, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message ?? "Request failed");
    return j;
  }

  async function start() {
    setError(null); setPhase("dialing");
    try {
      const j = await api("/api/calls", { leadId, contactId });
      setCallId(j.call.id); setPhase("ringing");
    } catch (e) { setError((e as Error).message); setPhase("idle"); }
  }
  async function act(action: "answer" | "end" | "no_answer" | "busy") {
    if (!callId) return;
    try {
      await api(`/api/calls/${callId}`, { action }, "PATCH");
      if (action === "answer") {
        setPhase("connected"); setSecs(0);
        timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
      } else {
        if (timer.current) clearInterval(timer.current);
        setDisp(action === "no_answer" ? "no_answer" : action === "busy" ? "busy" : "");
        setPhase("wrapup");
      }
    } catch (e) { setError((e as Error).message); }
  }
  async function save(fd: FormData) {
    if (!callId) return;
    setPhase("saving");
    try {
      await api(`/api/calls/${callId}`, { action: "dispose", disposition: fd.get("disposition"), notes: fd.get("notes"), callbackAt: fd.get("callbackAt") || null }, "PATCH");
      setPhase("idle"); setCallId(null); setDisp("");
      router.refresh();
      onDone?.();
    } catch (e) { setError((e as Error).message); setPhase("wrapup"); }
  }

  const needsCallback = dispositions.find((d) => d.key === disp)?.callback;
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      {phase === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><div className="truncate text-sm font-medium">{name}</div><div className="text-xs text-muted">{phone ?? "No phone number"}</div></div>
          <button onClick={start} disabled={!phone} className="btn-primary"><Phone size={15} /> Call</button>
        </div>
      )}
      {(phase === "dialing" || phase === "ringing") && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-500" />{phase === "dialing" ? "Connecting via telephony bridge…" : `Ringing ${name}…`}</div>
          {phase === "ringing" && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => act("answer")} className="btn-primary btn-sm"><Phone size={13} /> Customer answered</button>
              <button onClick={() => act("no_answer")} className="btn-secondary btn-sm"><PhoneMissed size={13} /> No answer</button>
              <button onClick={() => act("busy")} className="btn-secondary btn-sm">Busy</button>
            </div>
          )}
          <p className="text-[11px] text-muted">Demo telephony: your phone rings first, then the customer. Mark the outcome here.</p>
        </div>
      )}
      {phase === "connected" && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-green-600" /> On call · <span className="font-mono tabular-nums">{mm}</span></div>
          <button onClick={() => act("end")} className="btn-danger btn-sm"><PhoneOff size={13} /> End call</button>
        </div>
      )}
      {(phase === "wrapup" || phase === "saving") && (
        <form action={save} className="space-y-2.5">
          <div className="text-sm font-medium">Call outcome <span className="text-xs font-normal text-muted">(required before the next call)</span></div>
          <select name="disposition" required value={disp} onChange={(e) => setDisp(e.target.value)} className="input">
            <option value="" disabled>Select disposition…</option>
            {dispositions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          {needsCallback && <input type="datetime-local" name="callbackAt" required className="input" />}
          <textarea name="notes" rows={2} placeholder="Notes: requirement, objection, next step…" className="input" />
          <button disabled={phase === "saving"} className="btn-primary w-full">{phase === "saving" ? "Saving…" : "Save outcome"}</button>
        </form>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
