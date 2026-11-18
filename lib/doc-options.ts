import type { Ctx } from "./auth";
import { scopeWhere } from "./auth";
import { STATES } from "./india";
import { toNum } from "./money";

/** Shared data for the quotation / invoice editor. */
export async function editorOptions(ctx: Ctx) {
  const [contacts, products] = await Promise.all([
    ctx.db.contact.findMany({ where: { deletedAt: null, ...(await scopeWhere(ctx, "contact.view")) }, select: { id: true, name: true, stateCode: true, companyName: true }, orderBy: { name: "asc" }, take: 1000 }),
    ctx.db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    contacts,
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: toNum(p.price), taxRate: p.taxRate, hsn: p.hsn, unit: p.unit })),
    states: Object.entries(STATES) as [string, string][],
  };
}

export const itemsToLines = (items: { productId: string | null; description: string; hsn: string | null; qty: number; unit: string; unitPrice: bigint; discountPct: number; taxRate: number }[]) =>
  items.map((i) => ({ productId: i.productId, description: i.description, hsn: i.hsn, qty: i.qty, unit: i.unit, unitPrice: toNum(i.unitPrice), discountPct: i.discountPct, taxRate: i.taxRate }));

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
