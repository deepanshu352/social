import { guard } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ContactFields } from "../ContactFields";
import { createContactAction } from "../actions";

export default async function NewContact() {
  const ctx = await guard("contact.edit", "crm");
  return (
    <>
      <PageHeader title="New customer" back={{ href: "/contacts", label: "Customers" }} />
      <form action={createContactAction} className="max-w-3xl"><Card><ContactFields defaultState={ctx.tenant.stateCode} defs={await ctx.db.customFieldDef.findMany({ where: { entity: "contact" }, orderBy: { order: "asc" } })} /><div className="mt-5 flex justify-end"><SubmitButton>Create customer</SubmitButton></div></Card></form>
    </>
  );
}
