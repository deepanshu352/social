import { guard } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocEditor } from "@/components/DocEditor";
import { editorOptions, isoDate } from "@/lib/doc-options";
import { createQuotationAction } from "../actions";

export const metadata = { title: "New quotation" };

export default async function NewQuotation({ searchParams }: { searchParams: Promise<{ contactId?: string; dealId?: string }> }) {
  const ctx = await guard("quotation.create", "quotations");
  const sp = await searchParams;
  const opts = await editorOptions(ctx);
  return (
    <>
      <PageHeader title="New quotation" back={{ href: "/quotations", label: "Quotations" }} subtitle={`Your discount limit: ${ctx.membership.role.maxDiscount}% — above that needs approval.`} />
      <DocEditor kind="quotation" {...opts} sellerState={ctx.tenant.stateCode} maxDiscount={ctx.perms["quotation.approve"] ? undefined : ctx.membership.role.maxDiscount}
        initial={{ contactId: sp.contactId, dealId: sp.dealId, items: [], date2: isoDate(new Date(Date.now() + 15 * 86400_000)), terms: "Prices valid for 15 days. Delivery within 7 working days of PO. 50% advance, balance on delivery." }}
        action={createQuotationAction} submitLabel="Save quotation" />
    </>
  );
}
