import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { matches, type Condition } from "@/lib/assignment";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Lead assignment" };
const FIELDS = ["source", "city", "state", "language", "product", "campaign", "priority", "budget"];

async function saveRule(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("automation.manage");
  const conditions: Condition[] = [0, 1, 2].map((i) => ({ field: str(fd.get(`f${i}`)), op: str(fd.get(`o${i}`)) as Condition["op"], value: str(fd.get(`v${i}`)) })).filter((c) => c.field && c.value);
  const memberIds = fd.getAll("memberIds").map(String);
  if (!memberIds.length) throw new Error("Pick at least one team member");
  const r = await ctx.db.assignmentRule.create({ data: { tenantId: ctx.tenant.id, name: str(fd.get("name")), priority: Number(fd.get("priority")) || 100, strategy: str(fd.get("strategy")), conditions, memberIds } });
  await audit(ctx, "assignment_rule.create", "AssignmentRule", r.id, null, { conditions, memberIds });
  revalidatePath("/settings/assignment");
});
}
async function ruleOp(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("automation.manage");
  if (str(fd.get("op")) === "delete") await ctx.db.assignmentRule.delete({ where: { id } });
  else { const r = await ctx.db.assignmentRule.findFirstOrThrow({ where: { id } }); await ctx.db.assignmentRule.update({ where: { id }, data: { isActive: !r.isActive } }); }
  revalidatePath("/settings/assignment");
});
}

export default async function Assignment({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await guard("automation.manage");
  const sp = await searchParams;
  const [rules, members] = await Promise.all([ctx.db.assignmentRule.findMany({ orderBy: { priority: "asc" } }), ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true, role: true } })]);
  const name = (id: string) => members.find((m) => m.id === id)?.user.name ?? "(removed)";
  const sample = sp.test ? { source: sp.source, city: sp.city, language: sp.language, product: sp.product, budget: sp.budget } : null;
  const hit = sample ? rules.find((r) => r.isActive && matches(r.conditions as Condition[], sample)) : null;
  return (
    <>
      <PageHeader title="Lead assignment rules" subtitle="Evaluated top to bottom by priority. First matching rule assigns the lead. No match → creator keeps it." />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-3">
          {rules.length ? rules.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="flex items-center gap-2 font-medium">#{r.priority} · {r.name} {r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Paused</Badge>} <Badge tone="blue">{r.strategy.replace("_", " ")}</Badge></div>
                  <div className="mt-2">{(r.conditions as Condition[]).length ? (r.conditions as Condition[]).map((c, i) => <span key={i} className="mr-2"><span className="kbd">IF</span> {c.field} {c.op} <b>{c.value}</b></span>) : <span className="text-muted">Matches every lead</span>}</div>
                  <div className="mt-1 text-muted">→ {r.memberIds.map(name).join(", ")}</div>
                </div>
                <form action={ruleOp.bind(null, r.id)} className="flex gap-2">
                  <SubmitButton name="op" value="toggle" className="btn-secondary btn-sm">{r.isActive ? "Pause" : "Activate"}</SubmitButton>
                  <SubmitButton name="op" value="delete" className="btn-ghost btn-sm text-red-700" confirm="Delete rule?">Delete</SubmitButton>
                </form>
              </div>
            </Card>
          )) : <Card><Empty title="No rules yet">Leads stay with whoever created them until you add a rule.</Empty></Card>}

          <Card title="Test rules">
            <form className="flex flex-wrap gap-2" action="/settings/assignment">
              <input type="hidden" name="test" value="1" />
              <input name="source" defaultValue={sp.source} placeholder="source (facebook)" className="input w-36" />
              <input name="city" defaultValue={sp.city} placeholder="city" className="input w-28" />
              <input name="language" defaultValue={sp.language} placeholder="language (hi)" className="input w-28" />
              <input name="product" defaultValue={sp.product} placeholder="product" className="input w-28" />
              <input name="budget" defaultValue={sp.budget} placeholder="budget ₹" className="input w-28" />
              <button className="btn-secondary">Test</button>
            </form>
            {sample && <p className="mt-3 text-sm">{hit ? <>Matches <b>{hit.name}</b> → one of {hit.memberIds.map(name).join(", ")} ({hit.strategy.replace("_", " ")}).</> : "No rule matches — the creator keeps the lead."}</p>}
          </Card>
        </div>
        <Card title="New rule">
          <form action={saveRule} className="space-y-3 text-sm">
            <input name="name" required placeholder="e.g. Delhi Hindi leads → Delhi team" className="input" />
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Priority (lower first)</span><input name="priority" type="number" defaultValue={100} className="input" /></label>
              <label><span className="label">Strategy</span><select name="strategy" className="input"><option value="round_robin">Round robin</option><option value="least_workload">Least workload</option></select></label>
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_1fr] gap-2">
                <select name={`f${i}`} className="input"><option value="">field…</option>{FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
                <select name={`o${i}`} className="input"><option value="eq">=</option><option value="in">in</option><option value="contains">contains</option><option value="gte">≥</option><option value="lte">≤</option></select>
                <input name={`v${i}`} placeholder="Delhi" className="input" />
              </div>
            ))}
            <div><span className="label">Assign among (only available members are picked)</span>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {members.map((m) => <label key={m.id} className="flex items-center gap-2"><input type="checkbox" name="memberIds" value={m.id} /> {m.user.name} <span className="text-xs text-muted">{m.role.name}{m.isAvailable ? "" : " · unavailable"}</span></label>)}
              </div>
            </div>
            <SubmitButton>Add rule</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
