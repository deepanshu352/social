"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export function LeadInsight({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {text && <div className="mb-3 whitespace-pre-wrap rounded-lg bg-brand-50/60 p-3 text-sm leading-relaxed">{text}</div>}
      <button className="btn-secondary w-full" disabled={loading} onClick={async () => {
        setLoading(true); setError(null);
        try {
          const r = await fetch(`/api/ai/leads/${leadId}`, { method: "POST" });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error?.message ?? "Failed");
          setText(j.text); router.refresh();
        } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
      }}><Sparkles size={15} className="text-brand-600" />{loading ? "Analysing lead…" : text ? "Refresh AI insight" : "AI insight & next best action"}</button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
