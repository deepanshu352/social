import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PLANS } from "@/lib/plans";
import { inr } from "@/lib/money";

const FEATURES = [
  ["CRM & Lead Management", "Capture leads from website, ads, WhatsApp and API. Auto-assign by city, language and workload."],
  ["Telecalling & Power Dialer", "Click-to-call, sequential dialer, mandatory dispositions, DND and calling-hour compliance."],
  ["Sales Pipeline", "Kanban deals, GST quotations with discount approvals and customer e-acceptance."],
  ["Invoices & Payments", "Gapless GST invoice numbering, CGST/SGST/IGST, part payments and receivables ageing."],
  ["Automation", "WHEN → IF → THEN rules: auto follow-ups, tags, priority, notifications and webhooks."],
  ["AI Business Copilot", "Ask “which invoices above ₹50,000 are overdue?” and get answers from your live data — permission-aware."],
];

export default async function Home() {
  const s = await getSessionUser();
  if (s) redirect(s.tenantId ? "/dashboard" : "/platform");
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-white">B</span> BizOS</div>
        <div className="flex gap-2"><Link href="/login" className="btn-ghost">Sign in</Link><Link href="/signup" className="btn-primary">Start free trial</Link></div>
      </header>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 text-center">
        <p className="mb-3 text-sm font-medium text-brand-600">The AI-powered operating system for your business</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">From lead to payment — everything in one place.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">CRM, telecalling, sales, quotations, invoicing, automation and an AI Copilot. Built for Indian SMBs, multi-branch from day one.</p>
        <div className="mt-8 flex justify-center gap-3"><Link href="/signup" className="btn-primary px-5 py-2.5">Start 14-day free trial</Link><Link href="/login" className="btn-secondary px-5 py-2.5">View demo</Link></div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-3">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="card card-pad"><h3 className="font-semibold">{t}</h3><p className="mt-1.5 text-sm text-muted">{d}</p></div>
        ))}
      </section>
      <section className="border-t border-line bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-8 text-center text-2xl font-semibold">Simple pricing</h2>
          <div className="grid gap-4 md:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.key} className="card card-pad">
                <div className="font-semibold">{p.name}</div>
                <div className="mt-2 text-2xl font-semibold">{p.pricePerUser ? <>{inr(p.pricePerUser, false)}<span className="text-sm font-normal text-muted">/user/mo</span></> : "Custom"}</div>
                <p className="mt-2 text-sm text-muted">{p.tagline}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
