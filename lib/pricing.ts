/**
 * Shared GST pricing engine — used by the quotation/invoice editor (client preview)
 * and by the server (authoritative totals). All amounts are integer paise.
 *
 * Intra-state supply  (seller state == place of supply): CGST + SGST = rate/2 each
 * Inter-state supply: IGST = full rate
 */
export type LineInput = {
  productId?: string | null;
  description: string;
  hsn?: string | null;
  qty: number;
  unit?: string;
  unitPrice: number; // paise
  discountPct: number; // 0–100
  taxRate: number; // basis points, 1800 = 18%
};

export type LineResult = LineInput & {
  gross: number; discount: number; taxable: number;
  cgst: number; sgst: number; igst: number; lineTotal: number;
};

export type DocTotals = {
  lines: LineResult[];
  subtotal: number; discount: number; taxable: number;
  cgst: number; sgst: number; igst: number; tax: number;
  roundOff: number; total: number; maxDiscountPct: number;
};

const r = (n: number) => Math.round(n);

export function computeLine(l: LineInput, interState: boolean): LineResult {
  const qty = Math.max(0, Number(l.qty) || 0);
  const price = Math.max(0, r(Number(l.unitPrice) || 0));
  const pct = Math.min(100, Math.max(0, Number(l.discountPct) || 0));
  const gross = r(qty * price);
  const discount = r((gross * pct) / 100);
  const taxable = gross - discount;
  const rate = Math.max(0, Number(l.taxRate) || 0);
  let cgst = 0, sgst = 0, igst = 0;
  if (interState) igst = r((taxable * rate) / 10000);
  else { cgst = r((taxable * rate) / 20000); sgst = cgst; }
  return { ...l, qty, unitPrice: price, discountPct: pct, taxRate: rate, gross, discount, taxable, cgst, sgst, igst, lineTotal: taxable + cgst + sgst + igst };
}

export function computeDoc(lines: LineInput[], sellerState: string, placeOfSupply: string, roundToRupee = true): DocTotals {
  const inter = sellerState !== placeOfSupply;
  const out = lines.filter((l) => l.description?.trim() && l.qty > 0).map((l) => computeLine(l, inter));
  const sum = (k: keyof LineResult) => out.reduce((a, l) => a + (l[k] as number), 0);
  const subtotal = sum("gross"), discount = sum("discount"), taxable = sum("taxable");
  const cgst = sum("cgst"), sgst = sum("sgst"), igst = sum("igst");
  const tax = cgst + sgst + igst;
  const raw = taxable + tax;
  const total = roundToRupee ? Math.round(raw / 100) * 100 : raw;
  return {
    lines: out, subtotal, discount, taxable, cgst, sgst, igst, tax,
    roundOff: total - raw, total,
    maxDiscountPct: out.reduce((m, l) => Math.max(m, l.discountPct), 0),
  };
}
