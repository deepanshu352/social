import { notFound, redirect } from "next/navigation";
import { guard } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocEditor } from "@/components/DocEditor";
import { editorOptions, isoDate, itemsToLines } from "@/lib/doc-options";
import { updateInvoiceAction } from "../../actions";

export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("invoice.create", "invoices");
  const inv = await ctx.db.invoice.findFirst({ where: { id }, include: { items: { orderBy: { sort: "asc" } } } });
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/invoices/${id}`);
  return (
    <>
      <PageHeader title="Edit draft invoice" back={{ href: `/invoices/${id}`, label: "Invoice" }} />
      <DocEditor kind="invoice" {...await editorOptions(ctx)} sellerState={ctx.tenant.stateCode}
        initial={{ contactId: inv.contactId, placeOfSupply: inv.placeOfSupply, items: itemsToLines(inv.items), date2: isoDate(inv.dueDate), terms: inv.terms ?? "", notes: inv.notes ?? "" }}
        action={updateInvoiceAction.bind(null, id)} submitLabel="Save draft" />
    </>
  );
}
