/** Money is stored as BigInt paise. These helpers keep conversions in one place. */
export type Paise = bigint | number;

export function toNum(v: Paise | null | undefined): number {
  return v == null ? 0 : typeof v === "bigint" ? Number(v) : v;
}

/** Rupee string from form input -> paise BigInt. */
export function rupeesToPaise(v: string | number | null | undefined): bigint {
  if (v == null || v === "") return 0n;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n * 100));
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function inr(paise: Paise | null | undefined, decimals = true) {
  return (decimals ? fmt : fmt0).format(toNum(paise) / 100);
}

/** Compact Indian notation: ₹2.1 L, ₹3.4 Cr */
export function inrCompact(paise: Paise | null | undefined) {
  const r = toNum(paise) / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  if (Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(1)} K`;
  return `₹${r.toFixed(0)}`;
}
