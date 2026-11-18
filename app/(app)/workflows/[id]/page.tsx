import Link from "next/link";
import { notFound } from "next/navigation";
import { guard } from "@/lib/auth";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Builder } from "../Builder";
import { builderOpts } from "../opts";
import { saveWorkflow, testRun, duplicateWorkflow, deleteWorkflow } from "../actions";
import type { Cond, Step } from "@/lib/workflows";
import { timeAgo } from "@/lib/utils";

export default async function EditWorkflow({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; installed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await guard("workflow.manage", "workflows");
  const wf = await ctx.db.workflow.findFirst({ where: { id } });
  if (!wf) notFound();
  const runs = await ctx.db.workflowRun.findMany({ where: { workflowId: id }, orderBy: { startedAt: "desc" }, take: 8 });
  return (
    <>
      <PageHeader title={wf.name} back={{ href: "/workflows", label: "Workflows" }} subtitle={`${wf.runCount} runs · ${wf.failCount} failed${wf.recipeKey ? " · from recipe" : ""}`}
        actions={<>
          <form action={testRun.bind(null, id)}><SubmitButton className="btn-secondary" pendingText="Running…">▶ Test run now</SubmitButton></form>
          <form action={duplicateWorkflow.bind(null, id)}><SubmitButton className="btn-ghost">Duplicate</SubmitButton></form>
          <form action={deleteWorkflow.bind(null, id)}><SubmitButton className="btn-ghost text-red-700" confirm="Delete this workflow and its run history?">Delete</SubmitButton></form>
        </>} />
      {(sp.saved || sp.installed) && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-900">{sp.installed ? "Recipe installed and active. Customise anything below." : "Workflow saved."}</div>}
      <div className="grid gap-6 2xl:grid-cols-[1fr_300px]">
        <Builder opts={await builderOpts(ctx)} action={saveWorkflow.bind(null, id)} submitLabel="Save workflow"
          initial={{ name: wf.name, description: wf.description ?? "", isActive: wf.isActive, trigger: wf.trigger, triggerConfig: (wf.triggerConfig ?? {}) as Record<string, unknown>, conditions: wf.conditions as Cond[], steps: wf.steps as Step[] }} />
        <Card title="Recent runs" pad={false} className="h-fit 2xl:sticky 2xl:top-20">
          {runs.length ? <ul className="divide-y divide-line">{runs.map((r) => (
            <li key={r.id}><Link href={`/workflows/runs/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-gray-50"><StatusBadge status={r.status} /><span className="text-xs text-muted">{timeAgo(r.startedAt)}</span></Link></li>
          ))}</ul> : <p className="p-4 text-sm text-muted">No runs yet. Use “Test run now” to try it on your latest record.</p>}
        </Card>
      </div>
    </>
  );
}
