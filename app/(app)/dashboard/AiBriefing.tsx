"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";

export function AiBriefing() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/ai/briefing", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Failed");
      setText(j.text);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      {text ? <div className="whitespace-pre-wrap rounded-lg bg-brand-50/60 p-4 text-sm leading-relaxed">{text}</div> : (
        <button onClick={run} disabled={loading} className="btn-secondary"><Sparkles size={15} className="text-brand-600" />{loading ? "Analysing your business…" : "Generate AI morning briefing"}</button>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
