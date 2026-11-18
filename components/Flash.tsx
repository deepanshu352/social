"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, X } from "lucide-react";

/** Shows action errors passed back as ?_err=… (see lib/action.ts) and cleans the URL. */
export function Flash() {
  const sp = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const e = sp.get("_err");
    if (!e) return;
    setMsg(e);
    const url = new URL(window.location.href);
    url.searchParams.delete("_err");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, [sp]);
  if (!msg) return null;
  return (
    <div role="alert" data-testid="flash" className="fixed right-4 top-4 z-[60] flex max-w-md items-start gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm shadow-lg">
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <span className="flex-1">{msg}</span>
      <button onClick={() => setMsg(null)} aria-label="Dismiss" className="text-gray-400 hover:text-ink"><X size={16} /></button>
    </div>
  );
}
