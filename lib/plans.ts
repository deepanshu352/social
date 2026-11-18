/** SaaS plans & module entitlements (BRD §81–83). Prices in paise per user / month. */
export type ModuleKey =
  | "crm" | "sales" | "quotations" | "invoices" | "reports" | "calling" | "dialer"
  | "automation" | "support" | "ai" | "api" | "workflows" | "projects" | "hr" | "inventory" | "custom" | "security_plus";

export type Plan = {
  key: string; name: string; pricePerUser: number; tagline: string;
  modules: ModuleKey[]; limits: { users: number; callMinutes: number; aiRequests: number };
};

export const PLANS: Plan[] = [
  { key: "starter", name: "Starter", pricePerUser: 49900, tagline: "CRM, leads & basic sales",
    modules: ["crm", "sales", "quotations", "invoices", "reports", "projects", "hr"],
    limits: { users: 5, callMinutes: 0, aiRequests: 0 } },
  { key: "business", name: "Business", pricePerUser: 99900, tagline: "Calling, dialer & automation",
    modules: ["crm", "sales", "quotations", "invoices", "reports", "calling", "dialer", "automation", "support", "workflows", "projects", "hr", "inventory", "custom"],
    limits: { users: 25, callMinutes: 5000, aiRequests: 0 } },
  { key: "professional", name: "Professional", pricePerUser: 179900, tagline: "AI Copilot, API & advanced analytics",
    modules: ["crm", "sales", "quotations", "invoices", "reports", "calling", "dialer", "automation", "support", "ai", "api", "workflows", "projects", "hr", "inventory", "custom", "security_plus"],
    limits: { users: 100, callMinutes: 20000, aiRequests: 5000 } },
  { key: "enterprise", name: "Enterprise", pricePerUser: 0, tagline: "SSO, custom limits, dedicated support",
    modules: ["crm", "sales", "quotations", "invoices", "reports", "calling", "dialer", "automation", "support", "ai", "api", "workflows", "projects", "hr", "inventory", "custom", "security_plus"],
    limits: { users: 10000, callMinutes: 1_000_000, aiRequests: 1_000_000 } },
];

export const planByKey = (k: string) => PLANS.find((p) => p.key === k) ?? PLANS[0];

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

/** Which modules each business type turns on first (BRD §4) — drives onboarding defaults & nav order. */
export const BUSINESS_TYPES: { key: string; label: string; focus: string }[] = [
  { key: "it", label: "IT Company", focus: "Leads → Deals → Quotations → Invoices" },
  { key: "telecalling", label: "Telecalling / BPO", focus: "Lead queues, power dialer, dispositions" },
  { key: "distributor", label: "Distributor / Wholesale", focus: "Products, quotations, invoices, receivables" },
  { key: "manufacturer", label: "Manufacturer", focus: "Products, quotations, invoices" },
  { key: "service", label: "Service Business", focus: "Leads, support tickets, invoices" },
  { key: "transport", label: "Transport & Logistics", focus: "Customers, bookings, invoices" },
  { key: "retail", label: "Retail", focus: "Customers, products, invoices" },
  { key: "ecommerce", label: "E-commerce", focus: "Leads, support, invoices" },
  { key: "agency", label: "Agency", focus: "Leads, deals, quotations" },
  { key: "other", label: "Other", focus: "Everything" },
];
