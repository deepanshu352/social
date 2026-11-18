import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { Card, PageHeader, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { markAllRead } from "@/app/actions";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const ctx = await requireCtx();
  const items = await ctx.db.notification.findMany({ where: { membershipId: ctx.membership.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Notifications" actions={<form action={markAllRead}><SubmitButton className="btn-secondary">Mark all read</SubmitButton></form>} />
      <Card pad={false}>
        {items.length ? <ul className="divide-y divide-line">{items.map((n) => (
          <li key={n.id} className={`flex items-start gap-3 px-5 py-3 ${n.readAt ? "" : "bg-brand-50/40"}`}>
            {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="unread" />}
            <div className="min-w-0 flex-1">
              {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
              {n.body && <div className="text-sm text-muted">{n.body}</div>}
            </div>
            <span className="shrink-0 text-xs text-muted">{timeAgo(n.createdAt)}</span>
          </li>
        ))}</ul> : <Empty title="No notifications" />}
      </Card>
    </>
  );
}
