/* Demo data: two tenants (proves isolation), 7 users across roles, ~6 months of activity. */
import { PrismaClient, type LeadSource, type LeadStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionTenant } from "../lib/tenant-setup";
import { computeDoc, type LineInput } from "../lib/pricing";
import { fiscalYear } from "../lib/utils";

const prisma = new PrismaClient();
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo + 1));
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86400_000 - hours * 3600_000);
const token = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

const FIRST = ["Rahul", "Anita", "Suresh", "Pooja", "Manoj", "Kavita", "Deepak", "Ritu", "Sanjay", "Meena", "Arjun", "Nisha", "Vivek", "Swati", "Rohit", "Geeta", "Ajay", "Sneha", "Karan", "Divya", "Imran", "Farah", "Harpreet", "Gurpreet", "Lakshmi", "Venkat"];
const LAST = ["Verma", "Gupta", "Agarwal", "Mishra", "Yadav", "Khan", "Singh", "Jain", "Bansal", "Chauhan", "Malhotra", "Saxena", "Tiwari", "Reddy", "Iyer", "Kapoor"];
const COMPANY = ["Traders", "Enterprises", "Builders", "Constructions", "Hardware", "Infra", "Developers", "Industries", "& Sons", "Agencies"];
const CITIES = [["Delhi", "Delhi", "07"], ["Noida", "Uttar Pradesh", "09"], ["Gurugram", "Haryana", "06"], ["Lucknow", "Uttar Pradesh", "09"], ["Kanpur", "Uttar Pradesh", "09"], ["Jaipur", "Rajasthan", "08"], ["Ghaziabad", "Uttar Pradesh", "09"]] as const;
const SOURCES: LeadSource[] = ["facebook", "facebook", "google_ads", "google_ads", "website", "website", "referral", "whatsapp", "phone", "import", "campaign", "instagram"];

async function wipe() {
  await prisma.tenant.deleteMany({ where: { slug: { in: ["sharma-distributors", "pixelcraft"] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: ".demo" } } });
}

async function main() {
  await wipe();
  const passwordHash = await bcrypt.hash("Password@123", 10);

  // ── Platform owner ──
  await prisma.user.create({ data: { email: "platform@bizos.demo", name: "Platform Owner", passwordHash, isPlatformAdmin: true } });

  // ── Tenant 1: distributor (Delhi) ──
  const t = await prisma.tenant.create({
    data: {
      name: "Sharma Distributors Pvt Ltd", slug: "sharma-distributors", businessType: "distributor", stateCode: "07",
      gstin: "07AABCS1234F1Z5", address: "Plot 14, Okhla Industrial Area Phase II\nNew Delhi 110020", phone: "+91 11 4100 2200",
      email: "accounts@sharmadistributors.in", status: "trial", plan: "professional", seats: 10, trialEndsAt: new Date(Date.now() + 9 * 86400_000),
      bankDetails: "HDFC Bank · A/c 50200012345678 · IFSC HDFC0000123\nUPI: sharmadist@hdfcbank",
    },
  });
  const { branch: ho } = await provisionTenant(prisma, t.id, "07", "distributor");
  await prisma.branch.update({ where: { id: ho.id }, data: { name: "Delhi (HO)", code: "DEL", city: "Delhi" } });
  const lko = await prisma.branch.create({ data: { tenantId: t.id, name: "Lucknow", code: "LKO", city: "Lucknow", stateCode: "09" } });
  const delTeam = await prisma.team.create({ data: { tenantId: t.id, name: "Delhi Sales", branchId: ho.id } });
  const lkoTeam = await prisma.team.create({ data: { tenantId: t.id, name: "Lucknow Calling", branchId: lko.id } });
  const role = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { tenantId: t.id, key } })).id;

  const mk = async (email: string, name: string, roleKey: string, extra: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({ data: { email, name, passwordHash, lastLoginAt: ago(int(0, 2)) } });
    return prisma.membership.create({ data: { tenantId: t.id, userId: u.id, roleId: await role(roleKey), branchId: ho.id, ...extra } });
  };
  const admin = await mk("admin@sharma.demo", "Rajesh Sharma", "admin", { title: "Managing Director" });
  const manager = await mk("manager@sharma.demo", "Priya Mehta", "sales_manager", { teamId: delTeam.id, managerId: admin.id, title: "Sales Manager", languages: ["hi", "en"] });
  const sales = await mk("sales@sharma.demo", "Amit Kumar", "sales_exec", { teamId: delTeam.id, managerId: manager.id, title: "Sales Executive", languages: ["hi", "en"] });
  const tc1 = await mk("telecaller@sharma.demo", "Neha Singh", "telecaller", { teamId: delTeam.id, managerId: manager.id, title: "Telecaller", languages: ["hi", "en"] });
  const tc2 = await mk("telecaller2@sharma.demo", "Vikram Yadav", "telecaller", { teamId: lkoTeam.id, branchId: lko.id, managerId: manager.id, title: "Telecaller", languages: ["hi"] });
  const acct = await mk("accounts@sharma.demo", "Sunita Gupta", "accountant", { title: "Accounts Head" });
  const agents = [tc1, tc2, sales, manager];

  await prisma.assignmentRule.createMany({
    data: [
      { tenantId: t.id, name: "Lucknow & Kanpur leads → Lucknow calling", priority: 10, strategy: "round_robin", conditions: [{ field: "city", op: "in", value: "Lucknow,Kanpur" }], memberIds: [tc2.id] },
      { tenantId: t.id, name: "Big-budget leads → Sales executive", priority: 20, strategy: "round_robin", conditions: [{ field: "budget", op: "gte", value: "200000" }], memberIds: [sales.id, manager.id] },
      { tenantId: t.id, name: "Everything else → Delhi telecalling (least workload)", priority: 100, strategy: "least_workload", conditions: [], memberIds: [tc1.id, sales.id] },
    ],
  });

  // Products
  const productData = [
    ["GI-PIPE-25", "GI Pipe 25mm (6m)", "goods", "pcs", "7306", 85000, 1800, 420, 100],
    ["GI-PIPE-50", "GI Pipe 50mm (6m)", "goods", "pcs", "7306", 162000, 1800, 85, 100],
    ["PVC-PIPE-110", "PVC Pipe 110mm (6m)", "goods", "pcs", "3917", 64000, 1800, 300, 80],
    ["CPVC-FIT-KIT", "CPVC Fittings Kit (50 pc)", "goods", "kit", "3917", 245000, 1800, 60, 20],
    ["OPC-53", "OPC Cement 53 Grade (50kg)", "goods", "bag", "2523", 39000, 2800, 1200, 300],
    ["TMT-12", "TMT Bar 12mm Fe550 (per qtl)", "goods", "qtl", "7214", 580000, 1800, 40, 50],
    ["PAINT-EXT-20", "Exterior Emulsion 20L", "goods", "can", "3209", 720000, 1800, 35, 10],
    ["WTANK-1000", "Water Tank 1000L Triple Layer", "goods", "pcs", "3925", 690000, 1800, 18, 5],
    ["SVC-INSTALL", "Plumbing Installation (per site visit)", "service", "visit", "9954", 250000, 1800, 0, 0],
    ["SVC-AMC", "Annual Maintenance Contract", "service", "year", "9987", 1800000, 1800, 0, 0],
  ] as const;
  const products: import("@prisma/client").Product[] = [];
  for (const [sku, name, type, unit, hsn, price, taxRate, stock, minStock] of productData) {
    products.push(await prisma.product.create({ data: { tenantId: t.id, sku, name, type, unit, hsn, price: BigInt(price), taxRate, stock, minStock } }));
  }

  // Customers
  const contacts: import("@prisma/client").Contact[] = [];
  for (let i = 0; i < 28; i++) {
    const [city, , st] = pick(CITIES);
    const ln = pick(LAST);
    const gst = rnd() > 0.3 ? `${st}AAB${String.fromCharCode(65 + i % 26)}${ln.slice(0, 1).toUpperCase()}${int(1000, 9999)}F1Z${int(1, 9)}` : null;
    contacts.push(await prisma.contact.create({
      data: {
        tenantId: t.id, name: `${pick(FIRST)} ${ln}`, companyName: `${ln} ${pick(COMPANY)}`, phone: `+9198${int(10000000, 99999999)}`,
        email: `${ln.toLowerCase()}${i}@example.in`, gstin: gst, stateCode: st, address: `${int(1, 200)}, Main Market\n${city}`,
        ownerId: pick([sales, manager]).id, branchId: st === "09" ? lko.id : ho.id, createdAt: ago(int(30, 200)),
      },
    }));
  }

  // Leads (+ activities, calls, follow-ups)
  const statuses: LeadStatus[] = ["new", "new", "new", "contacted", "contacted", "contacted", "qualified", "qualified", "converted", "lost", "unqualified"];
  const leadIds: string[] = [];
  for (let n = 1; n <= 90; n++) {
    const [city, state] = pick(CITIES);
    const fn = pick(FIRST), ln = pick(LAST);
    const createdAt = ago(int(0, 75), int(0, 20));
    const status = pick(statuses);
    const owner = ["Lucknow", "Kanpur"].includes(city) ? tc2 : pick([tc1, tc1, sales, manager]);
    const budget = rnd() > 0.35 ? BigInt(pick([25000, 50000, 80000, 150000, 250000, 500000, 900000]) * 100) : null;
    const contacted = status !== "new";
    const lead = await prisma.lead.create({
      data: {
        tenantId: t.id, number: n, name: `${fn} ${ln}`, companyName: rnd() > 0.4 ? `${ln} ${pick(COMPANY)}` : null, phone: `+9197${int(10000000, 99999999)}`,
        email: rnd() > 0.5 ? `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com` : null, source: pick(SOURCES), city, state, language: pick(["hi", "hi", "en"]),
        product: pick(products).name, budget, status, priority: pick(["low", "medium", "medium", "high"]), ownerId: owner.id, assignedAt: createdAt,
        branchId: owner.branchId, createdAt, firstResponseAt: contacted ? new Date(createdAt.getTime() + int(5, 300) * 60_000) : null,
        lastActivityAt: contacted ? ago(int(0, 20)) : createdAt, lostReason: status === "lost" ? pick(["Price too high", "Bought from competitor", "Project postponed"]) : null,
        contactId: status === "converted" ? pick(contacts).id : null, tags: rnd() > 0.8 ? ["bulk-order"] : [],
        nextFollowUpAt: ["contacted", "qualified"].includes(status) && rnd() > 0.3 ? new Date(Date.now() + int(-48, 72) * 3600_000) : null,
      },
    });
    leadIds.push(lead.id);
    await prisma.activity.create({ data: { tenantId: t.id, leadId: lead.id, type: "system", body: `Lead created (source: ${lead.source.replace("_", " ")})`, createdAt } });
    if (lead.nextFollowUpAt) await prisma.followUp.create({ data: { tenantId: t.id, leadId: lead.id, assigneeId: owner.id, dueAt: lead.nextFollowUpAt, note: pick(["Share price list", "Confirm quantity", "Call back after site visit", "Discuss delivery schedule"]) } });
    if (contacted) {
      const nCalls = int(1, 4);
      for (let c = 0; c < nCalls; c++) {
        const at = new Date(Math.min(Date.now() - 3600_000, createdAt.getTime() + (c + 1) * int(2, 48) * 3600_000));
        const connected = rnd() > 0.35;
        const disp = connected ? pick(["interested", "follow_up", "call_back", "not_interested"]) : pick(["no_answer", "busy"]);
        const talk = connected ? int(40, 420) : 0;
        await prisma.callLog.create({
          data: {
            tenantId: t.id, leadId: lead.id, agentId: owner.id, toNumber: lead.phone!, status: connected ? "completed" : "no_answer", disposition: disp,
            startedAt: at, answeredAt: connected ? at : null, endedAt: new Date(at.getTime() + (talk + 20) * 1000), talkSeconds: talk,
            providerCallId: `seed_${lead.id}_${c}`, notes: connected ? pick(["Needs 200 pcs, wants best rate", "Asked for catalogue on WhatsApp", "Site visit next week", "Price objection, compare with local dealer", ""]) : null, createdAt: at,
          },
        });
        await prisma.activity.create({ data: { tenantId: t.id, leadId: lead.id, type: "call", body: `Call ${disp.replace("_", " ")}${talk ? ` · ${Math.floor(talk / 60)}:${String(talk % 60).padStart(2, "0")}` : ""}`, actorId: owner.id, createdAt: at } });
      }
    }
  }
  // Today's calls for live dashboard numbers
  for (let i = 0; i < 26; i++) {
    const agent = pick(agents), at = new Date(Date.now() - int(5, 300) * 60_000), talk = rnd() > 0.4 ? int(30, 360) : 0;
    await prisma.callLog.create({ data: { tenantId: t.id, leadId: pick(leadIds), agentId: agent.id, toNumber: `+9197${int(10000000, 99999999)}`, status: talk ? "completed" : "no_answer", disposition: talk ? pick(["interested", "follow_up", "not_interested"]) : "no_answer", startedAt: at, answeredAt: talk ? at : null, endedAt: new Date(at.getTime() + talk * 1000), talkSeconds: talk, providerCallId: `seed_today_${i}` } });
  }
  // Scores
  const SW: Record<string, number> = { referral: 25, website: 18, google_ads: 15, whatsapp: 15, phone: 15, facebook: 10, instagram: 10, campaign: 10, import: 5 };
  for (const id of leadIds) {
    const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
    const calls = await prisma.callLog.count({ where: { leadId: id, talkSeconds: { gt: 30 } } });
    let s = (SW[l.source] ?? 8) + Math.min(20, calls * 7) + (l.budget ? (Number(l.budget) >= 50000000 ? 20 : Number(l.budget) >= 10000000 ? 14 : 8) : 0) + (l.status === "qualified" ? 15 : 0);
    if (["lost", "unqualified"].includes(l.status)) s = Math.min(s, 10);
    s = Math.min(100, s);
    await prisma.lead.update({ where: { id }, data: { score: s, scoreBand: l.status === "lost" ? "lost" : s >= 60 ? "hot" : s >= 35 ? "warm" : "cold" } });
  }

  // Deals
  const stages = await prisma.pipelineStage.findMany({ where: { tenantId: t.id }, orderBy: { order: "asc" } });
  const dealTitles = ["GI pipes for housing project", "Plumbing material — hospital wing", "Cement supply Q3", "Water tanks for society", "AMC — commercial complex", "TMT bars — warehouse", "CPVC kits — hotel renovation", "Exterior paint — school"];
  for (let d = 1; d <= 22; d++) {
    const st = pick(stages.slice(1));
    const c = pick(contacts);
    await prisma.deal.create({ data: { tenantId: t.id, number: d, title: `${pick(dealTitles)} · ${c.companyName}`, stageId: st.id, contactId: c.id, ownerId: pick([sales, manager]).id, branchId: c.branchId, amount: BigInt(int(80, 2500) * 1000 * 100), expectedClose: new Date(Date.now() + int(-10, 60) * 86400_000), closedAt: st.type === "open" ? null : ago(int(1, 60)), createdAt: ago(int(5, 90)) } });
  }

  // Invoices across ~6 months + payments
  const fy = fiscalYear();
  let invNo = 0;
  const lines = (): LineInput[] => Array.from({ length: int(1, 3) }, () => { const p = pick(products); return { productId: p.id, description: p.name, hsn: p.hsn, qty: int(2, 80), unit: p.unit, unitPrice: Number(p.price), discountPct: pick([0, 0, 2, 5]), taxRate: p.taxRate }; });
  for (let i = 0; i < 46; i++) {
    const c = pick(contacts);
    const issue = ago(i < 6 ? int(0, 6) : int(7, 175));
    const doc = computeDoc(lines(), "07", c.stateCode ?? "07");
    const due = new Date(issue.getTime() + 15 * 86400_000);
    const r = rnd();
    const paid = r > 0.45 ? doc.total : r > 0.3 ? Math.round(doc.total * 0.5 / 100) * 100 : 0;
    const balance = doc.total - paid;
    const status = balance === 0 ? "paid" : due < new Date() ? "overdue" : paid ? "partially_paid" : "issued";
    invNo++;
    const inv = await prisma.invoice.create({
      data: {
        tenantId: t.id, number: `INV/${fy}/${String(invNo).padStart(4, "0")}`, contactId: c.id, ownerId: pick([sales, manager]).id, branchId: c.branchId, status,
        issueDate: issue, dueDate: due, placeOfSupply: c.stateCode ?? "07", subtotal: BigInt(doc.subtotal), discount: BigInt(doc.discount), tax: BigInt(doc.tax), roundOff: BigInt(doc.roundOff),
        total: BigInt(doc.total), amountPaid: BigInt(paid), balance: BigInt(balance), terms: t.invoiceTerms, publicToken: token(), createdAt: issue,
        items: { create: doc.lines.map((l, k) => ({ productId: l.productId, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit ?? "pcs", unitPrice: BigInt(l.unitPrice), discountPct: l.discountPct, taxRate: l.taxRate, taxable: BigInt(l.taxable), cgst: BigInt(l.cgst), sgst: BigInt(l.sgst), igst: BigInt(l.igst), lineTotal: BigInt(l.lineTotal), sort: k })) },
      },
    });
    if (paid) await prisma.payment.create({ data: { tenantId: t.id, invoiceId: inv.id, contactId: c.id, amount: BigInt(paid), method: pick(["upi", "bank_transfer", "cheque", "cash"]), reference: `UTR${int(100000, 999999)}`, receivedOn: new Date(Math.min(Date.now(), issue.getTime() + int(1, 20) * 86400_000)), createdById: acct.id } });
  }
  // A draft invoice
  { const c = contacts[0]; const doc = computeDoc(lines(), "07", c.stateCode ?? "07");
    await prisma.invoice.create({ data: { tenantId: t.id, contactId: c.id, ownerId: sales.id, status: "draft", dueDate: new Date(Date.now() + 15 * 86400_000), placeOfSupply: c.stateCode ?? "07", subtotal: BigInt(doc.subtotal), discount: BigInt(doc.discount), tax: BigInt(doc.tax), roundOff: BigInt(doc.roundOff), total: BigInt(doc.total), balance: BigInt(doc.total), publicToken: token(),
      items: { create: doc.lines.map((l, k) => ({ productId: l.productId, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit ?? "pcs", unitPrice: BigInt(l.unitPrice), discountPct: l.discountPct, taxRate: l.taxRate, taxable: BigInt(l.taxable), cgst: BigInt(l.cgst), sgst: BigInt(l.sgst), igst: BigInt(l.igst), lineTotal: BigInt(l.lineTotal), sort: k })) } } }); }

  // Quotations in different states
  const qStates = ["draft", "pending_approval", "approved", "sent", "viewed", "accepted", "accepted", "rejected", "sent", "draft", "viewed", "approved"] as const;
  for (let i = 0; i < qStates.length; i++) {
    const c = pick(contacts);
    const ls = lines().map((l) => (qStates[i] === "pending_approval" ? { ...l, discountPct: 15 } : l));
    const doc = computeDoc(ls, "07", c.stateCode ?? "07");
    await prisma.quotation.create({
      data: {
        tenantId: t.id, number: `QT/${fy}/${String(i + 1).padStart(4, "0")}`, contactId: c.id, ownerId: qStates[i] === "pending_approval" ? sales.id : pick([sales, manager]).id, status: qStates[i],
        issueDate: ago(int(1, 20)), validUntil: new Date(Date.now() + int(3, 20) * 86400_000), placeOfSupply: c.stateCode ?? "07",
        subtotal: BigInt(doc.subtotal), discount: BigInt(doc.discount), tax: BigInt(doc.tax), roundOff: BigInt(doc.roundOff), total: BigInt(doc.total), maxDiscountPct: doc.maxDiscountPct,
        terms: "Prices valid for 15 days. Delivery within 7 working days of PO.", publicToken: token(), viewCount: ["viewed", "accepted"].includes(qStates[i]) ? int(1, 5) : 0,
        acceptedBy: qStates[i] === "accepted" ? c.name : null, acceptedAt: qStates[i] === "accepted" ? ago(int(0, 5)) : null, rejectedReason: qStates[i] === "rejected" ? "Found a cheaper supplier" : null,
        items: { create: doc.lines.map((l, k) => ({ productId: l.productId, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit ?? "pcs", unitPrice: BigInt(l.unitPrice), discountPct: l.discountPct, taxRate: l.taxRate, taxable: BigInt(l.taxable), cgst: BigInt(l.cgst), sgst: BigInt(l.sgst), igst: BigInt(l.igst), lineTotal: BigInt(l.lineTotal), sort: k })) },
      },
    });
  }

  // Tickets
  const tk = [["Leakage in delivered CPVC joints", "urgent", "Product issue"], ["Invoice GSTIN correction", "medium", "Billing"], ["Delivery delayed — Noida site", "high", "Delivery"], ["Need installation team", "medium", "Installation"], ["Damaged water tank lid", "low", "Product issue"]] as const;
  for (let i = 0; i < tk.length; i++) await prisma.ticket.create({ data: { tenantId: t.id, number: i + 1, subject: tk[i][0], priority: tk[i][1], category: tk[i][2], contactId: pick(contacts).id, assigneeId: pick([manager, sales]).id, status: i === 4 ? "resolved" : "open", dueAt: new Date(Date.now() + int(-6, 20) * 3600_000), createdAt: ago(int(0, 4)) } });

  await prisma.dndNumber.createMany({ data: [{ tenantId: t.id, phone: "+919999900001", reason: "Opt-out on call" }, { tenantId: t.id, phone: "+919999900002", reason: "NCPR registered" }] });
  await prisma.notification.createMany({ data: [
    { tenantId: t.id, membershipId: admin.id, title: "Approval needed: QT/" + fy + "/0002", body: "15% discount requested by Amit Kumar", link: "/quotations" },
    { tenantId: t.id, membershipId: tc1.id, title: "5 new leads assigned to you", body: "Facebook · Delhi NCR", link: "/leads" },
  ] });

  for (const [key, value] of [["lead", 90], ["deal", 22], [`QT/${fy}`, qStates.length], [`INV/${fy}`, invNo], ["ticket", tk.length]] as const) {
    await prisma.counter.upsert({ where: { tenantId_key: { tenantId: t.id, key } }, create: { tenantId: t.id, key, value }, update: { value } });
  }

  // ── Phase 2 demo data: stock ledger, vendors & POs, projects & tasks, HR, expenses, KB, custom records ──
  for (const p of products.filter((p) => p.type === "goods")) {
    await prisma.stockMovement.create({ data: { tenantId: t.id, productId: p.id, qty: p.stock, balance: p.stock, type: "adjust", note: "Opening stock", createdAt: ago(120) } });
  }
  const vendors = [];
  for (const [name, gstin, st] of [["Tata Steel Distributors", "07AAACT1234A1Z1", "07"], ["Supreme Pipes Ltd", "27AAACS5678B1Z2", "27"], ["UltraTech Cement Depot", "09AAACU9012C1Z3", "09"]] as const) {
    vendors.push(await prisma.vendor.create({ data: { tenantId: t.id, name, gstin, stateCode: st, phone: `+9198${int(10000000, 99999999)}`, paymentTerms: pick([15, 30, 45]) } }));
  }
  const poDefs: [number, string, number][] = [[0, "received", 40], [1, "approved", 10], [2, "pending_approval", 3]];
  for (const [i, [vi, status, ago_]] of poDefs.entries()) {
    const items = [{ productId: products[i * 2].id, name: products[i * 2].name, qty: int(50, 200), rate: Number(products[i * 2].price) * 0.75 }];
    const total = BigInt(Math.round(items.reduce((a, x) => a + x.qty * x.rate, 0)));
    const po = await prisma.purchaseOrder.create({ data: { tenantId: t.id, number: `PO/${fy}/${String(i + 1).padStart(4, "0")}`, vendorId: vendors[vi].id, status, items, total, expectedDate: ago(ago_ - 7), receivedAt: status === "received" ? ago(ago_ - 6) : null, createdById: acct.id, createdAt: ago(ago_) } });
    if (status === "pending_approval") await prisma.approvalRequest.create({ data: { tenantId: t.id, entity: "purchase_order", entityId: po.id, title: `${po.number} · ${vendors[vi].name} · ₹${(Number(total) / 100).toLocaleString("en-IN")}`, amount: total, requestedById: acct.id, levels: ["admin"] } });
  }
  const proj = [];
  for (const [n, name, c] of [[1, "Noida housing society — plumbing supply", 0], [2, "Hospital wing water tanks", 3], [3, "Warehouse TMT rollout", 5]] as const) {
    proj.push(await prisma.project.create({ data: { tenantId: t.id, number: n, name, contactId: contacts[c].id, ownerId: manager.id, status: "active", budget: BigInt(int(5, 40) * 100000 * 100), startDate: ago(30), dueDate: ago(-int(10, 60)) } }));
  }
  const taskTitles = ["Site survey & measurements", "Send revised BOQ", "Confirm delivery schedule", "Collect advance payment", "Arrange transport", "Quality check on delivery", "Installation sign-off", "Share warranty documents", "Follow up on pending PO", "Update price list for Q4", "Call back Gupta Developers", "Prepare monthly sales review"];
  for (let i = 0; i < taskTitles.length; i++) {
    const status = pick(["todo", "todo", "in_progress", "review", "done"]);
    await prisma.task.create({ data: { tenantId: t.id, number: i + 1, title: taskTitles[i], projectId: i < 9 ? proj[i % 3].id : null, assigneeId: pick([sales, manager, tc1, acct]).id, createdById: manager.id, priority: pick(["low", "medium", "medium", "high", "urgent"]), status, dueAt: new Date(Date.now() + int(-72, 120) * 3600_000), loggedMinutes: status === "todo" ? 0 : int(30, 480), estimateMins: int(2, 12) * 60, completedAt: status === "done" ? ago(int(0, 5)) : null } });
  }
  // attendance for the last 20 working days
  for (const m of [admin, manager, sales, tc1, tc2, acct]) {
    for (let d = 1; d <= 24; d++) {
      const day = new Date(Date.now() - d * 86400_000);
      if (day.getDay() === 0 || rnd() < 0.06) continue;
      const date = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
      const lateMin = rnd() < 0.15 ? int(20, 70) : int(-20, 10);
      const checkIn = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 4, 0) + lateMin * 60_000); // 09:30 IST = 04:00 UTC
      const mins = int(470, 560);
      await prisma.attendanceRecord.create({ data: { tenantId: t.id, membershipId: m.id, date, checkIn, checkOut: new Date(checkIn.getTime() + mins * 60_000), minutesWorked: mins, status: lateMin > 15 ? "late" : "present", note: lateMin > 15 ? `${lateMin} min late` : null, checkInLat: 28.53 + rnd() / 100, checkInLng: 77.27 + rnd() / 100 } });
    }
  }
  const lv1 = await prisma.leaveRequest.create({ data: { tenantId: t.id, membershipId: tc1.id, type: "casual", fromDate: new Date(Date.UTC(2026, 11, 3)), toDate: new Date(Date.UTC(2026, 11, 4)), days: 2, reason: "Sister's wedding", status: "pending" } });
  await prisma.approvalRequest.create({ data: { tenantId: t.id, entity: "leave", entityId: lv1.id, title: "Neha Singh: 2 day(s) casual leave, 03 Dec – 04 Dec", requestedById: tc1.id, levels: ["manager"] } });
  await prisma.leaveRequest.create({ data: { tenantId: t.id, membershipId: sales.id, type: "sick", fromDate: new Date(Date.UTC(2026, 10, 10)), toDate: new Date(Date.UTC(2026, 10, 10)), days: 1, status: "approved" } });
  const expDefs = [[sales, "Travel", 120000, "Ola Cabs", "Client visit — Noida site", "submitted", []], [sales, "Food", 85000, "Haldiram's", "Team lunch with Gupta Developers", "submitted", ["Above Food policy limit (₹500)"]], [tc2, "Telecom", 59900, "Jio", "Monthly mobile recharge", "approved", []], [manager, "Accommodation", 1450000, "Hotel Clarks Awadh", "Lucknow branch visit — 3 nights", "submitted", ["No receipt attached"]], [acct, "Office", 230000, "Amazon", "Printer cartridges", "reimbursed", []]] as const;
  for (const [i, [m, cat, amt, vendor, desc, status, flags]] of expDefs.entries()) {
    const e = await prisma.expense.create({ data: { tenantId: t.id, number: i + 1, membershipId: m.id, category: cat, amount: BigInt(amt), vendorName: vendor, description: desc, expenseDate: ago(int(1, 9)), status, flags: [...flags], reimbursedAt: status === "reimbursed" ? ago(1) : null } });
    if (status === "submitted") await prisma.approvalRequest.create({ data: { tenantId: t.id, entity: "expense", entityId: e.id, title: `Expense EXP-${i + 1}: ${cat} ₹${(amt / 100).toLocaleString("en-IN")} — ${m === sales ? "Amit Kumar" : "Priya Mehta"}`, amount: BigInt(amt), requestedById: m.id, levels: amt >= 1_000_000 ? ["manager", "accountant"] : ["manager"] } });
  }
  await prisma.knowledgeDoc.createMany({ data: [
    { tenantId: t.id, title: "Product catalogue & pricing rules", category: "Sales", content: "GI pipes (25mm, 50mm) are sold per 6m length. Bulk rates: 5% off above 200 pieces, 8% off above 500 pieces (needs manager approval). PVC and CPVC fittings carry 18% GST, cement 28%, TMT bars 18%.\n\nWater tanks: 1000L triple-layer tanks include free delivery within Delhi NCR. Installation is charged separately (SVC-INSTALL, ₹2,500 per visit).\n\nPrice list is revised on the 1st of every quarter. Always quote from the current product master in BizOS." },
    { tenantId: t.id, title: "Delivery & returns SOP", category: "Operations", content: "Orders confirmed before 2 PM are dispatched the same day within Delhi NCR. Outstation dispatch within 3 working days via empanelled transporters. Damaged goods must be reported within 48 hours with photos; replacements are dispatched after QC approval. Returns of unused goods within 15 days attract a 10% restocking fee.", visibleToRoles: [] },
    { tenantId: t.id, title: "Collections escalation matrix", category: "Finance", content: "Day 0 overdue: automated email. Day 3: WhatsApp reminder and sales owner call. Day 7: Accounts head call and credit hold on new orders. Day 30: Director escalation and legal notice draft. Never threaten customers; record every promise-to-pay in the timeline.", visibleToRoles: ["admin", "accountant", "sales_manager"] },
  ] });
  const visitObj = await prisma.customObject.findFirst({ where: { tenantId: t.id, key: "visit" } });
  if (visitObj) for (let i = 1; i <= 8; i++) {
    await prisma.customRecord.create({ data: { tenantId: t.id, objectId: visitObj.id, number: i, title: `${pick(LAST)} Hardware, ${pick(CITIES)[0]}`, ownerId: pick([sales, manager]).id, data: { dealer: `${pick(LAST)} Hardware`, visit_date: ago(int(0, 20)).toISOString().slice(0, 10), order_value: pick([0, 25000, 48000, 120000, 9000]), outcome: pick(["Order taken", "Follow-up", "Payment collected", "No order"]) } } });
  }
  for (const c of contacts.slice(0, 10)) await prisma.contact.update({ where: { id: c.id }, data: { custom: { credit_limit: pick([200000, 500000, 1000000]), credit_days: pick([15, 30, 45]), territory: pick(["Delhi South", "Noida", "Gurugram", "Lucknow"]) } } });
  for (const [key, value] of [["task", taskTitles.length], ["project", 3], ["expense", expDefs.length], [`PO/${fy}`, poDefs.length], ["obj:visit", 8]] as const) {
    await prisma.counter.upsert({ where: { tenantId_key: { tenantId: t.id, key } }, create: { tenantId: t.id, key, value }, update: { value } });
  }

  // ── Tenant 2: IT company (Maharashtra) — proves data isolation ──
  const t2 = await prisma.tenant.create({ data: { name: "PixelCraft Technologies", slug: "pixelcraft", businessType: "it", stateCode: "27", status: "active", plan: "business", seats: 5, currentPeriodEnd: new Date(Date.now() + 20 * 86400_000) } });
  const { adminRole: r2, branch: b2 } = await provisionTenant(prisma, t2.id, "27", "it");
  const u2 = await prisma.user.create({ data: { email: "admin@pixelcraft.demo", name: "Sameer Joshi", passwordHash } });
  const m2 = await prisma.membership.create({ data: { tenantId: t2.id, userId: u2.id, roleId: r2.id, branchId: b2.id } });
  // The Sharma admin also consults for PixelCraft → can switch companies.
  const sharmaAdminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin@sharma.demo" } });
  await prisma.membership.create({ data: { tenantId: t2.id, userId: sharmaAdminUser.id, roleId: (await prisma.role.findFirstOrThrow({ where: { tenantId: t2.id, key: "sales_manager" } })).id } });
  for (let n = 1; n <= 6; n++) await prisma.lead.create({ data: { tenantId: t2.id, number: n, name: `PixelCraft prospect ${n}`, source: "website", ownerId: m2.id, companyName: "SaaS Startup", product: "Mobile app development", city: "Pune" } });
  await prisma.counter.create({ data: { tenantId: t2.id, key: "lead", value: 6 } });

  console.log("Seeded. Sign in with admin@sharma.demo / Password@123 (see README for all demo users).");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
