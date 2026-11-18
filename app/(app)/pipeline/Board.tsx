"use client";
import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { moveDeal } from "./actions";

type Deal = { id: string; number: number; title: string; amount: number; stageId: string; contact: string | null; contactId: string | null; owner: string | null; expectedClose: string | null };
type Stage = { id: string; name: string; type: string; probability: number };

const fmt = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export function Board({ stages, deals, highlight, canEdit }: { stages: Stage[]; deals: Deal[]; highlight?: string; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [items, setItems] = useOptimistic(deals, (state: Deal[], m: { id: string; stageId: string }) => state.map((d) => (d.id === m.id ? { ...d, stageId: m.stageId } : d)));

  function drop(dealId: string, stage: Stage) {
    const d = items.find((x) => x.id === dealId);
    if (!d || d.stageId === stage.id) return;
    let reason: string | undefined;
    if (stage.type === "lost") { reason = window.prompt("Why was this deal lost?") ?? undefined; if (!reason) return; }
    start(async () => {
      setItems({ id: dealId, stageId: stage.id });
      try { await moveDeal(dealId, stage.id, reason); } catch (e) { alert((e as Error).message); }
    });
  }

  return (
    <div className={`flex gap-3 overflow-x-auto pb-4 ${pending ? "opacity-80" : ""}`}>
      {stages.map((s) => {
        const col = items.filter((d) => d.stageId === s.id);
        const total = col.reduce((a, d) => a + d.amount, 0);
        return (
          <div key={s.id} className="flex w-64 shrink-0 flex-col rounded-xl bg-gray-100/70"
            onDragOver={(e) => canEdit && e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData("text/plain"), s); }}>
            <div className="px-3 pb-2 pt-3">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className={s.type === "won" ? "text-green-700" : s.type === "lost" ? "text-gray-500" : ""}>{s.name}</span>
                <span className="rounded-full bg-white px-2 text-xs text-muted">{col.length}</span>
              </div>
              <div className="text-xs tabular-nums text-muted">{fmt(total)} · {s.probability}%</div>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {col.map((d) => (
                <div key={d.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("text/plain", d.id)}
                  className={`cursor-grab rounded-lg border bg-white p-3 shadow-sm active:cursor-grabbing ${highlight === d.id ? "border-brand-500 ring-2 ring-brand-100" : "border-line"}`}>
                  <div className="text-sm font-medium leading-snug">{d.title}</div>
                  <div className="mt-1 text-xs text-muted">D-{d.number}{d.contact && <> · {d.contactId ? <Link className="hover:underline" href={`/contacts/${d.contactId}`}>{d.contact}</Link> : d.contact}</>}</div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold tabular-nums">{fmt(d.amount)}</span>
                    <span className="text-muted">{d.owner?.split(" ")[0]}</span>
                  </div>
                  {canEdit && (
                    <select aria-label="Move to stage" value={d.stageId} onChange={(e) => drop(d.id, stages.find((x) => x.id === e.target.value)!)} className="mt-2 w-full rounded border border-line bg-gray-50 px-1.5 py-1 text-xs">
                      {stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
