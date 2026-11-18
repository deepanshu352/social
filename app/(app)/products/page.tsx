import { revalidatePath } from "next/cache";
import { authorize, guard, has } from "@/lib/auth";
import { Card, PageHeader, Empty, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { inr, rupeesToPaise } from "@/lib/money";
import { audit } from "@/lib/audit";
import { optStr, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Products" };

async function saveProduct(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("product.manage");
  const id = optStr(fd.get("id"));
  const data = {
    sku: str(fd.get("sku")).toUpperCase(), name: str(fd.get("name")), type: str(fd.get("type")) || "goods", unit: str(fd.get("unit")) || "pcs",
    hsn: optStr(fd.get("hsn")), price: rupeesToPaise(str(fd.get("price"))), taxRate: Number(fd.get("taxRate") ?? 1800),
    stock: Number(fd.get("stock") || 0), minStock: Number(fd.get("minStock") || 0), description: optStr(fd.get("description")),
    isActive: fd.get("hasActive") ? fd.get("isActive") === "on" : true,
  };
  if (!data.sku || !data.name) throw new Error("SKU and name are required");
  if (id) await ctx.db.product.update({ where: { id }, data });
  else await ctx.db.product.create({ data: { ...data, tenantId: ctx.tenant.id } });
  await audit(ctx, id ? "product.update" : "product.create", "Product", id, null, data);
  revalidatePath("/products");
});
}

export default async function Products({ searchParams }: { searchParams: Promise<{ edit?: string; q?: string }> }) {
  const ctx = await guard("product.view", "sales");
  const { edit, q } = await searchParams;
  const products = await ctx.db.product.findMany({ where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}, orderBy: { name: "asc" } });
  const editing = products.find((p) => p.id === edit);
  const canManage = has(ctx, "product.manage");
  return (
    <>
      <PageHeader title="Products & services" subtitle={`${products.length} items`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card pad={false}>
          <form className="border-b border-line p-3" action="/products"><input name="q" defaultValue={q} placeholder="Search name or SKU" className="input max-w-xs" /></form>
          {products.length ? (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Product</th><th>HSN/SAC</th><th className="text-right">Price</th><th>GST</th><th className="text-right">Stock</th>{canManage && <th></th>}</tr></thead>
              <tbody>{products.map((p) => (
                <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                  <td><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.sku} · {p.type} · per {p.unit}</div></td>
                  <td>{p.hsn ?? "—"}</td>
                  <td className="text-right tabular-nums">{inr(p.price)}</td>
                  <td>{p.taxRate / 100}%</td>
                  <td className="text-right tabular-nums">{p.type === "service" ? "—" : <>{p.stock} {p.minStock > 0 && p.stock <= p.minStock && <Badge tone="amber">Low</Badge>}</>}</td>
                  {canManage && <td><a href={`/products?edit=${p.id}`} className="link text-xs">Edit</a></td>}
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No products yet">Add products to use them on quotations and invoices.</Empty>}
        </Card>
        {canManage && (
          <Card title={editing ? `Edit ${editing.sku}` : "Add product"}>
            <form action={saveProduct} key={editing?.id ?? "new"} className="space-y-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">SKU *</span><input name="sku" required defaultValue={editing?.sku} className="input" /></label>
                <label><span className="label">Type</span><select name="type" defaultValue={editing?.type ?? "goods"} className="input"><option value="goods">Goods</option><option value="service">Service</option></select></label>
              </div>
              <label className="block"><span className="label">Name *</span><input name="name" required defaultValue={editing?.name} className="input" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">Price (₹, excl. GST)</span><input name="price" required inputMode="decimal" defaultValue={editing ? Number(editing.price) / 100 : ""} className="input" /></label>
                <label><span className="label">GST rate</span><select name="taxRate" defaultValue={editing?.taxRate ?? 1800} className="input">{[0, 500, 1200, 1800, 2800].map((t) => <option key={t} value={t}>{t / 100}%</option>)}</select></label>
                <label><span className="label">HSN / SAC</span><input name="hsn" defaultValue={editing?.hsn ?? ""} className="input" /></label>
                <label><span className="label">Unit</span><input name="unit" defaultValue={editing?.unit ?? "pcs"} className="input" /></label>
                <label><span className="label">Stock</span><input name="stock" type="number" defaultValue={editing?.stock ?? 0} className="input" /></label>
                <label><span className="label">Min stock alert</span><input name="minStock" type="number" defaultValue={editing?.minStock ?? 0} className="input" /></label>
              </div>
              <label className="block"><span className="label">Description</span><textarea name="description" rows={2} defaultValue={editing?.description ?? ""} className="input" /></label>
              {editing && <label className="flex items-center gap-2 text-sm"><input type="hidden" name="hasActive" value="1" /><input type="checkbox" name="isActive" value="on" defaultChecked={editing.isActive} /> Active</label>}
              <div className="flex gap-2"><SubmitButton>{editing ? "Save" : "Add product"}</SubmitButton>{editing && <a href="/products" className="btn-ghost">Cancel</a>}</div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
