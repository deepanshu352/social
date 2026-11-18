import type { Contact, CustomFieldDef } from "@prisma/client";
import { CustomFieldInputs } from "@/components/CustomFields";
import { Field } from "@/components/ui";
import { STATES } from "@/lib/india";

export function ContactFields({ c, defaultState, defs = [], canUnmask = true }: { c?: Contact | null; defaultState: string; defs?: CustomFieldDef[]; canUnmask?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Name *"><input name="name" required defaultValue={c?.name} className="input" /></Field>
      <Field label="Company"><input name="companyName" defaultValue={c?.companyName ?? ""} className="input" /></Field>
      {canUnmask ? <Field label="Mobile"><input name="phone" defaultValue={c?.phone ?? ""} className="input" /></Field> : <Field label="Mobile" hint="Masked for your role"><input disabled value="••••••" className="input" /></Field>}
      <Field label="Email"><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></Field>
      <Field label="GSTIN" hint="15 characters; first 2 digits set the state"><input name="gstin" defaultValue={c?.gstin ?? ""} className="input uppercase" maxLength={15} /></Field>
      <Field label="State (place of supply)"><select name="stateCode" defaultValue={c?.stateCode ?? defaultState} className="input">{Object.entries(STATES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
      <Field label="Billing address" className="md:col-span-2"><textarea name="address" rows={2} defaultValue={c?.address ?? ""} className="input" /></Field>
      <Field label="Tags"><input name="tags" defaultValue={c?.tags.join(", ")} className="input" /></Field>
      <CustomFieldInputs defs={defs} values={(c?.custom ?? {}) as Record<string, unknown>} />
    </div>
  );
}
