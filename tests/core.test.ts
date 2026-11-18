import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDoc, computeLine } from "../lib/pricing";
import { generateSecret, totpAt, verifyTotp } from "../lib/totp";
import { parseCsv, toCsv } from "../lib/leads";
import { matches } from "../lib/assignment";
import { fiscalYear, normalizePhone } from "../lib/utils";
import { rupeesToPaise, inrCompact } from "../lib/money";

test("GST intra-state splits CGST/SGST equally", () => {
  const l = computeLine({ description: "Pipe", qty: 10, unitPrice: 85000, discountPct: 0, taxRate: 1800 }, false);
  assert.equal(l.taxable, 850000);
  assert.equal(l.cgst, 76500);
  assert.equal(l.sgst, 76500);
  assert.equal(l.igst, 0);
  assert.equal(l.lineTotal, 1003000);
});

test("GST inter-state uses IGST", () => {
  const d = computeDoc([{ description: "Tank", qty: 1, unitPrice: 690000, discountPct: 0, taxRate: 1800 }], "07", "09");
  assert.equal(d.igst, 124200);
  assert.equal(d.cgst + d.sgst, 0);
  assert.equal(d.total, 814200);
});

test("discount applies before tax; total rounds to rupee with round-off", () => {
  const d = computeDoc([{ description: "X", qty: 3, unitPrice: 33333, discountPct: 5, taxRate: 1200 }], "07", "07");
  assert.equal(d.subtotal, 99999);
  assert.equal(d.discount, 5000);
  assert.equal(d.taxable, 94999);
  assert.equal(d.total % 100, 0);
  assert.equal(d.total, d.taxable + d.tax + d.roundOff);
  assert.equal(d.maxDiscountPct, 5);
});

test("empty / zero-qty lines are ignored", () => {
  const d = computeDoc([{ description: "", qty: 1, unitPrice: 100, discountPct: 0, taxRate: 0 }, { description: "A", qty: 0, unitPrice: 100, discountPct: 0, taxRate: 0 }], "07", "07");
  assert.equal(d.lines.length, 0);
  assert.equal(d.total, 0);
});

test("TOTP matches RFC 6238 test vector and verifies current code", () => {
  // RFC 6238 SHA-1 secret "12345678901234567890" in base32, T=59s → counter 1 → 94287082 (8 digits) → 287082
  assert.equal(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
  const s = generateSecret();
  assert.ok(verifyTotp(s, totpAt(s, Math.floor(Date.now() / 30000))));
  assert.ok(!verifyTotp(s, "000000") || totpAt(s, Math.floor(Date.now() / 30000)) === "000000");
});

test("CSV parser handles quotes, commas and CRLF; round-trips", () => {
  const rows = parseCsv('name,notes\r\n"Verma, Rahul","said ""call me"""\nAnita,ok\n');
  assert.deepEqual(rows, [["name", "notes"], ["Verma, Rahul", 'said "call me"'], ["Anita", "ok"]]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("assignment conditions", () => {
  const lead = { city: "Lucknow", source: "facebook", budget: 250000, language: "hi" };
  assert.ok(matches([{ field: "city", op: "in", value: "Lucknow, Kanpur" }], lead));
  assert.ok(matches([{ field: "budget", op: "gte", value: "200000" }, { field: "language", op: "eq", value: "HI" }], lead));
  assert.ok(!matches([{ field: "source", op: "eq", value: "google_ads" }], lead));
  assert.ok(matches([], lead));
});

test("helpers: phone normalisation, FY, money", () => {
  assert.equal(normalizePhone("098765 43210"), "+919876543210");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "+14155550100");
  assert.equal(fiscalYear(new Date("2026-03-31")), "2025-26");
  assert.equal(fiscalYear(new Date("2026-04-01")), "2026-27");
  assert.equal(rupeesToPaise("₹1,25,000.50"), 12500050n);
  assert.equal(inrCompact(21000000), "₹2.10 L");
});
