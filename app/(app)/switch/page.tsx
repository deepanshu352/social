import { requireCtx } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { switchTenant } from "@/app/actions";

export default async function Switch() {
  const ctx = await requireCtx();
  const ms = await prisma.membership.findMany({ where: { userId: ctx.user.id, status: "active" }, include: { tenant: true, role: true } });
  return (
    <>
      <PageHeader title="Switch company" />
      <div className="grid max-w-2xl gap-3">{ms.map((m) => (
        <Card key={m.id}><form action={switchTenant} className="flex items-center justify-between"><input type="hidden" name="tenantId" value={m.tenantId} />
          <div><div className="font-medium">{m.tenant.name}</div><div className="text-xs text-muted">{m.role.name}</div></div>
          {m.tenantId === ctx.tenant.id ? <span className="text-xs text-muted">Current</span> : <SubmitButton className="btn-secondary">Open</SubmitButton>}
        </form></Card>
      ))}</div>
    </>
  );
}
