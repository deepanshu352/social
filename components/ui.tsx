import Link from "next/link";
import { cn, titleCase } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link href={back.href} className="mb-1 inline-block text-xs text-muted hover:text-ink">← {back.label}</Link>}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("card", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "card-pad" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "warn" | "bad" | "good" }) {
  const body = (
    <div className="card card-pad h-full transition hover:border-brand-100">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && (
        <div className={cn("mt-1 text-xs", tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-green-700" : "text-muted")}>{hint}</div>
      )}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const TONES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700", blue: "bg-blue-50 text-blue-700", green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700", cyan: "bg-cyan-50 text-cyan-800",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  new: "blue", contacted: "cyan", qualified: "violet", converted: "green", lost: "gray", unqualified: "gray",
  hot: "red", warm: "amber", cold: "blue",
  draft: "gray", pending_approval: "amber", approved: "blue", sent: "cyan", viewed: "violet", accepted: "green", rejected: "red", expired: "gray",
  issued: "blue", partially_paid: "amber", paid: "green", overdue: "red", cancelled: "gray",
  pending: "amber", done: "green", missed: "red", completed: "green", no_answer: "gray", busy: "amber", failed: "red", ringing: "cyan", in_progress: "blue", initiated: "gray",
  trial: "violet", active: "green", grace: "amber", restricted: "red", suspended: "red",
  open: "blue", resolved: "green", closed: "gray", won: "green",
  low: "gray", medium: "blue", high: "amber", urgent: "red",
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cn("badge", TONES[tone ?? "gray"])}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{titleCase(status)}</Badge>;
}

export function ScoreBadge({ score, band }: { score: number; band: string }) {
  return (
    <span className={cn("badge tabular-nums", TONES[STATUS_TONE[band] ?? "gray"])} title={`Lead score ${score}/100 (${band})`}>
      {score} · {titleCase(band)}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", t.key === active ? "border-brand-500 font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

/**
 * Single-series bar chart (server-rendered). One hue (series slot 1), thin bars with a 2px gap,
 * 4px rounded data-ends on the baseline, recessive axis, per-bar hover tooltip + value on hover.
 */
export function BarChart({ data, format = (v: number) => String(v), height = 160, label }: { data: { label: string; value: number }[]; format?: (v: number) => string; height?: number; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure aria-label={label}>
      <div className="flex items-end gap-[2px] border-b border-line" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="w-full max-w-9 rounded-t-[4px] bg-brand-500 transition group-hover:bg-brand-700" style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow group-hover:block">
              {d.label}: <span className="font-semibold">{format(d.value)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {data.map((d) => <div key={d.label} className="flex-1 truncate text-center text-[11px] text-muted">{d.label}</div>)}
      </div>
      <table className="sr-only"><caption>{label}</caption><tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Horizontal bars for ranked categories (leads by source, etc.). */
export function HBars({ data, format = (v: number) => String(v) }: { data: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} title={`${d.label}: ${format(d.value)}`}>
          <div className="mb-1 flex justify-between text-xs"><span className="text-ink">{d.label}</span><span className="tabular-nums text-muted">{format(d.value)}{d.sub ? ` · ${d.sub}` : ""}</span></div>
          <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, makeHref }: { page: number; pages: number; makeHref: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary btn-sm" href={makeHref(page - 1)}>Previous</Link>}
        {page < pages && <Link className="btn-secondary btn-sm" href={makeHref(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}
