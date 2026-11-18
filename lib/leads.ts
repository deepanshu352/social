import type { Ctx } from "./auth";
import { nextNumber } from "./db";
import { autoAssignLead } from "./assignment";
import { rescoreLead } from "./scoring";
import { emit } from "./events";
import { audit } from "./audit";
import { normalizePhone } from "./utils";
import { rupeesToPaise } from "./money";
import { prisma } from "./prisma";
import type { LeadSource, Priority } from "@prisma/client";

export type LeadInput = {
  name: string; phone?: string | null; email?: string | null; companyName?: string | null; source?: string | null;
  campaign?: string | null; product?: string | null; city?: string | null; state?: string | null; language?: string | null;
  budget?: string | number | null; priority?: string | null; notes?: string | null; ownerId?: string | null; tags?: string[]; custom?: Record<string, unknown>;
};

const SOURCES: LeadSource[] = ["website", "google_ads", "facebook", "instagram", "whatsapp", "referral", "manual", "import", "api", "campaign", "phone", "landing_page"];

/**
 * Single entry point for lead creation (UI, CSV import, public API, web forms) so every lead
 * gets the same numbering, dedupe check, auto-assignment, scoring, automations and audit.
 */
export async function createLead(
  tenantId: string,
  input: LeadInput,
  actor: { membershipId?: string | null; name: string; type?: "user" | "api_key" | "system"; branchId?: string | null; ctx?: Ctx },
) {
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const dup = phone || email
    ? await prisma.lead.findFirst({ where: { tenantId, deletedAt: null, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] }, select: { id: true, number: true } })
    : null;

  const number = await nextNumber(tenantId, "lead");
  const source = (SOURCES.includes(input.source as LeadSource) ? input.source : "manual") as LeadSource;
  const lead = await prisma.lead.create({
    data: {
      tenantId, number, name: input.name.trim(), phone, email, companyName: input.companyName || null, source,
      campaign: input.campaign || null, product: input.product || null, city: input.city || null, state: input.state || null,
      language: input.language || null, budget: input.budget ? rupeesToPaise(input.budget) : null,
      priority: (["low", "medium", "high", "urgent"].includes(String(input.priority)) ? input.priority : "medium") as Priority,
      notes: input.notes || null, ownerId: input.ownerId || null, assignedAt: input.ownerId ? new Date() : null,
      tags: input.tags ?? [], custom: (input.custom ?? {}) as object, branchId: actor.branchId ?? null, createdById: actor.membershipId ?? null, lastActivityAt: new Date(),
    },
  });
  await prisma.activity.create({
    data: { tenantId, leadId: lead.id, type: "system", body: `Lead created by ${actor.name} (source: ${source.replace("_", " ")})`, actorId: actor.membershipId ?? null },
  });
  if (dup) {
    await prisma.activity.create({ data: { tenantId, leadId: lead.id, type: "system", body: `Possible duplicate of LD-${dup.number}`, meta: { duplicateOf: dup.id } } });
  }
  let ownerId = lead.ownerId;
  if (!ownerId) ownerId = await autoAssignLead(tenantId, lead.id);
  if (!ownerId && actor.membershipId) {
    ownerId = actor.membershipId;
    await prisma.lead.update({ where: { id: lead.id }, data: { ownerId, assignedAt: new Date() } });
  }
  await rescoreLead(tenantId, lead.id);
  await emit(tenantId, "lead.created", { id: lead.id, leadId: lead.id, number, name: lead.name, source, city: lead.city, ownerId, phone, email, product: lead.product, campaign: lead.campaign });
  await audit({ tenantId, actorName: actor.name, actorType: actor.type ?? "user", actorId: actor.membershipId ?? undefined }, "lead.create", "Lead", lead.id, null, { number, name: lead.name, source });
  return { ...lead, ownerId, duplicateOf: dup };
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}
