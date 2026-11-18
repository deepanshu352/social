import Link from "next/link";
import { Clock, GitBranch, Zap, Sparkles } from "lucide-react";
import { guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Empty, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { TRIGGERS, type Step } from "@/lib/workflows";
import { toggleWorkflow } from "./actions";
import { WfTabs } from "./Tabs";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Workflows" };

function summarize(steps: Step[]): { actions: number; waits: number; branches: number; ai: number } {
  return steps.reduce((a, s) => {
    if (s.type === "wait") a.waits++;
    else if (s.type === "condition") { a.branches++; const t = summarize(s.then), e = summarize(s.else); a.actions += t.actions + e.actions; a.waits += t.waits + e.waits; a.branches += t.branches + e.branches; a.ai += t.ai + e.ai; }
    else { a.actions++; if (s.action.startsWith("ai_")) a.ai++; }
    return a;
  }, { actions: 0, waits: 0, branches: 0, ai: 0 });
}

export default async function Workflows() {
  const ctx = await guard("workflow.manage", "workflows");
  const since = new Date(Date.now() - 7 * 86400_000);
  const [wfs, runs7, failed7, waiting, msgs7] = await Promise.all([
    ctx.db.workflow.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] }),
    ctx.db.workflowRun.count({ where: { startedAt: { gte: since } } }),
    ctx.db.workflowRun.count({ where: { startedAt: { gte: since }, status: "failed" } }),
    ctx.db.workflowRun.count({ where: { status: "waiting" } }),
    ctx.db.messageLog.count({ where: { createdAt: { gte: since }, workflowRunId: { not: null } } }),
  ]);
  return (
    <>
      <PageHeader title="Workflow automation" subtitle="WHEN something happens → IF conditions match → THEN act, WAIT, and branch with ELSE."
        actions={<><Link href="/workflows/recipes" className="btn-secondary">Browse recipes</Link><Link href="/workflows/new" className="btn-primary">+ New workflow</Link></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Active workflows" value={wfs.filter((w) => w.isActive).length} hint={`${wfs.length} total`} />
        <Stat label="Runs (7 days)" value={runs7} hint={failed7 ? `${failed7} failed` : "No failures"} tone={failed7 ? "bad" : "good"} href="/workflows/runs" />
        <Stat label="Waiting (scheduled)" value={waiting} hint="Runs paused on a WAIT step" href="/workflows/runs?status=waiting" />
        <Stat label="Automated messages (7d)" value={msgs7} href="/messages" />
      </div>
      <WfTabs active="list" />
      {wfs.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {wfs.map((w) => {
            const s = summarize(w.steps as Step[]);
            const t = TRIGGERS.find((x) => x.key === w.trigger);
            return (
              <Card key={w.id} className={w.isActive ? "" : "opacity-70"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                    <div className="mt-0.5 line-clamp-2 text-sm text-muted">{w.description}</div>
                  </div>
                  <form action={toggleWorkflow.bind(null, w.id)}><SubmitButton className={w.isActive ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>{w.isActive ? "Pause" : "Activate"}</SubmitButton></form>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge tone="violet"><Zap size={11} />{t?.label ?? w.trigger}</Badge>
                  <Badge tone="blue">{s.actions} action{s.actions === 1 ? "" : "s"}</Badge>
                  {s.waits > 0 && <Badge tone="amber"><Clock size={11} />{s.waits} wait</Badge>}
                  {s.branches > 0 && <Badge tone="cyan"><GitBranch size={11} />{s.branches} branch</Badge>}
                  {s.ai > 0 && <Badge tone="red"><Sparkles size={11} />AI</Badge>}
                  {!w.isActive && <Badge>Paused</Badge>}
                </div>
                <div className="mt-3 text-xs text-muted">{w.runCount} runs · {w.failCount} failed · last run {w.lastRunAt ? timeAgo(w.lastRunAt) : "never"}</div>
              </Card>
            );
          })}
        </div>
      ) : <Card><Empty title="No workflows yet" action={<Link href="/workflows/recipes" className="btn-primary">Start from a recipe</Link>}>Recipes give you proven automations in one click.</Empty></Card>}
    </>
  );
}
