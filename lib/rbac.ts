/**
 * Role-based access control with scopes (BRD §9).
 * A role grants each permission at a scope: own < team < branch < all.
 * Record-level permissions (leads, deals, calls...) use the scope to build a Prisma filter.
 */
export type Scope = "own" | "team" | "branch" | "all";
export const SCOPES: Scope[] = ["own", "team", "branch", "all"];
export type PermissionMap = Record<string, Scope>;

export const PERMISSION_GROUPS: { module: string; perms: { key: string; label: string; scoped?: boolean }[] }[] = [
  { module: "Leads", perms: [
    { key: "lead.view", label: "View leads", scoped: true },
    { key: "lead.create", label: "Create leads" },
    { key: "lead.edit", label: "Edit leads", scoped: true },
    { key: "lead.delete", label: "Delete leads" },
    { key: "lead.assign", label: "Assign / reassign" },
    { key: "lead.import", label: "Import" },
    { key: "lead.export", label: "Export" },
  ]},
  { module: "Customers", perms: [
    { key: "contact.view", label: "View customers", scoped: true },
    { key: "contact.edit", label: "Create / edit customers" },
  ]},
  { module: "Follow-ups", perms: [
    { key: "followup.view", label: "View follow-ups", scoped: true },
    { key: "followup.create", label: "Create follow-ups" },
  ]},
  { module: "Calling", perms: [
    { key: "call.make", label: "Make calls" },
    { key: "call.view", label: "View call logs & recordings", scoped: true },
    { key: "call.manage", label: "Manage DND & dialer settings" },
  ]},
  { module: "Sales", perms: [
    { key: "deal.view", label: "View deals", scoped: true },
    { key: "deal.edit", label: "Create / move deals" },
    { key: "product.view", label: "View products" },
    { key: "product.manage", label: "Manage products" },
    { key: "quotation.view", label: "View quotations", scoped: true },
    { key: "quotation.create", label: "Create quotations" },
    { key: "quotation.approve", label: "Approve discounts" },
  ]},
  { module: "Finance", perms: [
    { key: "invoice.view", label: "View invoices", scoped: true },
    { key: "invoice.create", label: "Create / issue invoices" },
    { key: "invoice.cancel", label: "Cancel invoices" },
    { key: "payment.record", label: "Record payments" },
  ]},
  { module: "Support", perms: [
    { key: "ticket.view", label: "View tickets", scoped: true },
    { key: "ticket.manage", label: "Create / update tickets" },
  ]},
  { module: "Tasks & Projects", perms: [
    { key: "task.view", label: "View tasks", scoped: true },
    { key: "task.manage", label: "Create / update tasks" },
    { key: "project.manage", label: "Create / manage projects" },
  ]},
  { module: "People (HR)", perms: [
    { key: "hr.self", label: "Own attendance, leave & expenses" },
    { key: "hr.view", label: "View team attendance & leave", scoped: true },
    { key: "expense.view", label: "View expense claims", scoped: true },
    { key: "expense.reimburse", label: "Mark expenses reimbursed" },
  ]},
  { module: "Inventory & Purchasing", perms: [
    { key: "inventory.view", label: "View stock & movements" },
    { key: "inventory.manage", label: "Adjust stock" },
    { key: "purchase.manage", label: "Vendors & purchase orders" },
  ]},
  { module: "Automation & Messaging", perms: [
    { key: "workflow.manage", label: "Build workflows & templates" },
    { key: "message.send", label: "Send email / WhatsApp / SMS" },
    { key: "kb.view", label: "Read knowledge base" },
    { key: "kb.manage", label: "Manage knowledge base" },
  ]},
  { module: "Custom objects", perms: [
    { key: "records.view", label: "View custom records", scoped: true },
    { key: "records.manage", label: "Create / edit custom records" },
  ]},
  { module: "Insights & AI", perms: [
    { key: "report.view", label: "Reports & revenue figures" },
    { key: "ai.use", label: "Use AI Copilot & insights" },
  ]},
  { module: "Administration", perms: [
    { key: "automation.manage", label: "Automations & assignment rules" },
    { key: "user.manage", label: "Users, roles, branches" },
    { key: "settings.manage", label: "Company settings" },
    { key: "billing.manage", label: "Subscription & billing" },
    { key: "audit.view", label: "Audit log" },
    { key: "api.manage", label: "API keys & webhooks" },
    { key: "security.manage", label: "Security center & policies" },
    { key: "data.unmask", label: "See full phone numbers (no masking)" },
    { key: "data.export_all", label: "Export all company data" },
  ]},
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.key));

function grant(scope: Scope, keys: string[]): PermissionMap {
  return Object.fromEntries(keys.map((k) => [k, scope]));
}

/** System roles seeded into every new tenant (editable copies per tenant). */
export const DEFAULT_ROLES: { key: string; name: string; maxDiscount: number; permissions: PermissionMap }[] = [
  { key: "admin", name: "Company Admin", maxDiscount: 100, permissions: grant("all", ALL_PERMISSIONS) },
  {
    key: "branch_admin", name: "Branch Admin", maxDiscount: 25,
    permissions: grant("branch", ALL_PERMISSIONS.filter((k) => !["billing.manage", "settings.manage", "api.manage", "security.manage", "data.export_all"].includes(k))),
  },
  {
    key: "sales_manager", name: "Sales Manager", maxDiscount: 20,
    permissions: grant("team", [
      "lead.view", "lead.create", "lead.edit", "lead.assign", "lead.import", "lead.export", "contact.view", "contact.edit",
      "followup.view", "followup.create", "call.make", "call.view", "deal.view", "deal.edit", "product.view",
      "quotation.view", "quotation.create", "quotation.approve", "invoice.view", "report.view", "ai.use", "ticket.view",
      "task.view", "task.manage", "project.manage", "hr.self", "hr.view", "expense.view", "inventory.view", "message.send", "kb.view",
      "records.view", "records.manage", "workflow.manage", "data.unmask",
    ]),
  },
  {
    key: "sales_exec", name: "Sales Executive", maxDiscount: 10,
    permissions: grant("own", [
      "lead.view", "lead.create", "lead.edit", "contact.view", "contact.edit", "followup.view", "followup.create",
      "call.make", "call.view", "deal.view", "deal.edit", "product.view", "quotation.view", "quotation.create", "invoice.view", "ai.use",
      "task.view", "task.manage", "hr.self", "expense.view", "inventory.view", "message.send", "kb.view", "records.view", "records.manage",
    ]),
  },
  {
    key: "telecaller", name: "Telecaller", maxDiscount: 0,
    permissions: grant("own", ["lead.view", "lead.create", "lead.edit", "followup.view", "followup.create", "call.make", "call.view", "product.view", "task.view", "task.manage", "hr.self", "expense.view", "message.send", "kb.view", "ai.use"]),
  },
  {
    key: "accountant", name: "Accountant", maxDiscount: 0,
    permissions: grant("all", ["contact.view", "contact.edit", "product.view", "quotation.view", "invoice.view", "invoice.create", "invoice.cancel", "payment.record", "report.view", "deal.view",
      "hr.self", "expense.view", "expense.reimburse", "inventory.view", "inventory.manage", "purchase.manage", "task.view", "task.manage", "message.send", "kb.view", "ai.use", "data.unmask"]),
  },
  {
    key: "support", name: "Support Agent", maxDiscount: 0,
    permissions: grant("own", ["contact.view", "ticket.view", "ticket.manage", "followup.view", "followup.create", "call.make", "call.view", "task.view", "task.manage", "hr.self", "expense.view", "message.send", "kb.view", "ai.use"]),
  },
];
