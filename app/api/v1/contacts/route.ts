import { v1, page, listResponse } from "@/lib/api-v1";

export const GET = v1(async ({ req, db }) => {
  const { limit, cursor } = page(req);
  const rows = await db.contact.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" }, take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, name: true, companyName: true, phone: true, email: true, gstin: true, stateCode: true, createdAt: true } });
  return listResponse(rows, limit);
});
