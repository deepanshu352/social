import { requireCtx, has } from "@/lib/auth";
import { NavLink } from "@/components/client";

const ITEMS = [
  { href: "/settings", label: "Company", perm: "settings.manage", exact: true },
  { href: "/settings/users", label: "Users", perm: "user.manage" },
  { href: "/settings/roles", label: "Roles & permissions", perm: "user.manage" },
  { href: "/settings/branches", label: "Branches & teams", perm: "user.manage" },
  { href: "/settings/assignment", label: "Lead assignment", perm: "automation.manage" },
  { href: "/settings/fields", label: "Custom fields", perm: "settings.manage" },
  { href: "/settings/objects", label: "Objects & industry packs", perm: "settings.manage" },
  { href: "/security", label: "Security center", perm: "security.manage" },
  { href: "/settings/calling", label: "Calling & DND", perm: "call.manage" },
  { href: "/settings/api", label: "API & webhooks", perm: "api.manage" },
  { href: "/settings/audit", label: "Audit log", perm: "audit.view" },
  { href: "/settings/billing", label: "Plan & billing", perm: "billing.manage" },
  { href: "/settings/security", label: "My security", perm: null },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <nav className="no-print space-y-0.5">
        <div className="mb-2 px-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Settings</div>
        {ITEMS.filter((i) => !i.perm || has(ctx, i.perm)).map((i) => <NavLink key={i.href} href={i.href} exact={i.exact}>{i.label}</NavLink>)}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
