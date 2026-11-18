# BizOS — AI-Powered Business Operating System

A multi-tenant SaaS for Indian SMBs, built with Next.js. It covers the whole journey from **lead → call → deal → quotation → invoice → payment**, with an AI Copilot that answers questions from your live data.

Built from the BRD/PRD (`docs/01_MVP_Technical_Spec.md`). This repository is the **Phase 1 (MVP / P0)** build, plus support tickets, automations, the REST API and AI, which were pulled forward from later phases.

## Quick start

Requirements: Node 22, PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET
npm run db:push               # create tables
npm run db:seed               # demo data (2 companies, 7 users, ~6 months of activity)
npm run dev                   # http://localhost:3000
```

Or with Docker:

```bash
docker compose up --build
docker compose exec app npx tsx prisma/seed.ts
```

### Demo accounts (password `Password@123`)

| Email | Role | What it shows |
|---|---|---|
| admin@sharma.demo | Company Admin | Everything. Also belongs to a second company (try **Switch company**) |
| manager@sharma.demo | Sales Manager | Team scope, discount approvals, pipeline |
| sales@sharma.demo | Sales Executive | Own leads, quotations (10% discount limit) |
| telecaller@sharma.demo | Telecaller | Leads + power dialer only; no revenue or invoices |
| telecaller2@sharma.demo | Telecaller (Lucknow) | Gets Lucknow/Kanpur leads via assignment rules |
| accounts@sharma.demo | Accountant | Invoices, payments, receivables |
| admin@pixelcraft.demo | Admin of another tenant | Proves tenant isolation |
| platform@bizos.demo | Platform owner | `/platform` super-admin console (MRR, tenants, suspend) |

### Enable AI

Set `ANTHROPIC_API_KEY` in `.env`. This turns on:
- **AI Copilot** (`/copilot`): natural-language questions answered from live data through permission-scoped tools. It can also schedule follow-ups for you, and every such action is audit-logged.
- **AI lead insight** (lead page): a summary, purchase likelihood, main objection, next best action and a suggested WhatsApp message.
- **AI morning briefing** (dashboard).

Without a key, the dashboard still shows a rule-based **AI Business Summary**. Every AI call is metered per tenant (Settings → Plan & billing → AI usage & cost). The model is `AI_MODEL`, default `claude-opus-5-5`.

## What's new in Phase 2 (Advanced)

| Area | Features |
|---|---|
| **Workflow automation engine** | Visual builder: **WHEN** (23 triggers: events, time-based scanners such as *lead idle N days*, *invoice due in N days*, *quotation not accepted*, *customer inactive 90 days*, *SLA breach*, *task overdue*, and **daily/weekly schedules**) → **ONLY IF** filters → **THEN** 14 actions → **WAIT** minutes/hours/days → **IF / ELSE** branches (nestable). Re-checks fresh data after every WAIT. Run history with step-by-step logs, *Test run now*, pause/duplicate, **18-recipe library** (speed-to-lead, overdue collection sequence, win-back, AI ticket triage, morning digest…). Starter workflows are switched on for every new company. |
| **Messaging** | Email (Resend), WhatsApp (Meta Cloud API) and SMS (webhook) with `{{variable}}` templates, a composer with an AI draft option on lead and customer pages, a full communication log, and DND / opt-out blocking. Without provider keys, sends are recorded as "simulated" so flows can be tested. |
| **Security** | Account lockout (5 failures → 15 min) + per-IP throttle, login history, **new-device alerts**, password policy, **company-wide 2FA enforcement**, **IP allowlist** (with self-lockout guard), idle-session timeout, **phone-number masking** by role, **AES-256-GCM** encryption of secrets, **tamper-evident hash-chained audit log** with one-click verification, **Security Center** (score, anomaly detection: brute force, odd-hour logins, exports, bulk deletes, big discounts, flagged expenses), emergency “sign out everyone”, full **data export** (DPDP), CSP/HSTS headers, magic-byte upload validation. |
| **AI assistance** | **Quick Capture**: speak or type in English, Hindi or Hinglish (“Rahul wants 50 pipes, call kal 11 baje”); Claude extracts it, you review, and it becomes a lead, note, follow-up and quote task. **Receipt scanning** for expenses (image/PDF → amount, GST, vendor, date). **AI ticket triage** (category, priority, sentiment, suggested reply). **Knowledge Base Q&A** answered only from documents your role may read, with sources. **AI lead qualification** inside workflows. Copilot gets new tools: create tasks, search the knowledge base, and the user's own HR info. |
| **Tasks & projects** | Kanban (drag & drop), my/team views, priorities, due dates, time logging, estimates, projects with progress, budget and hours. |
| **People (HR)** | Attendance with geolocation check-in/out, late marks, team-today board with map links; leave with balances, half-days, overlap checks and policy; expense claims with receipts, AI scan, anomaly flags (over limit, duplicates, same receipt reused, late claims) and reimbursement. |
| **Approvals engine** | Multi-level chains per policy (e.g. expense ≥ ₹10k: manager → accounts), no self-approval, admin override, unified inbox with history. |
| **Inventory & purchasing** | Immutable stock ledger, auto stock-out on invoice issue and reversal on cancel, days-of-cover, adjustments with reason, low-stock event, vendors with on-time %, POs → approval → goods received (stock in). |
| **Customisation (any industry)** | Custom fields (10 types) on leads, customers, tasks and objects; **custom objects** with their own list/detail screens; **8 industry packs** (transport, trading, IT/agency, field service, telecalling, real estate, healthcare, education). |
| **UI** | Ctrl/⌘+K command palette, reorganised navigation with approval badges, readable action-error notifications, friendly error / 404 pages. |

## What's included

| Area | Features |
|---|---|
| **Platform core** | Multi-tenant (a user can belong to many companies), branches, teams, reporting lines, signup with business type, 14-day trial → grace → restricted lifecycle |
| **Auth & security** | Email/password (bcrypt), TOTP 2FA, revocable DB-backed sessions, device/session list, login throttling, security headers, audit log with before/after diffs |
| **RBAC** | 35 permissions × scopes (own / team / branch / all), 7 seeded roles, custom roles, per-role discount limit. The AI uses the same guard |
| **CRM** | Leads (sources, scoring, tags, priority, duplicate detection, CSV import/export, bulk assign/tag/delete), activity timeline, follow-ups (“My day”), lead → customer + deal conversion, Customer 360 |
| **Lead assignment** | Rule engine (city / source / language / budget / product…), round-robin with an atomic cursor, least-workload, availability, rule tester |
| **Calling** | Click-to-call through a pluggable telephony provider (demo provider included), mandatory dispositions, callbacks, DND list + opt-out, calling-hour enforcement, call logs & KPIs, status webhook |
| **Power dialer** | Queue of due follow-ups then top-scored leads, auto-dial, wrap-up timer, break/stop, call script |
| **Sales** | Kanban pipeline (drag & drop), weighted forecast, win rate, products & services with HSN/GST |
| **Quotations** | GST editor (CGST+SGST / IGST, discounts, round-off), discount approval workflow, versioned revisions, public link with view tracking, customer e-acceptance (name + IP + time), convert to invoice |
| **Invoicing** | Drafts, gapless FY numbering on issue (`INV/2026-27/0001`), lock after issue, partial payments, cancellation with reason, reminders, public invoice page, receivables ageing |
| **Support** | Tickets with SLA by priority, assignment, breach indicator |
| **Automation** | WHEN → IF → THEN engine on 12 domain events (follow-up, notify, tag, priority, assign, webhook) |
| **Reports** | Revenue by week, funnel, leads by source with conversion, top products, team performance, branch filter, median first-response time |
| **API** | REST v1 with API keys (SHA-256 hashed, rate-limited), outbound webhooks signed with HMAC, website form capture endpoint |
| **SaaS billing** | Plans with module entitlements, seats, usage meters (users, call minutes, AI), upgrade flow (mock checkout), super-admin console |

## Commands

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | TypeScript check |
| `npm test` | Unit tests (GST engine, TOTP, CSV, assignment rules, helpers) |
| `npm run test:e2e` | Playwright end-to-end (server must be running with seeded data and `IGNORE_CALLING_HOURS=1`) |
| `npm run db:reset` | Drop, recreate and reseed the database |
| `npm run db:rls` | Optional Postgres row-level security policies |
| `npm run db:upgrade` | Upgrade existing companies to Phase 2 (new permissions, policies, templates, starter workflows, KB, industry pack) |

Schedulers:
- **Workflow tick:** with `next start`, a built-in scheduler runs every minute. On serverless or multi-instance deployments, set `INTERNAL_SCHEDULER=off` and call `GET /api/cron/tick` every minute instead.
- **Daily job:** call `GET /api/cron/daily` once a day. It marks overdue invoices and missed follow-ups (which start workflows) and expires old quotations. It also moves trials through their lifecycle.

Both need `Authorization: Bearer $CRON_SECRET`.

## Going to production — integration points

These are stubbed on purpose and clearly marked in code:

| What | Where |
|---|---|
| Real telephony (Exotel / Knowlarity / Ozonetel / Twilio) | `lib/telephony.ts` → implement `TelephonyProvider`; status callbacks go to `/api/webhooks/telephony` |
| Subscription payments (Razorpay / Stripe) | `app/(app)/settings/billing/page.tsx` `choosePlan` → create the subscription and activate from the gateway webhook |
| Customer payment links | `app/i/[token]/page.tsx` |
| Email / WhatsApp sending (invites, reminders, quotations) | `reminderAction` in `app/(app)/invoices/actions.ts`, `invite` in settings/users |
| Background jobs | `lib/events.ts` runs in-process; move to BullMQ + Redis for retries at scale |
| Rate limits | In-memory in `lib/apikey.ts` and the login action; move to Redis when running more than one instance |

See `docs/ARCHITECTURE.md` for the design.
