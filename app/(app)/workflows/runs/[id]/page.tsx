import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, GitBranch, XCircle, Zap } from "lucide-react";
import { guard } from "@/lib/auth";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { cancelRun } from "../../actions";
import { fmtDate } from "@/lib/utils";

const ICON = { action: Zap, wait: Clock, condition: GitBranch, error: XCircle } as const;

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("workflow.manage", "workflows");
  const run = await ctx.db.workflowRun.findFirst({ where: { id }, include: { workflow: true } });
  if (!run) notFound();
  const log = (run.log as { at: string; type: keyof typeof ICON; text: string; action?: string }[]) ?? [];
  const p = run.payload as Record<string, string>;
  const links = [p.leadId && ["Lead", `/leads/${p.leadId}`], p.invoiceId && ["Invoice", `/invoices/${p.invoiceId}`], p.contactId && ["Customer", `/contacts/${p.contactId}`], p.quotationId && ["Quotation", `/quotations/${p.quotationId}`], p.ticketId && ["Ticket", `/tickets?id=${p.ticketId}`]].filter(Boolean) as [string, string][];
  return (
    <>
      <PageHeader back={{ href: "/workflows/runs", label: "Run history" }} title={<span className="flex items-center gap-2">{run.workflow.name} <StatusBadge status={run.status} /></span>}
        subtitle={`Started ${fmtDate(run.startedAt, true)}${run.finishedAt ? ` · finished ${fmtDate(run.finishedAt, true)}` : ""}${run.status === "waiting" ? ` · resumes ${fmtDate(run.nextRunAt, true)}` : ""}`}
        actions={<>
          <Link href={`/workflows/${run.workflowId}`} className="btn-secondary">Open workflow</Link>
          {["waiting", "running"].includes(run.status) && <form action={cancelRun.bind(null, id)}><SubmitButton className="btn-ghost text-red-700" confirm="Cancel this run?">Cancel run</SubmitButton></form>}
        </>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Execution log">
          <ol className="relative space-y-4 border-l border-line pl-6">
            <li className="relative"><span className="absolute -left-[33px] grid h-5 w-5 place-items-center rounded-full bg-violet-600 text-white"><Zap size={11} /></span><div className="text-sm font-medium">Triggered by {run.workflow.trigger}</div><div className="text-xs text-muted">{fmtDate(run.startedAt, true)}</div></li>
            {log.map((l, i) => {
              const Icon = ICON[l.type] ?? CheckCircle2;
              return (
                <li key={i} className="relative">
                  <span className={`absolute -left-[33px] grid h-5 w-5 place-items-center rounded-full text-white ${l.type === "error" ? "bg-red-600" : l.type === "wait" ? "bg-amber-500" : l.type === "condition" ? "bg-sky-600" : "bg-brand-500"}`}><Icon size={11} /></span>
                  <div className="text-sm">{l.text}</div>
                  <div className="text-xs text-muted">{l.action ? `${l.action.replace(/_/g, " ")} · ` : ""}{fmtDate(l.at, true)}</div>
                </li>
              );
            })}
            {run.status === "completed" && <li className="relative"><span className="absolute -left-[33px] grid h-5 w-5 place-items-center rounded-full bg-green-600 text-white"><CheckCircle2 size={11} /></span><div className="text-sm font-medium">Completed</div></li>}
          </ol>
          {run.error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{run.error}</p>}
        </Card>
        <div className="space-y-4">
          <Card title="Records">{links.length ? <ul className="space-y-1 text-sm">{links.map(([l, h]) => <li key={h}><Link href={h} className="link">{l}</Link></li>)}</ul> : <p className="text-sm text-muted">No linked record.</p>}</Card>
          <Card title="Trigger payload"><pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 p-3 text-[11px]">{JSON.stringify(run.payload, null, 2)}</pre></Card>
        </div>
      </div>
    </>
  );
}
