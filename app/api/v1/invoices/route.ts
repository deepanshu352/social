import { v1, page, listResponse } from "@/lib/api-v1";

export const GET = v1(async ({ req, db }) => {
  const { limit, cursor, sp } = page(req);
  const status = sp.get("status");
  const where = status === "overdue"
    ? { status: { in: ["issued", "partially_paid", "overdue"] as any }, dueDate: { lt: new Date() } }
    : status ? { status: status as any } : {};
  const rows = await db.invoice.findMany({ where, orderBy: { id: "asc" }, take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, number: true, contactId: true, status: true, issueDate: true, dueDate: true, total: true, amountPaid: true, balance: true } });
  return listResponse(rows, limit);
});
