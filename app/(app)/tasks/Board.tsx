"use client";
import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { moveTask } from "./actions";

type T = { id: string; number: number; title: string; status: string; priority: string; assignee: string | null; due: string | null; project: string | null; overdue: boolean; source: string };
const COLS = [["todo", "To do"], ["in_progress", "In progress"], ["review", "Review"], ["done", "Done"]] as const;
const PR: Record<string, string> = { urgent: "bg-red-50 text-red-700", high: "bg-amber-50 text-amber-800", medium: "bg-blue-50 text-blue-700", low: "bg-gray-100 text-gray-600" };

export function TaskBoard({ tasks, qs }: { tasks: T[]; qs: string }) {
  const [, start] = useTransition();
  const [items, set] = useOptimistic(tasks, (s: T[], m: { id: string; status: string }) => s.map((t) => (t.id === m.id ? { ...t, status: m.status } : t)));
  const drop = (id: string, status: string) => start(async () => { set({ id, status }); await moveTask(id, status); });
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLS.map(([key, label]) => {
        const col = items.filter((t) => t.status === key);
        return (
          <div key={key} className="flex min-h-40 flex-col rounded-xl bg-gray-100/70" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e.dataTransfer.getData("text/plain"), key)}>
            <div className="flex items-center justify-between px-3 pb-2 pt-3 text-sm font-semibold">{label}<span className="rounded-full bg-white px-2 text-xs text-muted">{col.length}</span></div>
            <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {col.map((t) => (
                <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)} className="cursor-grab rounded-lg border border-line bg-white p-3 shadow-sm">
                  <Link href={`/tasks?${qs}&id=${t.id}`} className="text-sm font-medium leading-snug hover:underline">{t.title}</Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full px-1.5 py-0.5 ${PR[t.priority]}`}>{t.priority}</span>
                    {t.project && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-violet-700">{t.project}</span>}
                    {t.source !== "manual" && <span className="rounded-full bg-fuchsia-50 px-1.5 py-0.5 text-fuchsia-700">{t.source}</span>}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-muted"><span>T-{t.number} · {t.assignee?.split(" ")[0] ?? "Unassigned"}</span>{t.due && <span className={t.overdue ? "font-medium text-red-700" : ""}>{t.due}</span>}</div>
                  <select aria-label="Move" value={t.status} onChange={(e) => drop(t.id, e.target.value)} className="mt-2 w-full rounded border border-line bg-gray-50 px-1.5 py-1 text-xs">{COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
