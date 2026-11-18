import Link from "next/link";
import { requireCtx, has, scopeWhere, phoneFor } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty } from "@/components/ui";
import { inr } from "@/lib/money";

export const metadata = { title: "Search" };

/** Global search across modules, each section permission-scoped (BRD §68). */
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  const q = (await searchParams).q?.trim() ?? "";
  if (!q) return <><PageHeader title="Search" /><Card><Empty title="Type something to search" /></Card></>;
  const ci = { contains: q, mode: "insensitive" as const };
  const num = Number(q.replace(/\D/g, "")) || undefined;
  const [leads, contacts, deals, quotes, invoices] = await Promise.all([
    has(ctx, "lead.view") ? ctx.db.lead.findMany({ where: { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null, OR: [{ name: ci }, { companyName: ci }, { phone: { contains: q } }, { email: ci }, ...(num ? [{ number: num }] : [])] }, take: 10 }) : [],
    has(ctx, "contact.view") ? ctx.db.contact.findMany({ where: { ...(await scopeWhere(ctx, "contact.view")), deletedAt: null, OR: [{ name: ci }, { companyName: ci }, { phone: { contains: q } }, { gstin: ci }] }, take: 10 }) : [],
    has(ctx, "deal.view") ? ctx.db.deal.findMany({ where: { ...(await scopeWhere(ctx, "deal.view")), title: ci }, include: { stage: true }, take: 10 }) : [],
    has(ctx, "quotation.view") ? ctx.db.quotation.findMany({ where: { ...(await scopeWhere(ctx, "quotation.view")), OR: [{ number: ci }, { contact: { name: ci } }] }, include: { contact: true }, take: 10 }) : [],
    has(ctx, "invoice.view") ? ctx.db.invoice.findMany({ where: { ...(await scopeWhere(ctx, "invoice.view")), OR: [{ number: ci }, { contact: { name: ci } }] }, include: { contact: true }, take: 10 }) : [],
  ]);
  const total = leads.length + contacts.length + deals.length + quotes.length + invoices.length;
  const Section = ({ title, children, n }: { title: string; children: React.ReactNode; n: number }) => n ? <Card title={`${title} (${n})`} pad={false}><ul className="divide-y divide-line">{children}</ul></Card> : null;
  const Row = ({ href, a, b, c }: { href: string; a: React.ReactNode; b?: React.ReactNode; c?: React.ReactNode }) => <li><Link href={href} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-gray-50"><span><span className="font-medium">{a}</span> <span className="text-muted">{b}</span></span>{c}</Link></li>;
  return (
    <>
      <PageHeader title={`Results for “${q}”`} subtitle={`${total} matches`} />
      <div className="space-y-4">
        <Section title="Leads" n={leads.length}>{leads.map((l) => <Row key={l.id} href={`/leads/${l.id}`} a={l.name} b={`LD-${l.number} · ${phoneFor(ctx, l.phone) ?? ""}`} c={<StatusBadge status={l.status} />} />)}</Section>
        <Section title="Customers" n={contacts.length}>{contacts.map((c) => <Row key={c.id} href={`/contacts/${c.id}`} a={c.name} b={c.companyName ?? phoneFor(ctx, c.phone)} />)}</Section>
        <Section title="Deals" n={deals.length}>{deals.map((d) => <Row key={d.id} href={`/pipeline?highlight=${d.id}`} a={d.title} b={d.stage.name} c={inr(d.amount, false)} />)}</Section>
        <Section title="Quotations" n={quotes.length}>{quotes.map((x) => <Row key={x.id} href={`/quotations/${x.id}`} a={x.number} b={x.contact.name} c={<StatusBadge status={x.status} />} />)}</Section>
        <Section title="Invoices" n={invoices.length}>{invoices.map((x) => <Row key={x.id} href={`/invoices/${x.id}`} a={x.number ?? "Draft"} b={x.contact.name} c={inr(x.total)} />)}</Section>
        {!total && <Card><Empty title="No matches">Try a phone number, LD-number, GSTIN or invoice number.</Empty></Card>}
      </div>
    </>
  );
}
