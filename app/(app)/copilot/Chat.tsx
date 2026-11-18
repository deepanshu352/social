"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Send } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Show today's business summary",
  "Which hot leads have no follow-up scheduled?",
  "Which invoices above ₹50,000 are overdue?",
  "Who on my team has the best conversion this month?",
  "What does our pipeline look like by stage?",
  "Which top customers haven't bought in 60+ days?",
];

/** Renders markdown-lite: [text](/path) links, **bold**, and line breaks. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) return link[2].startsWith("/") ? <Link key={i} href={link[2]} className="link">{link[1]}</Link> : <span key={i}>{link[1]}</span>;
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

export function Chat({ enabled, name }: { enabled: boolean; name: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [turns, loading]);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    const next = [...turns, { role: "user" as const, content: q.trim() }];
    setTurns(next); setInput(""); setLoading(true); setError(null);
    try {
      const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Failed");
      setTurns([...next, { role: "assistant", content: j.reply }]);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  return (
    <div className="card flex h-[calc(100vh-190px)] min-h-[480px] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {!turns.length && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50"><Sparkles className="text-brand-600" /></div>
            <h2 className="text-lg font-semibold">Namaste {name}, ask me anything about your business</h2>
            <p className="mt-1 text-sm text-muted">I read live data from your CRM, calls, pipeline and invoices — only what your role is allowed to see. I can also schedule follow-ups for you.</p>
            {!enabled && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">AI is not configured on this server. Set <code>ANTHROPIC_API_KEY</code> to enable the Copilot.</p>}
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => <button key={s} disabled={!enabled} onClick={() => ask(s)} className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-brand-500 hover:bg-brand-50/50 disabled:opacity-50">{s}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={t.role === "user" ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand-500 px-4 py-2.5 text-sm text-white" : "max-w-[90%] rounded-2xl rounded-bl-sm bg-gray-50 px-4 py-3"}>
              {t.role === "user" ? t.content : <Rich text={t.content} />}
            </div>
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-sm text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />Looking at your data…</div>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2 border-t border-line p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={!enabled} placeholder="e.g. Compare Delhi and Lucknow leads for the last 30 days" className="input flex-1" />
        <button disabled={!enabled || loading || !input.trim()} className="btn-primary" aria-label="Send"><Send size={15} /></button>
      </form>
    </div>
  );
}
