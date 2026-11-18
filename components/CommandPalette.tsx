"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type Cmd = { label: string; href?: string; event?: string; group: string; keywords?: string };

/** Ctrl/⌘ + K command palette: jump anywhere, run quick actions, or search records. */
export function CommandPalette({ commands }: { commands: Cmd[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setI(0); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 10); }, [open]);

  const list = useMemo(() => {
    const t = q.toLowerCase().trim();
    const hits = t ? commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(t)) : commands;
    return t ? [...hits.slice(0, 12), { label: `Search records for “${q}”`, href: `/search?q=${encodeURIComponent(q)}`, group: "Search" }] : hits.slice(0, 14);
  }, [q, commands]);

  function run(c: Cmd) {
    setOpen(false);
    if (c.event) window.dispatchEvent(new Event(c.event));
    else if (c.href) router.push(c.href);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-gray-50 md:flex" title="Command palette">
        <span className="kbd">Ctrl</span><span className="kbd">K</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
            <div className="flex items-center gap-2 border-b border-line px-4"><Search size={16} className="text-gray-400" />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Go to… or type to search"
                onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, list.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); } if (e.key === "Enter" && list[i]) run(list[i]); }}
                className="w-full py-3.5 text-sm outline-none" />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {list.map((c, k) => (
                <li key={c.label + k}><button onMouseEnter={() => setI(k)} onClick={() => run(c)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${k === i ? "bg-brand-50 text-brand-700" : ""}`}><span>{c.label}</span><span className="text-xs text-muted">{c.group}</span></button></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
