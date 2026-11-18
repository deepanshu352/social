import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { authorize, guard, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, Tabs, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { fmtDate, startOfDay, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Follow-ups" };

async function complete(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("followup.view");
  const f = await ctx.db.followUp.findFirst({ where: { id, ...(await scopeWhere(ctx, "followup.view", "assigneeId", null)) } });
  if (!f) throw new Error("Not found");
  const status = str(fd.get("status")) === "cancelled" ? "cancelled" : "done";
  await ctx.db.followUp.update({ where: { id }, data: { status, completedAt: new Date(), outcome: str(fd.get("outcome")) || null } });
  if (f.leadId) {
    const next = await ctx.db.followUp.findFirst({ where: { leadId: f.leadId, status: "pending" }, orderBy: { dueAt: "asc" } });
    await ctx.db.lead.update({ where: { id: f.leadId }, data: { nextFollowUpAt: next?.dueAt ?? null, lastActivityAt: new Date() } });
    await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, leadId: f.leadId, type: "system", body: `Follow-up ${status}${fd.get("outcome") ? `: ${fd.get("outcome")}` : ""}`, actorId: ctx.membership.id } });
  }
  revalidatePath("/followups");
});
}

export default async function FollowUps({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string }> }) {
  const ctx = await guard("followup.view", "crm");
  const { tab = "today", who } = await searchParams;
  const today = startOfDay(), tomorrow = new Date(today.getTime() + 86400_000);
  const base: Prisma.FollowUpWhereInput = who === "team" ? { ...(await scopeWhere(ctx, "followup.view", "assigneeId", null)) } : { assigneeId: ctx.membership.id };
  const ranges: Record<string, Prisma.FollowUpWhereInput> = {
    overdue: { status: "pending", dueAt: { lt: new Date() } },
    today: { status: "pending", dueAt: { gte: today, lt: tomorrow } },
    upcoming: { status: "pending", dueAt: { gte: tomorrow } },
    done: { status: { in: ["done", "cancelled"] }, completedAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
  };
  const [items, ...counts] = await Promise.all([
    ctx.db.followUp.findMany({ where: { ...base, ...ranges[tab] }, include: { lead: true, contact: true, assignee: { include: { user: true } } }, orderBy: { dueAt: tab === "done" ? "desc" : "asc" }, take: 200 }),
    ...["overdue", "today", "upcoming"].map((k) => ctx.db.followUp.count({ where: { ...base, ...ranges[k] } })),
  ]);
  const href = (t: string) => `/followups?tab=${t}${who ? `&who=${who}` : ""}`;
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Your day, in order. Overdue first." actions={ctx.perms["followup.view"] !== "own" && (
        <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
          <Link href={`/followups?tab=${tab}`} className={`rounded-md px-3 py-1 ${who !== "team" ? "bg-gray-100 font-medium" : ""}`}>Mine</Link>
          <Link href={`/followups?tab=${tab}&who=team`} className={`rounded-md px-3 py-1 ${who === "team" ? "bg-gray-100 font-medium" : ""}`}>Team</Link>
        </div>
      )} />
      <Tabs active={tab} items={[
        { key: "overdue", label: "Overdue", href: href("overdue"), count: counts[0] },
        { key: "today", label: "Today", href: href("today"), count: counts[1] },
        { key: "upcoming", label: "Upcoming", href: href("upcoming"), count: counts[2] },
        { key: "done", label: "Done (7d)", href: href("done") },
      ]} />
      <Card pad={false}>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={f.leadId ? `/leads/${f.leadId}` : `/contacts/${f.contactId}`} className="font-medium hover:underline">{f.lead?.name ?? f.contact?.name ?? "—"}</Link>
                  <span className="ml-2 text-xs uppercase text-muted">{f.type}</span>
                  <div className="text-sm text-muted">{f.note}{who === "team" && ` · ${f.assignee.user.name}`}</div>
                </div>
                <div className={`text-sm ${f.status === "pending" && f.dueAt < new Date() ? "font-medium text-red-700" : "text-muted"}`}>{fmtDate(f.dueAt, true)}</div>
                {f.status === "pending" ? (
                  <form action={complete.bind(null, f.id)} className="flex gap-2">
                    <input name="outcome" placeholder="Outcome" className="input w-40 py-1.5 text-xs" />
                    <SubmitButton name="status" value="done" className="btn-secondary btn-sm">Done</SubmitButton>
                    <SubmitButton name="status" value="cancelled" className="btn-ghost btn-sm">Cancel</SubmitButton>
                  </form>
                ) : <span className="text-xs text-muted">{f.status} {f.outcome && `· ${f.outcome}`}</span>}
              </li>
            ))}
          </ul>
        ) : <Empty title="Nothing here">No follow-ups in this view.</Empty>}
      </Card>
    </>
  );
}
