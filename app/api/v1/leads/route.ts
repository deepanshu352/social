import { v1, page, listResponse } from "@/lib/api-v1";
import { createLead } from "@/lib/leads";
import { json, jsonError } from "@/lib/api";

export const GET = v1(async ({ req, db }) => {
  const { limit, cursor, sp } = page(req);
  const rows = await db.lead.findMany({
    where: { deletedAt: null, ...(sp.get("status") ? { status: sp.get("status") as any } : {}), ...(sp.get("source") ? { source: sp.get("source") as any } : {}) },
    orderBy: { id: "asc" }, take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, number: true, name: true, companyName: true, phone: true, email: true, source: true, status: true, score: true, scoreBand: true, city: true, ownerId: true, createdAt: true },
  });
  return listResponse(rows, limit);
});

export const POST = v1(async ({ req, tenantId, keyName }) => {
  const b = await req.json().catch(() => null);
  if (!b?.name || typeof b.name !== "string") return jsonError("VALIDATION", "name is required", 422);
  const lead = await createLead(tenantId, { ...b, source: b.source ?? "api", tags: Array.isArray(b.tags) ? b.tags : [] }, { name: `API key: ${keyName}`, type: "api_key" });
  return json({ data: { id: lead.id, number: lead.number, ownerId: lead.ownerId, duplicateOf: lead.duplicateOf?.id ?? null } }, 201);
});
