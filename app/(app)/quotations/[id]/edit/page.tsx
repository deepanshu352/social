import { notFound } from "next/navigation";
import { guard, scopeWhere } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocEditor } from "@/components/DocEditor";
import { editorOptions, isoDate, itemsToLines } from "@/lib/doc-options";
import { updateQuotationAction } from "../../actions";

export default async function EditQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("quotation.create", "quotations");
  const q = await ctx.db.quotation.findFirst({ where: { id, ...(await scopeWhere(ctx, "quotation.view")) }, include: { items: { orderBy: { sort: "asc" } } } });
  if (!q) notFound();
  const opts = await editorOptions(ctx);
  return (
    <>
      <PageHeader title={`Edit ${q.number}`} back={{ href: `/quotations/${id}`, label: q.number }} />
      <DocEditor kind="quotation" {...opts} sellerState={ctx.tenant.stateCode} maxDiscount={ctx.perms["quotation.approve"] ? undefined : ctx.membership.role.maxDiscount}
        initial={{ contactId: q.contactId, dealId: q.dealId, placeOfSupply: q.placeOfSupply, items: itemsToLines(q.items), date2: isoDate(q.validUntil), terms: q.terms ?? "", notes: q.notes ?? "" }}
        action={updateQuotationAction.bind(null, id)} submitLabel="Save changes" />
    </>
  );
}
