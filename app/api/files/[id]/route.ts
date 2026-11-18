import { getCtx, has } from "@/lib/auth";
import { canDecide } from "@/lib/approvals";

/** Serves tenant files. Receipts are visible to the uploader and to people who can review expenses. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const f = await ctx.db.fileBlob.findFirst({ where: { id } });
  if (!f) return new Response("Not found", { status: 404 });
  const own = f.uploadedById === ctx.membership.id;
  const reviewer = ctx.perms["expense.view"] && ctx.perms["expense.view"] !== "own" || has(ctx, "expense.reimburse") || ctx.membership.role.key === "admin";
  let approver = false;
  if (!own && !reviewer) {
    const exp = await ctx.db.expense.findFirst({ where: { receiptId: f.id } });
    const req = exp ? await ctx.db.approvalRequest.findFirst({ where: { entity: "expense", entityId: exp.id } }) : null;
    approver = !!req && ((req.history as { byId?: string }[]).some((h) => h.byId === ctx.membership.id) || (await canDecide(ctx, req)));
  }
  if (!own && !reviewer && !approver) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime, "content-disposition": `inline; filename="${f.name}"`, "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", "cache-control": "private, max-age=300",
    },
  });
}
