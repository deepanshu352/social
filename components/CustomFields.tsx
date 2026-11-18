import type { CustomFieldDef } from "@prisma/client";
import { displayCustom } from "@/lib/custom";

/** Renders inputs for custom fields (names: cf_<key>). */
export function CustomFieldInputs({ defs, values = {} }: { defs: CustomFieldDef[]; values?: Record<string, unknown> }) {
  if (!defs.length) return null;
  return (
    <>
      {defs.map((d) => {
        const v = values[d.key];
        const name = `cf_${d.key}`;
        let input: React.ReactNode;
        switch (d.type) {
          case "textarea": input = <textarea name={name} defaultValue={String(v ?? "")} rows={2} required={d.required} className="input" />; break;
          case "number": input = <input name={name} type="number" step="any" defaultValue={v == null ? "" : String(v)} required={d.required} className="input" />; break;
          case "date": input = <input name={name} type="date" defaultValue={v ? String(v).slice(0, 10) : ""} required={d.required} className="input" />; break;
          case "select": input = <select name={name} defaultValue={String(v ?? "")} required={d.required} className="input"><option value="">—</option>{d.options.map((o) => <option key={o}>{o}</option>)}</select>; break;
          case "multiselect": input = <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2">{d.options.map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={o} defaultChecked={Array.isArray(v) && v.includes(o)} />{o}</label>)}</div>; break;
          case "boolean": input = <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" name={name} defaultChecked={!!v} /> Yes</label>; break;
          default: input = <input name={name} type={d.type === "email" ? "email" : d.type === "url" ? "url" : d.type === "phone" ? "tel" : "text"} defaultValue={String(v ?? "")} required={d.required} className="input" />;
        }
        return <label key={d.id} className={d.type === "textarea" || d.type === "multiselect" ? "block md:col-span-2" : "block"}><span className="label">{d.label}{d.required ? " *" : ""}</span>{input}</label>;
      })}
    </>
  );
}

export function CustomFieldList({ defs, values = {} }: { defs: CustomFieldDef[]; values?: Record<string, unknown> }) {
  if (!defs.length) return null;
  return (
    <>{defs.map((d) => <div key={d.id} className="contents"><dt className="text-muted">{d.label}</dt><dd className="break-words">{displayCustom(d, values[d.key])}</dd></div>)}</>
  );
}
