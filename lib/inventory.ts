import { prisma } from "./prisma";
import { emit } from "./events";

/**
 * Stock ledger (BRD §26). Every change to Product.stock goes through move(), which writes an
 * immutable StockMovement with the running balance and fires stock.low when crossing the minimum.
 */
export async function move(tenantId: string, productId: string, qty: number, type: "purchase" | "sale" | "adjust" | "return" | "cancel", ref: { refType?: string; refId?: string; note?: string; by?: string | null } = {}) {
  if (!qty) return null;
  const [{ stock }] = await prisma.$queryRaw<{ stock: number }[]>`
    UPDATE "Product" SET "stock" = "stock" + ${qty} WHERE "id" = ${productId} AND "tenantId" = ${tenantId} RETURNING "stock"`;
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const m = await prisma.stockMovement.create({ data: { tenantId, productId, qty, balance: Number(stock), type, refType: ref.refType, refId: ref.refId, note: ref.note, createdById: ref.by ?? null } });
  if (p.minStock > 0 && Number(stock) <= p.minStock && Number(stock) - qty > p.minStock) {
    await emit(tenantId, "stock.low", { productId, name: p.name, sku: p.sku, stock: Number(stock), minStock: p.minStock });
  }
  return m;
}

/** Deduct stock for goods lines of an issued invoice; reverse on cancellation. */
export async function invoiceStock(tenantId: string, invoiceId: string, direction: "out" | "back", by?: string | null) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { items: true } });
  if (!inv) return;
  for (const it of inv.items) {
    if (!it.productId) continue;
    const p = await prisma.product.findFirst({ where: { id: it.productId, tenantId, type: "goods" } });
    if (!p) continue;
    const q = Math.round(it.qty);
    await move(tenantId, p.id, direction === "out" ? -q : q, direction === "out" ? "sale" : "cancel", { refType: "Invoice", refId: inv.id, note: inv.number ?? undefined, by });
  }
}
