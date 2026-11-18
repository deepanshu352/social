import { guard, has, scopeWhere } from "@/lib/auth";
import { PageHeader, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Board } from "./Board";
import { createDealAction } from "./actions";
import { inrCompact, toNum } from "@/lib/money";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ highlight?: string }> }) {
  const ctx = await guard("deal.view", "sales");
  const { highlight } = await searchParams;
  const [stages, deals, contacts] = await Promise.all([
    ctx.db.pipelineStage.findMany({ orderBy: { order: "asc" } }),
    ctx.db.deal.findMany({ where: { ...(await scopeWhere(ctx, "deal.view")), OR: [{ closedAt: null }, { closedAt: { gte: new Date(Date.now() - 90 * 86400_000) } }] }, include: { contact: true, owner: { include: { user: true } } }, orderBy: { amount: "desc" } }),
    has(ctx, "deal.edit") ? ctx.db.contact.findMany({ where: { deletedAt: null, ...(await scopeWhere(ctx, "contact.view")) }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : [],
  ]);
  const open = deals.filter((d) => stages.find((s) => s.id === d.stageId)?.type === "open");
  const weighted = open.reduce((a, d) => a + (toNum(d.amount) * (stages.find((s) => s.id === d.stageId)?.probability ?? 0)) / 100, 0);
  const won = deals.filter((d) => stages.find((s) => s.id === d.stageId)?.type === "won");
  const lost = deals.filter((d) => stages.find((s) => s.id === d.stageId)?.type === "lost");
  return (
    <>
      <PageHeader title="Sales pipeline" subtitle="Drag cards between stages. Won/lost deals from the last 90 days are shown." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open pipeline" value={inrCompact(open.reduce((a, d) => a + toNum(d.amount), 0))} hint={`${open.length} deals`} />
        <Stat label="Weighted forecast" value={inrCompact(weighted)} hint="Value × stage probability" />
        <Stat label="Won (90d)" value={inrCompact(won.reduce((a, d) => a + toNum(d.amount), 0))} hint={`${won.length} deals`} tone="good" />
        <Stat label="Win rate (90d)" value={won.length + lost.length ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%` : "—"} />
      </div>
      {has(ctx, "deal.edit") && (
        <form action={createDealAction} className="card mb-4 flex flex-wrap items-end gap-2 p-3">
          <input name="title" placeholder="Deal title" required className="input w-56" />
          <select name="contactId" className="input w-48"><option value="">Customer (optional)</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input name="amount" placeholder="Value ₹" className="input w-32" />
          <input name="expectedClose" type="date" className="input w-40" />
          <SubmitButton className="btn-primary">+ Add deal</SubmitButton>
        </form>
      )}
      <Board canEdit={has(ctx, "deal.edit")} highlight={highlight} stages={stages.map((s) => ({ id: s.id, name: s.name, type: s.type, probability: s.probability }))}
        deals={deals.map((d) => ({ id: d.id, number: d.number, title: d.title, amount: toNum(d.amount), stageId: d.stageId, contact: d.contact?.name ?? null, contactId: d.contactId, owner: d.owner?.user.name ?? null, expectedClose: d.expectedClose?.toISOString() ?? null }))} />
    </>
  );
}
