import { v1, page, listResponse } from "@/lib/api-v1";

export const GET = v1(async ({ req, db }) => {
  const { limit, cursor } = page(req);
  const rows = await db.deal.findMany({ orderBy: { id: "asc" }, take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { stage: { select: { name: true, type: true } } } });
  return listResponse(rows, limit);
});
