import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, ipAllowed, maskPhone, passwordProblems } from "../lib/security";
import { evalConds, normalizePayload, TRIGGERS, ACTIONS } from "../lib/workflows";
import { RECIPES } from "../lib/workflow-recipes";
import { render } from "../lib/messaging";
import { parseCustom } from "../lib/custom";
import { workingDays, minutesLate, distanceM } from "../lib/hr";
import { PACKS } from "../lib/industry";

test("AES-256-GCM encryption round-trips and is non-deterministic; tampering fails", () => {
  const a = encrypt("JBSWY3DPEHPK3PXP"), b = encrypt("JBSWY3DPEHPK3PXP");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("enc:v1:"));
  assert.equal(decrypt(a), "JBSWY3DPEHPK3PXP");
  assert.equal(decrypt("legacy-plain"), "legacy-plain");
  const bad = a.slice(0, -2) + (a.endsWith("A") ? "BB" : "AA");
  assert.throws(() => decrypt(bad));
});

test("IP allowlist: exact, CIDR, IPv4-mapped IPv6, empty = allow", () => {
  assert.ok(ipAllowed("1.2.3.4", []));
  assert.ok(ipAllowed("203.0.113.77", ["203.0.113.0/24"]));
  assert.ok(!ipAllowed("203.0.114.1", ["203.0.113.0/24"]));
  assert.ok(ipAllowed("::ffff:10.0.0.5", ["10.0.0.0/8"]));
  assert.ok(ipAllowed("10.1.1.1", ["10.1.1.1"]));
  assert.ok(!ipAllowed(null, ["10.1.1.1"]));
});

test("password policy & phone masking", () => {
  assert.ok(passwordProblems("short1"));
  assert.ok(passwordProblems("onlyletterslong"));
  assert.ok(passwordProblems("password123"));
  assert.ok(passwordProblems("rahul12345678", "rahul@x.com"));
  assert.equal(passwordProblems("Tiger-Mango-42"), null);
  assert.equal(maskPhone("+919876543210"), "+9198•••••210");
});

test("workflow conditions: ops, any/all, numbers, empty", () => {
  const ctx = { lead: { status: "new", score: 72, source: "Facebook", calls_since_start: 0, tags: "vip,bulk" }, invoice: { balance: 50000 } };
  assert.ok(evalConds([{ field: "lead.status", op: "eq", value: "NEW" }], ctx));
  assert.ok(evalConds([{ field: "lead.score", op: "gte", value: "60" }, { field: "invoice.balance", op: "lte", value: "50000" }], ctx));
  assert.ok(evalConds([{ field: "lead.source", op: "in", value: "google_ads, facebook" }], ctx));
  assert.ok(evalConds([{ field: "lead.calls_since_start", op: "empty" }], ctx));
  assert.ok(!evalConds([{ field: "lead.calls_since_start", op: "not_empty" }], ctx));
  assert.ok(evalConds([{ field: "lead.status", op: "eq", value: "won" }, { field: "lead.tags", op: "contains", value: "vip" }], ctx, "any"));
  assert.ok(evalConds([], ctx));
});

test("trigger payloads are normalised to entity ids", () => {
  assert.deepEqual(normalizePayload("lead.created", { id: "L1" }), { id: "L1", leadId: "L1" });
  assert.deepEqual(normalizePayload("customer.inactive", { id: "C1" }), { id: "C1", contactId: "C1" });
  assert.equal(normalizePayload("invoice.overdue", { id: "I1", invoiceId: "I9" }).invoiceId, "I9");
});

test("every recipe uses known triggers and actions", () => {
  const triggers = new Set(TRIGGERS.map((t) => t.key)), actions = new Set(ACTIONS.map((a) => a.key));
  const walk = (steps: any[]): void => steps.forEach((s) => { if (s.type === "action") assert.ok(actions.has(s.action), s.action); if (s.type === "condition") { walk(s.then); walk(s.else); } });
  for (const r of RECIPES) { assert.ok(triggers.has(r.trigger), r.key); walk(r.steps); }
  assert.ok(RECIPES.length >= 15);
});

test("templates render nested variables and blank for missing", () => {
  assert.equal(render("Hi {{ lead.first_name }}, due {{invoice.balance}}{{nope.x}}", { lead: { first_name: "Rahul" }, invoice: { balance: "₹1,200" } }), "Hi Rahul, due ₹1,200");
});

test("custom field parsing validates types", () => {
  const defs: any[] = [
    { key: "credit", label: "Credit", type: "number", options: [], required: true },
    { key: "tier", label: "Tier", type: "select", options: ["Gold", "Silver"], required: false },
    { key: "langs", label: "Langs", type: "multiselect", options: ["hi", "en"], required: false },
    { key: "vip", label: "VIP", type: "boolean", options: [], required: false },
  ];
  const fd = new FormData(); fd.set("cf_credit", "50000"); fd.set("cf_tier", "Gold"); fd.append("cf_langs", "hi"); fd.append("cf_langs", "fr"); fd.set("cf_vip", "on");
  assert.deepEqual(parseCustom(defs, fd), { credit: 50000, tier: "Gold", langs: ["hi"], vip: true });
  const bad = new FormData(); bad.set("cf_credit", "abc");
  assert.throws(() => parseCustom(defs, bad), /must be a number/);
  assert.throws(() => parseCustom(defs, new FormData()), /required/);
});

test("HR helpers", () => {
  assert.equal(workingDays(new Date("2026-11-16"), new Date("2026-11-22")), 6); // Mon–Sun → 6 working days
  assert.equal(minutesLate(new Date("2026-11-18T04:20:00Z"), "09:30", "Asia/Kolkata"), 20);
  assert.ok(Math.abs(distanceM({ lat: 28.6139, lng: 77.209 }, { lat: 28.5355, lng: 77.391 }) - 19900) < 1500);
});

test("industry packs are well-formed", () => {
  for (const p of PACKS) for (const o of p.objects) for (const f of o.fields) if (["select", "multiselect"].includes(f.type)) assert.ok(f.options?.length, `${p.key}.${o.key}.${f.key}`);
  assert.ok(PACKS.length >= 8);
});
