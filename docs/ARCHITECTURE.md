# Architecture

## Shape

A **modular monolith** on Next.js 15 (App Router). Server components handle reads, server actions handle form writes, and route handlers serve JSON/REST. PostgreSQL is accessed through Prisma. This follows BRD §89: start as one deployable and split out hot paths (dialer, AI, jobs) later.

```
app/
  (auth)/          login, signup, 2FA
  (app)/           authenticated product, one folder per module (page + actions.ts)
  q/[token] i/[token]   public quotation / invoice links
  platform/        super-admin console
  api/
    v1/            public REST API (API keys)
    calls, dialer, copilot, ai/*   JSON endpoints for client components
    webhooks/telephony, public/leads, cron/daily, health
lib/               domain services (no React)
components/        UI kit, CallPanel, DocEditor, DocumentView
prisma/            schema, seed, optional RLS
```

## Tenant isolation (BRD §6)

Each business table has `tenantId`. Requests never use the raw Prisma client for business data. They use `ctx.db = tenantDb(tenantId)` (`lib/db.ts`), a Prisma client extension that:
- merges `tenantId` into the `where` of every read, update, delete, count and aggregate
- writes `tenantId` into every create, createMany and upsert

So even a buggy `findFirst({ where: { id } })` cannot cross tenants. The e2e suite checks this (another tenant's admin gets 404 on your lead and quotation URLs). `prisma/rls.sql` adds Postgres RLS as a second layer.

## Request context and RBAC (BRD §9)

`getCtx()` (`lib/auth.ts`) resolves session → membership → role → tenant → plan once per request (React `cache`).
- `guard(perm, module)`: page guard. Redirects to `/denied` or `/upgrade`.
- `authorize(perm, {mod, write})`: action/API guard. Throws, and blocks writes when the tenant is restricted.
- `scopeWhere(ctx, perm, ownerField)`: turns the role's scope into a Prisma filter:
  `own → ownerId = me`, `team → ownerId ∈ (me + my team + my reports)`, `branch → branchId = mine`, `all → {}`.

Every list, detail, search and AI tool composes `scopeWhere`. That is how a telecaller sees only their leads and the AI Copilot sees exactly what its user sees.

## Domain events & automation

Writes call `emit(tenantId, type, payload)` (`lib/events.ts`). That runs matching **automations** (WHEN/IF/THEN) and delivers **webhooks** signed with HMAC-SHA256. Today this runs in-process after the write. Swapping in a queue changes only `emit()`.

## Money & documents

- Money is `BigInt` paise everywhere and is converted only at the edges (`lib/money.ts`).
- `lib/pricing.ts` is the single GST engine, imported by the client editor (live preview) and the server (authoritative totals).
- Document numbers come from an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` counter per tenant and per FY key. Invoices get a number **only when issued**, so drafts never leave gaps. Issued invoices are immutable; corrections are made by cancelling and reissuing.

## Calling

`startCall` → permission + scope check → stale-call cleanup → **compliance gate** (tenant DND list, contact opt-out, calling hours in tenant TZ, all audit-logged) → `provider.placeCall` → `CallLog`. The agent's disposition updates the lead status (never backwards except lost/converted), closes the satisfied follow-up, schedules the callback, adds opt-outs to DND, rescores the lead and emits `call.completed`.

## AI layer (BRD §93–97)

`lib/ai.ts`, using the Anthropic TypeScript SDK:
- **Copilot**: the SDK tool runner (`client.beta.messages.toolRunner`) with 7 Zod-typed tools that close over the user's `ctx`. Six are read-only and scope-filtered. One is a low-risk action (`create_followup`) that is audit-logged with `actorType: "ai"`. High-risk operations (refunds, discounts, cancellations) are deliberately not exposed as tools.
- **Lead insight** and **morning briefing**: single calls.
- Requests use `output_config.effort` and the server-side refusal fallback (`fallbacks: "default"`). Each usage is recorded in `AiUsage` with an estimated cost, and plan quotas are enforced before calling.

## Workflow engine (Phase 2)

`lib/workflows.ts`. A workflow is `trigger + triggerConfig + conditions + steps[]`; steps are `action | wait | condition{then[], else[]}` (nestable).
- **Start:** `emit()` → `startWorkflows()` creates a `WorkflowRun` (status `waiting`, `nextRunAt = now`) for each matching active workflow, then runs it via `after()` (post-response) so user requests stay fast.
- **Execute:** `processRun()` claims the run atomically (`updateMany … status waiting→running`), walks steps using a path pointer (e.g. `[2,"then",0]`), reloads entities before every step, logs each step, and stops at a WAIT (`nextRunAt`).
- **Scheduler:** `tick()` resumes due runs and runs scanners (lead idle, invoices due, quotations pending, inactive customers, SLA breaches, overdue tasks, daily/weekly schedules). Scanner runs carry a `dedupeKey` (unique per workflow) so each record triggers once per condition window.
- **Safety:** zod-validated definitions, 80-step cap, 60 steps per execution slice, https-only webhooks signed with HMAC, DND/consent enforcement in `send()`, and AI actions that are skipped without a key.

## Security layers (Phase 2)

| Layer | Where |
|---|---|
| Lockout, per-IP throttle, login events, new-device alerts | `app/(auth)/actions.ts` |
| 2FA enforcement policy, IP allowlist, idle timeout | `lib/auth.ts` (`accessBlock`, `requireCtx`) |
| Phone masking (`data.unmask`) | `phoneFor()` in `lib/auth.ts`, used by every screen and API that shows numbers |
| AES-256-GCM secrets, password policy, CIDR matching | `lib/security.ts` |
| Hash-chained audit with per-tenant advisory lock; link-following verifier | `lib/audit.ts` |
| Anomaly rules | `lib/anomalies.ts` |
| Upload validation (size + magic bytes), sandboxed file serving | `lib/files.ts`, `app/api/files/[id]` |
| Readable errors from server actions in production | `lib/action.ts` (`guarded`) + `components/Flash.tsx` |

## Scaling path

1. Move `emit()`, reminders and cron to BullMQ workers (Redis).
2. Move rate limits and the dialer queue lock to Redis.
3. Turn on RLS with a non-owner DB role.
4. Add read replicas or a warehouse for reports.
5. Extract the telephony/dialer and AI gateways as services when their load justifies it.
