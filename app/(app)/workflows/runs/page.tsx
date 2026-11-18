import Link from "next/link";
import { guard } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty } from "@/components/ui";
import { WfTabs } from "../Tabs";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Workflow runs" };

export default async function Runs({ searchParams }: { searchParams: Promise<{ status?: string; wf?: string }> }) {
  const ctx = await guard("workflow.manage", "workflows");
  const sp = await searchParams;
  const [runs, wfs] = await Promise.all([
    ctx.db.workflowRun.findMany({ where: { ...(sp.status ? { status: sp.status } : {}), ...(sp.wf ? { workflowId: sp.wf } : {}) }, include: { workflow: { select: { name: true } } }, orderBy: { startedAt: "desc" }, take: 200 }),
    ctx.db.workflow.findMany({ select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Run history" subtitle="Every execution with a step-by-step log." />
      <WfTabs active="runs" />
      <form className="mb-4 flex gap-2" action="/workflows/runs">
        <select name="wf" defaultValue={sp.wf ?? ""} className="input w-64"><option value="">All workflows</option>{wfs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">Any status</option>{["completed", "waiting", "running", "failed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card pad={false}>
        {runs.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Steps logged</th><th>Next step at</th><th>Last log entry</th></tr></thead>
          <tbody>{runs.map((r) => {
            const log = (r.log as { text: string }[]) ?? [];
            return (
              <tr key={r.id}>
                <td><Link href={`/workflows/runs/${r.id}`} className="font-medium hover:underline">{r.workflow.name}</Link></td>
                <td><StatusBadge status={r.status} /></td><td className="text-xs">{fmtDate(r.startedAt, true)}</td>
                <td>{log.length}</td><td className="text-xs">{r.status === "waiting" ? fmtDate(r.nextRunAt, true) : "—"}</td>
                <td className="max-w-sm truncate text-xs text-muted">{r.error ?? log.at(-1)?.text}</td>
              </tr>
            );
          })}</tbody>
        </table></div> : <Empty title="No runs yet" />}
      </Card>
    </>
  );
}
