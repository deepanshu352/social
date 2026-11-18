import { revalidatePath } from "next/cache";
import { authorize, guard, has } from "@/lib/auth";
import { Card, PageHeader, Stat, Badge, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { move } from "@/lib/inventory";
import { audit } from "@/lib/audit";
import { inr, inrCompact, toNum } from "@/lib/money";
import { fmtDate, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Inventory" };

async function adjust(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("inventory.manage", { mod: "inventory" });
  const qty = Math.trunc(Number(fd.get("qty")));
  if (!qty) throw new Error("Enter a non-zero quantity (use minus for stock out)");
  const reason = str(fd.get("reason"));
  if (!reason) throw new Error("A reason is required for stock adjustments");
  const p = await ctx.db.product.findFirstOrThrow({ where: { id: str(fd.get("productId")) } });
  if (p.stock + qty < 0) throw new Error(`Only ${p.stock} in stock`);
  const m = await move(ctx.tenant.id, p.id, qty, str(fd.get("type")) === "return" ? "return" : "adjust", { note: reason, by: ctx.membership.id, refType: "Manual" });
  await audit(ctx, "stock.adjust", "Product", p.id, { stock: p.stock }, { stock: m?.balance, qty, reason });
  revalidatePath("/inventory");
});
}

export default async function Inventory({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const ctx = await guard("inventory.view", "inventory");
  const { product } = await searchParams;
  const [products, moves] = await Promise.all([
    ctx.db.product.findMany({ where: { type: "goods" }, orderBy: { name: "asc" } }),
    ctx.db.stockMovement.findMany({ where: product ? { productId: product } : {}, include: { product: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const value = products.reduce((a, p) => a + p.stock * toNum(p.price), 0);
  const low = products.filter((p) => p.minStock > 0 && p.stock <= p.minStock);
  const sold30 = await ctx.db.stockMovement.groupBy({ by: ["productId"], where: { type: "sale", createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { qty: true } });
  const velocity = (id: string) => Math.abs(sold30.find((s) => s.productId === id)?._sum.qty ?? 0) / 30;
  return (
    <>
      <PageHeader title="Inventory" subtitle="Every stock change is an immutable ledger entry. Invoices deduct stock automatically when issued." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Stock value (at selling price)" value={inrCompact(value)} /><Stat label="Products" value={products.length} />
        <Stat label="Low stock" value={low.length} tone={low.length ? "warn" : "good"} /><Stat label="Movements (shown)" value={moves.length} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Stock levels" pad={false}>
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Product</th><th className="text-right">In stock</th><th className="text-right">Min</th><th className="text-right">Sold/day (30d)</th><th>Days of cover</th><th className="text-right">Value</th></tr></thead>
            <tbody>{products.map((p) => {
              const v = velocity(p.id), cover = v ? Math.floor(p.stock / v) : null;
              return (
                <tr key={p.id}>
                  <td><a href={`/inventory?product=${p.id}`} className="font-medium hover:underline">{p.name}</a><div className="text-xs text-muted">{p.sku}</div></td>
                  <td className="text-right tabular-nums">{p.stock} {p.unit}</td><td className="text-right tabular-nums text-muted">{p.minStock}</td>
                  <td className="text-right tabular-nums">{v ? v.toFixed(1) : "—"}</td>
                  <td>{p.minStock > 0 && p.stock <= p.minStock ? <Badge tone="red">Reorder now</Badge> : cover != null && cover < 14 ? <Badge tone="amber">{cover} days</Badge> : cover != null ? `${cover} days` : "—"}</td>
                  <td className="text-right tabular-nums">{inr(p.stock * toNum(p.price), false)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
        {has(ctx, "inventory.manage") && (
          <Card title="Adjust stock" className="h-fit">
            <form action={adjust} className="space-y-3">
              <Field label="Product"><select name="productId" defaultValue={product} className="input">{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock})</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Quantity (+/−)"><input name="qty" type="number" required className="input" placeholder="-5 or 20" /></Field>
                <Field label="Type"><select name="type" className="input"><option value="adjust">Adjustment</option><option value="return">Customer return</option></select></Field></div>
              <Field label="Reason *"><input name="reason" required className="input" placeholder="Damaged in transit / stock count" /></Field>
              <SubmitButton>Post adjustment</SubmitButton>
              <p className="text-xs text-muted">Purchases add stock when a PO is received (Purchases).</p>
            </form>
          </Card>
        )}
      </div>
      <Card title={`Stock ledger${product ? ` — ${products.find((p) => p.id === product)?.name}` : ""}`} pad={false} className="mt-6">
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th>Reference</th></tr></thead>
          <tbody>{moves.map((m) => <tr key={m.id}><td className="text-xs">{fmtDate(m.createdAt, true)}</td><td>{m.product.name}</td><td><Badge tone={m.qty > 0 ? "green" : "red"}>{m.type}</Badge></td><td className={`text-right tabular-nums ${m.qty > 0 ? "text-green-700" : "text-red-700"}`}>{m.qty > 0 ? "+" : ""}{m.qty}</td><td className="text-right tabular-nums">{m.balance}</td><td className="text-xs text-muted">{m.refType} {m.note}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}
