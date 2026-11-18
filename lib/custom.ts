import type { CustomFieldDef } from "@prisma/client";

/** Custom fields (BRD §64): parse form input into the record's `custom` JSON with type validation. */
export function parseCustom(defs: CustomFieldDef[], fd: FormData, existing: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { ...existing };
  for (const d of defs) {
    const name = `cf_${d.key}`;
    if (d.type === "multiselect") { out[d.key] = fd.getAll(name).map(String).filter((v) => d.options.includes(v)); continue; }
    if (d.type === "boolean") { out[d.key] = fd.get(name) === "on"; continue; }
    const raw = String(fd.get(name) ?? "").trim();
    if (!raw) { if (d.required) throw new Error(`${d.label} is required`); delete out[d.key]; continue; }
    switch (d.type) {
      case "number": { const n = Number(raw); if (Number.isNaN(n)) throw new Error(`${d.label} must be a number`); out[d.key] = n; break; }
      case "date": if (isNaN(new Date(raw).getTime())) throw new Error(`${d.label} must be a date`); out[d.key] = raw; break;
      case "select": if (!d.options.includes(raw)) throw new Error(`${d.label}: invalid option`); out[d.key] = raw; break;
      case "email": if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new Error(`${d.label} must be an email`); out[d.key] = raw; break;
      case "url": if (!/^https?:\/\//.test(raw)) throw new Error(`${d.label} must start with http(s)://`); out[d.key] = raw; break;
      default: out[d.key] = raw.slice(0, 5000);
    }
  }
  return out;
}

export function displayCustom(d: Pick<CustomFieldDef, "type">, v: unknown) {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (d.type === "boolean") return v ? "Yes" : "No";
  if (d.type === "date") return new Date(String(v)).toLocaleDateString("en-IN");
  if (d.type === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}

export const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "boolean", "phone", "email", "url"] as const;
export const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
