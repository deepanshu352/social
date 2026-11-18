"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { CallPanel } from "@/components/CallPanel";

type Lead = { id: string; number: number; name: string; phone: string; companyName: string | null; city: string | null; product: string | null; budget: number | null; status: string; score: number; scoreBand: string; source: string };
type Act = { id: string; type: string; body: string; createdAt: string };
type Disp = { key: string; label: string; callback?: boolean };

export function Dialer({ dispositions, script }: { dispositions: Disp[]; script: string }) {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null);
  const [acts, setActs] = useState<Act[]>([]);
  const [meta, setMeta] = useState<{ remaining: number; reason?: string } | null>(null);
  const [done, setDone] = useState(0);
  const [wrap, setWrap] = useState(5);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [filters, setFilters] = useState({ mine: true, source: "" });
  const skip = useRef<string[]>([]);
  const pausedRef = useRef(false);

  const fetchNext = useCallback(async () => {
    const r = await fetch("/api/dialer/next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ skip: skip.current, mine: filters.mine, source: filters.source || undefined }) });
    const j = await r.json();
    if (!r.ok) { alert(j.error?.message ?? "Failed"); setRunning(false); return; }
    setLead(j.lead); setActs(j.activities ?? []); setMeta({ remaining: j.remaining, reason: j.reason });
    if (j.lead) skip.current.push(j.lead.id); else setRunning(false);
  }, [filters]);

  function afterCall() {
    setDone((d) => d + 1);
    setLead(null);
    if (pausedRef.current) return;
    let n = wrap;
    setCountdown(n);
    const t = setInterval(() => {
      n -= 1; setCountdown(n);
      if (n <= 0) { clearInterval(t); setCountdown(null); if (!pausedRef.current) fetchNext(); }
    }, 1000);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {!running ? (
          <div className="card card-pad space-y-4">
            <div className="text-sm text-muted">The dialer pulls your due follow-ups first, then your highest-scored open leads. DND numbers and leads called in the last hour are skipped automatically.</div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} /> Only my leads</label>
              <label className="flex items-center gap-2">Source
                <select className="input w-auto py-1" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
                  <option value="">All</option>{["facebook", "google_ads", "website", "referral", "import", "campaign", "whatsapp"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">Wrap-up <input type="number" min={0} max={60} value={wrap} onChange={(e) => setWrap(Number(e.target.value))} className="input w-16 py-1" /> sec</label>
            </div>
            <button className="btn-primary" onClick={() => { setRunning(true); setPaused(false); pausedRef.current = false; fetchNext(); }}>Start dialing session</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm">
            <span><span className={`mr-2 inline-block h-2 w-2 rounded-full ${paused ? "bg-amber-500" : "bg-green-600"}`} />{paused ? "On break" : "Session active"} · {done} calls this session · {meta?.remaining ?? 0} in queue</span>
            <div className="flex gap-2">
              {paused
                ? <button className="btn-primary btn-sm" onClick={() => { setPaused(false); pausedRef.current = false; if (!lead) fetchNext(); }}>Resume</button>
                : <button className="btn-secondary btn-sm" onClick={() => { setPaused(true); pausedRef.current = true; }}>Take a break</button>}
              <button className="btn-ghost btn-sm" onClick={() => { setRunning(false); setLead(null); setPaused(true); pausedRef.current = true; }}>Stop</button>
            </div>
          </div>
        )}

        {countdown != null && <div className="card card-pad text-center text-sm text-muted">Next lead in <b className="text-ink">{countdown}s</b>… <button className="link ml-2" onClick={() => { setPaused(true); pausedRef.current = true; setCountdown(null); }}>Pause</button></div>}

        {running && !lead && countdown == null && meta?.remaining === 0 && <div className="card card-pad text-center text-sm">🎉 Queue empty — no more leads to call right now.</div>}

        {lead && (
          <div className="card card-pad space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/leads/${lead.id}`} target="_blank" className="text-lg font-semibold hover:underline">{lead.name}</Link>
                <div className="text-sm text-muted">LD-{lead.number}{lead.companyName && ` · ${lead.companyName}`}{lead.city && ` · ${lead.city}`} · {lead.source.replace("_", " ")}</div>
              </div>
              <div className="text-right text-xs text-muted"><div className="font-medium text-ink">Score {lead.score} · {lead.scoreBand}</div>{meta?.reason}</div>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Interested in</dt><dd>{lead.product ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">Budget</dt><dd>{lead.budget ? `₹${(lead.budget / 100).toLocaleString("en-IN")}` : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Status</dt><dd className="capitalize">{lead.status}</dd></div>
            </dl>
            {acts.length > 0 && (
              <div><div className="mb-1 text-xs font-medium text-muted">Recent activity</div>
                <ul className="space-y-1 text-sm">{acts.map((a) => <li key={a.id} className="truncate"><span className="text-xs text-muted">{new Date(a.createdAt).toLocaleDateString("en-IN")} · </span>{a.body}</li>)}</ul>
              </div>
            )}
            <CallPanel key={lead.id} leadId={lead.id} name={lead.name} phone={lead.phone} dispositions={dispositions} onDone={afterCall} autoStart={!paused} />
            <button className="btn-ghost btn-sm" onClick={() => { setLead(null); fetchNext(); }}>Skip this lead</button>
          </div>
        )}
      </div>
      <div className="card card-pad">
        <div className="mb-2 text-sm font-semibold">Call script</div>
        <div className="whitespace-pre-wrap text-sm text-muted">{script}</div>
      </div>
    </div>
  );
}
