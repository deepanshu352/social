import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Industry packs (BRD §3–4, §65): one click turns the generic platform into an industry tool by
 * adding custom objects, custom fields and starter knowledge. Packs are additive and idempotent.
 */
type F = { key: string; label: string; type: string; options?: string[]; required?: boolean; showInList?: boolean };
export type Pack = {
  key: string; name: string; description: string; businessTypes: string[];
  objects: { key: string; name: string; plural: string; icon: string; description: string; fields: F[] }[];
  fields: Partial<Record<"lead" | "contact" | "deal" | "ticket" | "task", F[]>>;
};

export const PACKS: Pack[] = [
  {
    key: "transport", name: "Transport & logistics", businessTypes: ["transport"], description: "Vehicles with document-expiry tracking, trips with freight and POD status.",
    objects: [
      { key: "vehicle", name: "Vehicle", plural: "Vehicles", icon: "truck", description: "Fleet register with compliance dates", fields: [
        { key: "type", label: "Vehicle type", type: "select", options: ["Truck", "Tempo", "Pickup", "Trailer", "Container"], showInList: true },
        { key: "capacity_tons", label: "Capacity (tons)", type: "number", showInList: true },
        { key: "driver_name", label: "Driver", type: "text", showInList: true },
        { key: "driver_phone", label: "Driver phone", type: "phone" },
        { key: "insurance_expiry", label: "Insurance expiry", type: "date", showInList: true },
        { key: "puc_expiry", label: "PUC expiry", type: "date" },
        { key: "permit_expiry", label: "Permit expiry", type: "date" },
        { key: "fitness_expiry", label: "Fitness expiry", type: "date" },
      ]},
      { key: "trip", name: "Trip", plural: "Trips", icon: "route", description: "Bookings from source to destination", fields: [
        { key: "source", label: "From", type: "text", required: true, showInList: true },
        { key: "destination", label: "To", type: "text", required: true, showInList: true },
        { key: "vehicle_no", label: "Vehicle no.", type: "text", showInList: true },
        { key: "weight_tons", label: "Weight (tons)", type: "number" },
        { key: "freight_inr", label: "Freight (₹)", type: "number", showInList: true },
        { key: "status", label: "Status", type: "select", options: ["Planned", "Loading", "In transit", "Delivered", "POD received"], showInList: true },
        { key: "pickup_date", label: "Pickup date", type: "date" },
        { key: "pod_received", label: "POD received", type: "boolean" },
      ]},
    ],
    fields: { lead: [{ key: "route", label: "Route", type: "text", showInList: true }, { key: "load_type", label: "Load type", type: "select", options: ["FTL", "PTL", "Container", "Parcel"] }] },
  },
  {
    key: "trading", name: "Distribution & trading", businessTypes: ["distributor", "manufacturer", "retail", "ecommerce"], description: "Dealer credit limits, territories and field visit logs.",
    objects: [{ key: "visit", name: "Dealer visit", plural: "Dealer visits", icon: "map-pin", description: "Field sales visits", fields: [
      { key: "dealer", label: "Dealer / shop", type: "text", required: true, showInList: true },
      { key: "visit_date", label: "Visit date", type: "date", showInList: true },
      { key: "order_value", label: "Order value (₹)", type: "number", showInList: true },
      { key: "outcome", label: "Outcome", type: "select", options: ["Order taken", "Follow-up", "Payment collected", "No order"], showInList: true },
      { key: "notes", label: "Notes", type: "textarea" },
    ]}],
    fields: {
      contact: [{ key: "credit_limit", label: "Credit limit (₹)", type: "number", showInList: true }, { key: "credit_days", label: "Credit days", type: "number" }, { key: "territory", label: "Territory", type: "text", showInList: true }],
      lead: [{ key: "monthly_volume", label: "Expected monthly volume", type: "text" }],
    },
  },
  {
    key: "it_services", name: "IT & agencies", businessTypes: ["it", "agency"], description: "Tech requirements on leads, AMC / support contracts with renewal dates.",
    objects: [{ key: "contract", name: "Support contract", plural: "Support contracts", icon: "file-signature", description: "AMC / retainer contracts", fields: [
      { key: "plan", label: "Plan", type: "select", options: ["Basic", "Standard", "Premium"], showInList: true },
      { key: "monthly_fee", label: "Monthly fee (₹)", type: "number", showInList: true },
      { key: "start_date", label: "Start date", type: "date" },
      { key: "renewal_date", label: "Renewal date", type: "date", showInList: true },
      { key: "sla_hours", label: "SLA (hours)", type: "number" },
    ]}],
    fields: { lead: [{ key: "project_type", label: "Project type", type: "select", options: ["Website", "Mobile app", "ERP / CRM", "Marketing", "Cloud / DevOps", "Other"], showInList: true }, { key: "tech_stack", label: "Tech stack", type: "multiselect", options: ["React", "Next.js", "Node", "Python", "Flutter", "Java", "PHP", "AWS"] }, { key: "timeline_weeks", label: "Timeline (weeks)", type: "number" }] },
  },
  {
    key: "field_service", name: "Service & maintenance", businessTypes: ["service"], description: "Installed equipment with warranty tracking; service type on leads and tickets.",
    objects: [{ key: "asset", name: "Installed asset", plural: "Installed assets", icon: "wrench", description: "Equipment at customer sites", fields: [
      { key: "model", label: "Model", type: "text", required: true, showInList: true },
      { key: "serial_no", label: "Serial no.", type: "text", showInList: true },
      { key: "installed_on", label: "Installed on", type: "date" },
      { key: "warranty_till", label: "Warranty till", type: "date", showInList: true },
      { key: "site_address", label: "Site address", type: "textarea" },
      { key: "next_service", label: "Next service due", type: "date", showInList: true },
    ]}],
    fields: { ticket: [{ key: "service_type", label: "Service type", type: "select", options: ["Installation", "Repair", "Preventive maintenance", "Inspection"] }, { key: "visit_date", label: "Technician visit", type: "date" }], lead: [{ key: "service_type", label: "Service needed", type: "select", options: ["Installation", "Repair", "AMC", "Consultation"] }] },
  },
  {
    key: "telecalling", name: "Telecalling / BPO", businessTypes: ["telecalling"], description: "Campaign batches, call language and interest levels on leads.",
    objects: [],
    fields: { lead: [{ key: "batch", label: "Data batch", type: "text", showInList: true }, { key: "call_language", label: "Call language", type: "select", options: ["Hindi", "English", "Tamil", "Telugu", "Marathi", "Bengali", "Gujarati", "Kannada"] }, { key: "interest_level", label: "Interest level", type: "select", options: ["Very interested", "Interested", "Neutral", "Not interested"], showInList: true }] },
  },
  {
    key: "real_estate", name: "Real estate", businessTypes: [], description: "Property inventory and site visits.",
    objects: [
      { key: "property", name: "Property", plural: "Properties", icon: "building", description: "Units and listings", fields: [
        { key: "project", label: "Project", type: "text", showInList: true }, { key: "unit_type", label: "Configuration", type: "select", options: ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "Plot", "Shop", "Office"], showInList: true },
        { key: "area_sqft", label: "Area (sq ft)", type: "number" }, { key: "price_inr", label: "Price (₹)", type: "number", showInList: true },
        { key: "status", label: "Status", type: "select", options: ["Available", "On hold", "Booked", "Sold"], showInList: true }, { key: "location", label: "Location", type: "text" },
      ]},
      { key: "site_visit", name: "Site visit", plural: "Site visits", icon: "calendar", description: "Scheduled property visits", fields: [
        { key: "property", label: "Property / project", type: "text", required: true, showInList: true }, { key: "visit_at", label: "Visit date", type: "date", showInList: true },
        { key: "outcome", label: "Outcome", type: "select", options: ["Scheduled", "Visited", "Interested", "Booked", "Not interested", "No show"], showInList: true },
      ]},
    ],
    fields: { lead: [{ key: "budget_range", label: "Budget range", type: "select", options: ["< 50 L", "50 L – 1 Cr", "1 – 2 Cr", "2 Cr +"], showInList: true }, { key: "preferred_location", label: "Preferred location", type: "text" }] },
  },
  {
    key: "healthcare", name: "Clinics & healthcare", businessTypes: [], description: "Patients and appointments (no clinical records — scheduling & billing only).",
    objects: [
      { key: "patient", name: "Patient", plural: "Patients", icon: "heart", description: "Patient register", fields: [
        { key: "age", label: "Age", type: "number", showInList: true }, { key: "gender", label: "Gender", type: "select", options: ["Female", "Male", "Other"], showInList: true },
        { key: "phone", label: "Phone", type: "phone", showInList: true }, { key: "consent", label: "Consent to contact", type: "boolean" },
      ]},
      { key: "appointment", name: "Appointment", plural: "Appointments", icon: "calendar", description: "Bookings", fields: [
        { key: "patient", label: "Patient", type: "text", required: true, showInList: true }, { key: "doctor", label: "Doctor", type: "text", showInList: true },
        { key: "date", label: "Date", type: "date", showInList: true }, { key: "status", label: "Status", type: "select", options: ["Booked", "Checked in", "Completed", "Cancelled", "No show"], showInList: true },
      ]},
    ],
    fields: {},
  },
  {
    key: "education", name: "Education & coaching", businessTypes: [], description: "Students, courses and admissions.",
    objects: [{ key: "student", name: "Student", plural: "Students", icon: "graduation-cap", description: "Enrolled students", fields: [
      { key: "course", label: "Course", type: "text", required: true, showInList: true }, { key: "batch", label: "Batch", type: "text", showInList: true },
      { key: "guardian_phone", label: "Guardian phone", type: "phone" }, { key: "fee_total", label: "Total fee (₹)", type: "number", showInList: true },
      { key: "admission_date", label: "Admission date", type: "date" }, { key: "status", label: "Status", type: "select", options: ["Enquiry", "Admitted", "Active", "Completed", "Dropped"], showInList: true },
    ]}],
    fields: { lead: [{ key: "course_interest", label: "Course interested in", type: "text", showInList: true }, { key: "qualification", label: "Current qualification", type: "text" }] },
  },
];

type Tx = Prisma.TransactionClient | PrismaClient;

export async function applyPack(tx: Tx, tenantId: string, packKey: string) {
  const pack = PACKS.find((p) => p.key === packKey);
  if (!pack) throw new Error("Unknown industry pack");
  for (const o of pack.objects) {
    await tx.customObject.upsert({ where: { tenantId_key: { tenantId, key: o.key } }, create: { tenantId, key: o.key, name: o.name, pluralName: o.plural, icon: o.icon, description: o.description }, update: {} });
    for (const [i, f] of o.fields.entries()) await upsertField(tx, tenantId, `obj:${o.key}`, f, i);
  }
  for (const [entity, fields] of Object.entries(pack.fields)) for (const [i, f] of (fields ?? []).entries()) await upsertField(tx, tenantId, entity, f, i);
  return pack;
}

async function upsertField(tx: Tx, tenantId: string, entity: string, f: F, order: number) {
  await tx.customFieldDef.upsert({
    where: { tenantId_entity_key: { tenantId, entity, key: f.key } },
    create: { tenantId, entity, key: f.key, label: f.label, type: f.type, options: f.options ?? [], required: f.required ?? false, showInList: f.showInList ?? false, order },
    update: {},
  });
}

export const packForBusiness = (type: string) => PACKS.find((p) => p.businessTypes.includes(type))?.key ?? null;
