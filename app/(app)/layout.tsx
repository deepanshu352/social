import Link from "next/link";
import { Suspense } from "react";
import { Flash } from "@/components/Flash";
import {
  LayoutDashboard, Sparkles, Users, Contact, CalendarClock, KanbanSquare, PhoneCall, PhoneOutgoing, Package,
  FileText, Receipt, LifeBuoy, BarChart3, Workflow, Settings, Bell, Search, LogOut, Shield, CheckSquare, FolderKanban,
  ClipboardCheck, Clock, Plane, Wallet, Boxes, ShoppingCart, BookOpen, ShieldCheck, Database, MessageSquare,
} from "lucide-react";
import { requireCtx, has, hasModule, type Ctx } from "@/lib/auth";
import type { ModuleKey } from "@/lib/plans";
import { NavLink } from "@/components/client";
import { QuickCapture } from "@/components/QuickCapture";
import { CommandPalette, type Cmd } from "@/components/CommandPalette";
import { logout } from "@/app/actions";
import { prisma } from "@/lib/prisma";
import { aiEnabled } from "@/lib/ai";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; perm?: string; mod?: ModuleKey; badge?: "approvals" };
const NAV: { section?: string; items: Item[] }[] = [
  { items: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/copilot", label: "AI Copilot", icon: Sparkles, perm: "ai.use", mod: "ai" },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck, perm: "hr.self", badge: "approvals" },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, perm: "task.view", mod: "projects" },
  ]},
  { section: "CRM", items: [
    { href: "/leads", label: "Leads", icon: Users, perm: "lead.view", mod: "crm" },
    { href: "/contacts", label: "Customers", icon: Contact, perm: "contact.view", mod: "crm" },
    { href: "/followups", label: "Follow-ups", icon: CalendarClock, perm: "followup.view", mod: "crm" },
    { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, perm: "deal.view", mod: "sales" },
  ]},
  { section: "Calling", items: [
    { href: "/dialer", label: "Power Dialer", icon: PhoneOutgoing, perm: "call.make", mod: "dialer" },
    { href: "/calls", label: "Call Logs", icon: PhoneCall, perm: "call.view", mod: "calling" },
  ]},
  { section: "Sales & Finance", items: [
    { href: "/products", label: "Products", icon: Package, perm: "product.view", mod: "sales" },
    { href: "/quotations", label: "Quotations", icon: FileText, perm: "quotation.view", mod: "quotations" },
    { href: "/invoices", label: "Invoices", icon: Receipt, perm: "invoice.view", mod: "invoices" },
  ]},
  { section: "Operations", items: [
    { href: "/projects", label: "Projects", icon: FolderKanban, perm: "task.view", mod: "projects" },
    { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory.view", mod: "inventory" },
    { href: "/purchases", label: "Purchases", icon: ShoppingCart, perm: "purchase.manage", mod: "inventory" },
    { href: "/tickets", label: "Support", icon: LifeBuoy, perm: "ticket.view", mod: "support" },
  ]},
  { section: "People", items: [
    { href: "/attendance", label: "Attendance", icon: Clock, perm: "hr.self", mod: "hr" },
    { href: "/leave", label: "Leave", icon: Plane, perm: "hr.self", mod: "hr" },
    { href: "/expenses", label: "Expenses", icon: Wallet, perm: "hr.self", mod: "hr" },
  ]},
  { section: "Automation & AI", items: [
    { href: "/workflows", label: "Workflows", icon: Workflow, perm: "workflow.manage", mod: "workflows" },
    { href: "/messages", label: "Messages", icon: MessageSquare, perm: "workflow.manage", mod: "workflows" },
    { href: "/knowledge", label: "Knowledge base", icon: BookOpen, perm: "kb.view" },
  ]},
  { section: "Insights", items: [
    { href: "/reports", label: "Reports", icon: BarChart3, perm: "report.view", mod: "reports" },
    { href: "/security", label: "Security center", icon: ShieldCheck, perm: "security.manage" },
  ]},
];

function visible(ctx: Ctx, i: Item) {
  return (!i.perm || has(ctx, i.perm)) && (!i.mod || hasModule(ctx, i.mod));
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [unread, memberships, objects, pendingApprovals] = await Promise.all([
    ctx.db.notification.count({ where: { membershipId: ctx.membership.id, readAt: null } }),
    prisma.membership.count({ where: { userId: ctx.user.id, status: "active" } }),
    hasModule(ctx, "custom") && has(ctx, "records.view") ? ctx.db.customObject.findMany({ orderBy: { name: "asc" } }) : [],
    ctx.db.approvalRequest.count({ where: { status: "pending", NOT: { requestedById: ctx.membership.id } } }),
  ]);
  const nav = objects.length ? [...NAV.slice(0, 5), { section: "Records", items: objects.map((o) => ({ href: `/records/${o.key}`, label: o.pluralName, icon: Database })) }, ...NAV.slice(5)] : NAV;
  const commands: Cmd[] = [
    ...nav.flatMap((g) => g.items.filter((it) => visible(ctx, it)).map((it) => ({ label: it.label, href: it.href, group: g.section ?? "Go to" }))),
    ...(has(ctx, "lead.create") ? [{ label: "New lead", href: "/leads/new", group: "Create" }] : []),
    ...(has(ctx, "task.manage") ? [{ label: "New task", href: "/tasks", group: "Create" }] : []),
    ...(has(ctx, "quotation.create") ? [{ label: "New quotation", href: "/quotations/new", group: "Create" }] : []),
    ...(has(ctx, "invoice.create") ? [{ label: "New invoice", href: "/invoices/new", group: "Create" }] : []),
    ...(has(ctx, "hr.self") ? [{ label: "Check in / out", href: "/attendance", group: "Me" }, { label: "Apply for leave", href: "/leave", group: "Me" }, { label: "Submit expense", href: "/expenses", group: "Me" }] : []),
    { label: "AI quick capture (voice → CRM)", event: "open-quick-capture", group: "AI", keywords: "voice dictate note" },
    { label: "Settings", href: "/settings", group: "Go to" }, { label: "My security & 2FA", href: "/settings/security", group: "Me" },
  ];
  const trialDays = ctx.tenant.trialEndsAt ? Math.ceil((ctx.tenant.trialEndsAt.getTime() - Date.now()) / 86400_000) : null;

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white md:flex">
        <Link href="/dashboard" className="flex items-center gap-2 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">B</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{ctx.tenant.name}</div>
            <div className="truncate text-[11px] text-muted">{ctx.membership.role.name}{ctx.membership.branch ? ` · ${ctx.membership.branch.name}` : ""}</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {nav.map((g, i) => {
            const items = g.items.filter((it) => visible(ctx, it));
            if (!items.length) return null;
            return (
              <div key={i}>
                {g.section && <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{g.section}</div>}
                <div className="space-y-0.5">
                  {items.map((it) => <NavLink key={it.href} href={it.href}><it.icon size={16} /><span className="flex-1">{it.label}</span>{"badge" in it && it.badge === "approvals" && pendingApprovals > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">{pendingApprovals}</span>}</NavLink>)}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="space-y-0.5 border-t border-line p-3">
          {ctx.user.isPlatformAdmin && <NavLink href="/platform"><Shield size={16} />Platform Admin</NavLink>}
          <NavLink href="/settings"><Settings size={16} />Settings</NavLink>
          <form action={logout}><button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100"><LogOut size={16} />Sign out</button></form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {ctx.tenant.status !== "active" && (
          <div className={`no-print px-4 py-2 text-center text-xs ${ctx.writable ? "bg-violet-50 text-violet-800" : "bg-red-50 text-red-800"}`}>
            {ctx.tenant.status === "trial" && trialDays != null && <>Free trial · {Math.max(0, trialDays)} days left on the {ctx.plan.name} plan. </>}
            {ctx.tenant.status === "grace" && <>Your trial has ended — you are in a grace period. </>}
            {!ctx.writable && <>Your workspace is read-only. </>}
            {has(ctx, "billing.manage") && <Link href="/settings/billing" className="font-medium underline">Choose a plan</Link>}
          </div>
        )}
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur md:px-6">
          <Link href="/dashboard" className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white md:hidden">B</Link>
          <form action="/search" className="relative max-w-md flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input name="q" placeholder="Search leads, customers, invoices, quotations…" className="input pl-9" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <CommandPalette commands={commands} />
            {hasModule(ctx, "ai") && has(ctx, "lead.view") && <QuickCapture enabled={aiEnabled()} />}
            {memberships > 1 && <Link href="/switch" className="btn-ghost btn-sm">Switch company</Link>}
            <Link href="/notifications" className="btn-ghost relative" aria-label="Notifications">
              <Bell size={18} />
              {unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link href="/settings/security" className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-xs font-semibold" title={ctx.user.email}>
              {ctx.user.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
            </Link>
          </div>
        </header>
        <nav className="no-print flex gap-1 overflow-x-auto border-b border-line bg-white px-3 py-2 md:hidden">
          {nav.flatMap((g) => g.items).filter((it) => visible(ctx, it)).map((it) => (
            <Link key={it.href} href={it.href} className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100">{it.label}</Link>
          ))}
          <Link href="/settings" className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-gray-600">Settings</Link>
        </nav>
        <Suspense fallback={null}><Flash /></Suspense>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
