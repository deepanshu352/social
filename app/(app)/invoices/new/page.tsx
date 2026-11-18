import { guard } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocEditor } from "@/components/DocEditor";
import { editorOptions, isoDate } from "@/lib/doc-options";
import { createInvoiceAction } from "../actions";

export const metadata = { title: "New invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ contactId?: string }> }) {
  const ctx = await guard("invoice.create", "invoices");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="New invoice" back={{ href: "/invoices", label: "Invoices" }} subtitle="Saved as a draft. The GST invoice number is assigned when you issue it." />
      <DocEditor kind="invoice" {...await editorOptions(ctx)} sellerState={ctx.tenant.stateCode}
        initial={{ contactId: sp.contactId, items: [], date2: isoDate(new Date(Date.now() + 15 * 86400_000)), terms: ctx.tenant.invoiceTerms ?? "" }}
        action={createInvoiceAction} submitLabel="Save draft" />
    </>
  );
}
