import { revalidatePath } from "next/cache";
import { authorize, guard, has } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Field, Empty, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { nextNumber } from "@/lib/db";
import { requestApproval } from "@/lib/approvals";
import { move } from "@/lib/inventory";
import { audit } from "@/lib/audit";
import { inr, inrCompact, rupeesToPaise } from "@/lib/money";
import { STATES } from "@/lib/india";
import { fiscalYear, fmtDate, optStr, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Purchases" };
type Item = { productId: string; name: string; qty: number; rate: number };

async function addVendor(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("purchase.manage", { mod: "inventory" });
  await ctx.db.vendor.create({ data: { tenantId: ctx.tenant.id, name: str(fd.get("name")), gstin: optStr(fd.get("gstin"))?.toUpperCase(), phone: optStr(fd.get("phone")), email: optStr(fd.get("email")), stateCode: optStr(fd.get("stateCode")), paymentTerms: Number(fd.get("paymentTerms") || 30) } });
  revalidatePath("/purchases");
});
}

async function createPO(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("purchase.manage", { mod: "inventory" });
  const products = await ctx.db.product.findMany({ where: { type: "goods" } });
  const items: Item[] = [0, 1, 2, 3, 4].map((i) => {
    const p = products.find((x) => x.id === str(fd.get(`p${i}`)));
    const qty = Math.trunc(Number(fd.get(`q${i}`) || 0));
    return p && qty > 0 ? { productId: p.id, name: p.name, qty, rate: Number(rupeesToPaise(str(fd.get(`r${i}`)))) } : null;
  }).filter(Boolean) as Item[];
  if (!items.length) throw new Error("Add at least one product line");
  const total = BigInt(items.reduce((a, i) => a + i.qty * i.rate, 0));
  const vendor = await ctx.db.vendor.findFirstOrThrow({ where: { id: str(fd.get("vendorId")) } });
  const n = await nextNumber(ctx.tenant.id, `PO/${fiscalYear()}`);
  const po = await ctx.db.purchaseOrder.create({ data: { tenantId: ctx.tenant.id, number: `PO/${fiscalYear()}/${String(n).padStart(4, "0")}`, vendorId: vendor.id, items, total, status: "pending_approval", expectedDate: optStr(fd.get("expectedDate")) ? new Date(str(fd.get("expectedDate"))) : null, notes: optStr(fd.get("notes")), createdById: ctx.membership.id } });
  const req = await requestApproval(ctx, "purchase_order", po.id, `${po.number} · ${vendor.name} · ₹${(Number(total) / 100).toLocaleString("en-IN")}`, total);
  if (!req) await ctx.db.purchaseOrder.update({ where: { id: po.id }, data: { status: "approved" } });
  await audit(ctx, "po.create", "PurchaseOrder", po.id, null, { total, vendor: vendor.name });
  revalidatePath("/purchases");
});
}

async function receivePO(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("purchase.manage");
  const po = await ctx.db.purchaseOrder.findFirst({ where: { id, status: "approved" } });
  if (!po) throw new Error("Only approved POs can be received");
  for (const it of po.items as Item[]) await move(ctx.tenant.id, it.productId, it.qty, "purchase", { refType: "PurchaseOrder", refId: po.id, note: po.number, by: ctx.membership.id });
  await ctx.db.purchaseOrder.update({ where: { id }, data: { status: "received", receivedAt: new Date() } });
  await audit(ctx, "po.receive", "PurchaseOrder", id);
  revalidatePath("/purchases");
});
}

export default async function Purchases() {
  const ctx = await guard("purchase.manage", "inventory");
  const [vendors, pos, products] = await Promise.all([
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, include: { orders: { select: { total: true, status: true, receivedAt: true, expectedDate: true } } } }),
    ctx.db.purchaseOrder.findMany({ include: { vendor: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.product.findMany({ where: { type: "goods", isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const open = pos.filter((p) => ["pending_approval", "approved"].includes(p.status));
  return (
    <>
      <PageHeader title="Purchases" subtitle="Vendor → PO → approval → goods received (stock in)." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open POs" value={open.length} hint={inrCompact(open.reduce((a, p) => a + Number(p.total), 0))} />
        <Stat label="Awaiting approval" value={pos.filter((p) => p.status === "pending_approval").length} href="/approvals" />
        <Stat label="Vendors" value={vendors.length} />
        <Stat label="Received (shown)" value={pos.filter((p) => p.status === "received").length} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Purchase orders" pad={false}>
            {pos.length ? <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>PO</th><th>Vendor</th><th>Items</th><th>Expected</th><th>Status</th><th className="text-right">Total</th><th></th></tr></thead>
              <tbody>{pos.map((p) => <tr key={p.id}><td className="font-medium">{p.number}</td><td>{p.vendor.name}</td><td className="max-w-56 text-xs text-muted">{(p.items as Item[]).map((i) => `${i.name} × ${i.qty}`).join(", ")}</td><td className="text-xs">{fmtDate(p.expectedDate)}</td>
                <td><StatusBadge status={p.status === "received" ? "completed" : p.status} /></td><td className="text-right tabular-nums">{inr(p.total)}</td>
                <td>{p.status === "approved" && <form action={receivePO.bind(null, p.id)}><SubmitButton className="btn-secondary btn-sm" confirm="Mark goods received? Stock will be added.">Receive</SubmitButton></form>}</td></tr>)}</tbody>
            </table></div> : <Empty title="No purchase orders yet" />}
          </Card>
          <Card title="Vendors" pad={false}>
            <table className="table"><thead><tr><th>Vendor</th><th>GSTIN</th><th>Terms</th><th className="text-right">Purchased</th><th>On-time delivery</th></tr></thead>
              <tbody>{vendors.map((v) => {
                const rec = v.orders.filter((o) => o.receivedAt), onTime = rec.filter((o) => !o.expectedDate || o.receivedAt! <= new Date(o.expectedDate.getTime() + 86400_000)).length;
                return <tr key={v.id}><td className="font-medium">{v.name}<div className="text-xs text-muted">{v.phone}</div></td><td className="text-xs">{v.gstin ?? "—"}</td><td>{v.paymentTerms} days</td><td className="text-right tabular-nums">{inr(v.orders.filter((o) => o.status === "received").reduce((a, o) => a + Number(o.total), 0), false)}</td><td>{rec.length ? `${Math.round((onTime / rec.length) * 100)}% (${rec.length})` : "—"}</td></tr>;
              })}</tbody></table>
            <form action={addVendor} className="grid gap-2 border-t border-line p-4 md:grid-cols-3">
              <input name="name" required placeholder="Vendor name" className="input" /><input name="gstin" placeholder="GSTIN" className="input" /><input name="phone" placeholder="Phone" className="input" />
              <input name="email" placeholder="Email" className="input" /><select name="stateCode" className="input"><option value="">State</option>{Object.entries(STATES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              <div className="flex gap-2"><input name="paymentTerms" type="number" defaultValue={30} className="input w-20" /><SubmitButton>Add vendor</SubmitButton></div>
            </form>
          </Card>
        </div>
        {has(ctx, "purchase.manage") && vendors.length > 0 && (
          <Card title="New purchase order" className="h-fit">
            <form action={createPO} className="space-y-3">
              <Field label="Vendor"><select name="vendorId" className="input">{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_64px_84px] gap-1.5">
                  <select name={`p${i}`} className="input py-1.5 text-xs"><option value="">{i ? "(optional line)" : "Product…"}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} in stock</option>)}</select>
                  <input name={`q${i}`} type="number" min={0} placeholder="Qty" className="input py-1.5 text-xs" /><input name={`r${i}`} inputMode="decimal" placeholder="Rate ₹" className="input py-1.5 text-xs" />
                </div>
              ))}
              <Field label="Expected delivery"><input name="expectedDate" type="date" className="input" /></Field>
              <Field label="Notes"><input name="notes" className="input" /></Field>
              <SubmitButton>Create & send for approval</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
