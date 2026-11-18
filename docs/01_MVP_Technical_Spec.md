# AI Business OS — Phase 1 (MVP / P0) Technical Specification

**Derived from:** BRD/PRD v1.0 · **Scope:** P0 items only (§101) · **Status:** Build-ready draft
**Breakdown level:** Module → Screen → Field → Table → API → Permission → Workflow → AI hook

> P1–P3 modules (WhatsApp, inventory, delivery, HR, AI agents) are **out of scope** here, but every P0 table and API leaves a seam for them (noted as `→ P1` / `→ AI`). Building those seams now avoids migrations later.

---

## 0. Global Engineering Conventions

These apply to every module. Decide once, never revisit per module.

| Area | Decision | Why |
|---|---|---|
| Architecture | NestJS modular monolith + BullMQ workers; Next.js (App Router) frontend | §89–90. One deployable, module boundaries enforced by Nest modules + lint rules (no cross-module repository imports — call the other module's service). |
| DB | PostgreSQL 16, Prisma ORM | |
| Tenancy | Shared DB, shared schema, `tenant_id UUID NOT NULL` on every business table **+ Postgres Row-Level Security** | App-level filtering alone fails the first time someone writes a raw query. RLS is the backstop for §6 "must never access". |
| RLS mechanism | Each request runs in a transaction that does `SET LOCAL app.tenant_id = '<uuid>'`; policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. App DB role has **no** `BYPASSRLS`. Platform-admin jobs use a separate role, every use audited. | |
| IDs | UUIDv7 (time-ordered) primary keys; human-readable numbers (`LD-00042`, `QT/2026-27/0007`) are separate columns | |
| Money | `BIGINT` in minor units (paise) + `currency CHAR(3)` default `INR`. Never floats. | |
| Quantities | `NUMERIC(14,3)` | |
| Time | `TIMESTAMPTZ` everywhere, stored UTC; tenant has `timezone` (default `Asia/Kolkata`) | Calling-hour rules & "today" reports depend on tenant TZ. |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` on user-facing entities; financial docs (invoice, payment) are **never deleted**, only cancelled | Audit/GST compliance. |
| Standard columns | `id, tenant_id, branch_id (nullable where n/a), created_at, created_by, updated_at, updated_by, deleted_at` | Referred to below as **[std]**. |
| Custom fields | `custom JSONB NOT NULL DEFAULT '{}'` on lead, contact, company, deal, product, quotation, invoice; definitions in `custom_field_defs` | Ships §64 cheaply; GIN index. |
| API | REST, `/api/v1/...`, JSON, cursor pagination (`?cursor=&limit=`, max 100), filters `?filter[status]=new`, sort `?sort=-created_at` | |
| Errors | `{ "error": { "code": "LEAD_NOT_FOUND", "message": "...", "details": {} } }` | |
| Idempotency | `Idempotency-Key` header honoured on all `POST` that create financial records or place calls | Prevents duplicate invoices/calls on retry. |
| Events | Every state change emits a domain event to an `outbox` table (transactional outbox) → worker publishes to BullMQ → consumers (automation, webhooks, AI, notifications) | This is the backbone for §61 automation and §79 webhooks later. |
| Audit | Interceptor writes `audit_logs` for every mutating request (§88) | |
| Numbering | `doc_sequences(tenant_id, doc_type, fiscal_year, branch_id, next_value)` incremented with `SELECT … FOR UPDATE` | GST requires gapless, per-FY invoice numbers. |

---

## 1. Platform Core

### 1.1 Tables

```
tenants
  id, name, slug UNIQUE, business_type ENUM(it, transport, distributor, manufacturer,
  service, telecalling, retail, ecommerce, agency, other), timezone, currency,
  country, gstin NULL, address JSONB, logo_url, status ENUM(trial, active, grace,
  restricted, suspended, cancelled), trial_ends_at, created_at

branches            [std] name, code, gstin NULL, state_code (for GST place-of-supply),
                    address JSONB, phone, is_head_office BOOL
departments         [std] name, parent_id NULL
teams               [std] name, department_id, manager_user_id

users               id, email UNIQUE (global), phone UNIQUE NULL, password_hash (argon2id),
                    name, avatar_url, totp_secret_enc NULL, totp_enabled BOOL,
                    email_verified_at, phone_verified_at, last_login_at, status
memberships         [std] user_id, role_id, default_branch_id, department_id NULL,
                    team_id NULL, reports_to_membership_id NULL, employee_code,
                    languages TEXT[], skills TEXT[], is_available BOOL, status(invited/active/disabled)
                    UNIQUE(tenant_id, user_id)
membership_branches membership_id, branch_id            -- which branches a user can see

roles               [std] name, key, is_system BOOL, description
permissions         key PK (e.g. 'lead.view'), module, action, description   -- global catalogue
role_permissions    role_id, permission_key, scope ENUM(own, team, branch, all)

sessions            id, user_id, tenant_id, refresh_token_hash, device_name, user_agent,
                    ip, created_at, last_seen_at, revoked_at
login_history       id, user_id, tenant_id NULL, ip, user_agent, success BOOL, reason, at
otp_codes           id, target(phone/email), purpose, code_hash, expires_at, attempts, consumed_at
api_keys            [std] name, prefix, key_hash, scopes TEXT[], last_used_at, expires_at, revoked_at
audit_logs          id, tenant_id, actor_type(user/api_key/system/ai), actor_id, action,
                    entity_type, entity_id, before JSONB, after JSONB, ip, user_agent, at
                    -- append-only; partitioned monthly
custom_field_defs   [std] entity_type, key, label, type ENUM(text, number, date, dropdown,
                    multiselect, boolean, file, location), options JSONB, required BOOL, order
outbox_events       id, tenant_id, type ('lead.created'), payload JSONB, created_at, published_at
```

User ↔ tenant is many-to-many via `memberships` (a consultant can belong to two companies; §6 isolation still holds because every request is scoped to exactly one active tenant).

### 1.2 Permission model (§9)

Permission = `module.action` + **scope**. Scope is what makes "telecaller sees only assigned leads" work without special-casing.

| Scope | Meaning (for a record) |
|---|---|
| `own` | `owner_id = me` or `created_by = me` |
| `team` | owner is in my team or reports to me (recursive) |
| `branch` | `branch_id IN my membership_branches` |
| `all` | whole tenant |

Enforcement: a `@Permission('lead.view')` guard resolves the user's scope, and the repository layer appends the scope filter. **AI calls go through the same guard** (§93: AI never bypasses RBAC).

Actions catalogue: `view, create, edit, delete, export, import, approve, assign, call, download, share, refund, cancel, configure`.

### 1.3 Seeded system roles (editable copies; originals locked)

| Permission | Company Admin | Branch Admin | Sales Mgr | Sales Exec | Telecaller Mgr | Telecaller | Accountant |
|---|---|---|---|---|---|---|---|
| lead.view | all | branch | team | own | team | own | — |
| lead.create | all | branch | team | own | team | own | — |
| lead.assign | all | branch | team | — | team | — | — |
| lead.delete | all | branch | — | — | — | — | — |
| lead.export | all | branch | team | — | — | — | — |
| lead.import | all | branch | team | — | team | — | — |
| call.make | all | branch | team | own | team | own | — |
| call.recording.listen | all | branch | team | own | team | own | — |
| deal.view/edit | all | branch | team | own | — | — | view all |
| quotation.create | all | branch | team | own | — | — | — |
| quotation.approve (discount > limit) | all | branch | team | — | — | — | — |
| invoice.view | all | branch | team | own | — | — | all |
| invoice.create/edit | all | branch | — | — | — | — | all |
| invoice.cancel | all | — | — | — | — | — | all |
| payment.record | all | branch | — | — | — | — | all |
| report.revenue.view | all | branch | team | — | — | — | all |
| settings.configure | all | — | — | — | — | — | — |
| billing.manage | all | — | — | — | — | — | — |
| user.manage | all | branch | — | — | — | — | — |

### 1.4 Screens

| # | Screen | Key elements |
|---|---|---|
| S-1 | Sign up | Name, email, phone, password, company name → creates tenant (trial), admin membership |
| S-2 | Onboarding wizard | Step 1 business type (§4) → Step 2 branches → Step 3 invite team (email/CSV) → Step 4 import leads (CSV) → Step 5 connect telephony (skippable). Business type writes `tenant_modules` defaults. |
| S-3 | Login | Email/phone + password **or** phone OTP; 2FA (TOTP) challenge if enabled; tenant picker if >1 membership |
| S-4 | Forgot / reset password | Email link (30-min, single-use) |
| S-5 | My security | Enable 2FA (QR + 10 recovery codes), active sessions list with **Revoke**, login history |
| S-6 | Users | Table: name, role, branch, team, status, last login. Buttons: **Invite**, **Disable**, **Reset 2FA**, **Change role** |
| S-7 | Roles & permissions | Role list → matrix (rows: permissions grouped by module; cols: scope dropdown). **Clone role**, **Save** |
| S-8 | Branches / Departments / Teams | CRUD; team member drag-in |
| S-9 | Custom fields | Per entity; add/reorder/required |
| S-10 | Audit log | Filter by user, entity, date; diff view (before/after) |
| S-11 | API keys | Create (shown once), scopes, revoke |

### 1.5 APIs

```
POST   /auth/signup                       → {tenant, user, tokens}
POST   /auth/login                        {email|phone, password} → tokens | {mfa_required, mfa_token}
POST   /auth/otp/request                  {phone, purpose}
POST   /auth/otp/verify                   {phone, code} → tokens
POST   /auth/mfa/verify                   {mfa_token, code}
POST   /auth/refresh                      (httpOnly cookie, rotating refresh tokens, reuse detection)
POST   /auth/logout
POST   /auth/password/forgot | /auth/password/reset
POST   /auth/switch-tenant                {tenant_id}
GET    /me                                → user, membership, effective permissions (for UI gating)
POST   /me/mfa/setup | /me/mfa/enable | /me/mfa/disable
GET    /me/sessions          DELETE /me/sessions/:id
GET    /users   POST /users/invite   PATCH /users/:id   POST /users/:id/disable
GET    /roles   POST /roles   PATCH /roles/:id   GET /permissions
CRUD   /branches  /departments  /teams  /custom-fields  /api-keys
GET    /audit-logs
```

Access token: JWT, 15 min, claims `{sub, tid, mid, rv}` (`rv` = role version, bumped on permission change so stale tokens are rejected). Rate limits: login 5/min/IP+account, OTP 3/10 min/phone.

---

## 2. CRM — Leads, Contacts, Companies (§11–12)

### 2.1 Tables

```
companies   [std] name, industry, website, gstin, phone, email, billing_address JSONB,
            shipping_address JSONB, owner_id, tags TEXT[], custom JSONB
contacts    [std] company_id NULL, first_name, last_name, phone_e164, alt_phone, email,
            whatsapp_e164, designation, is_customer BOOL, customer_since, owner_id,
            dnd BOOL, consent_call BOOL, consent_whatsapp BOOL, consent_source, consent_at,
            tags TEXT[], custom JSONB
leads       [std] number ('LD-00042'), name, company_name, phone_e164, email, whatsapp_e164,
            source ENUM(website, google_ads, facebook, instagram, whatsapp, referral, manual,
                        import, api, campaign, phone, landing_page),
            campaign, source_meta JSONB (utm_*, form_id, ad_id),
            product_interest_ids UUID[], budget_minor BIGINT, location_city, location_state,
            language, priority ENUM(low, medium, high, urgent),
            status ENUM(new, contacted, qualified, unqualified, converted, lost),
            lost_reason_id NULL, owner_id NULL, assigned_at, first_response_at,
            next_followup_at, last_activity_at, score SMALLINT NULL, score_band
            ENUM(hot, warm, cold) NULL, converted_contact_id, converted_deal_id,
            duplicate_of_id NULL, tags TEXT[], custom JSONB
            INDEX (tenant_id, owner_id, status), (tenant_id, phone_e164), (tenant_id, next_followup_at)
lost_reasons [std] label
activities  [std] entity_type (lead|contact|company|deal), entity_id,
            type ENUM(note, call, email, whatsapp, sms, meeting, status_change, system),
            body TEXT, meta JSONB, ref_type/ref_id (e.g. call_log id), occurred_at
            -- the unified timeline (§48, §51)
followups   [std] entity_type, entity_id, assignee_id, due_at, type ENUM(call, meeting,
            email, whatsapp, task), note, status ENUM(pending, done, missed, cancelled),
            completed_at, outcome
attachments [std] entity_type, entity_id, file_key, name, mime, size
```

**Duplicate detection:** on create/import, match on normalised `phone_e164` or lower(email) within tenant → set `duplicate_of_id`, show banner "Possible duplicate of LD-00031 — Merge / Keep both".

### 2.2 Screens

| # | Screen | Elements |
|---|---|---|
| S-20 | Leads list | Saved views (My leads, Unassigned, Hot, Follow-up today, Overdue); columns configurable; filters (status, source, owner, branch, score band, created, next follow-up, tags, custom fields); bulk: **Assign**, **Change status**, **Add tag**, **Export**, **Delete**. Row quick actions: 📞 **Call**, ✏️, **Add follow-up** |
| S-21 | Lead create/edit drawer | Fields from §2.1 + custom fields; phone normalised to E.164 on blur; live duplicate check |
| S-22 | Lead detail | Header: name, score badge, status chip, owner, **Call**, **Convert**, **Mark lost**. Left: fields. Centre: timeline (activities) + composer (Note / Log call / Follow-up). Right: follow-ups, deals, attachments, `→ AI` "Next best action" card (placeholder in MVP, shows rule-based suggestion) |
| S-23 | Import leads | Upload CSV/XLSX → column mapping → dedupe strategy (skip / update / create) → assignment (rule engine / specific user / unassigned) → preview 20 rows → run (async job, progress, error-file download) |
| S-24 | Convert lead | Creates/links company + contact; optional deal (pipeline, stage, value). Lead → `converted` |
| S-25 | Contacts / Companies list + detail | Detail = early **Customer 360** (§51): profile, timeline, deals, quotations, invoices, payments, outstanding |
| S-26 | Follow-ups ("My day") | Today / Overdue / Upcoming tabs, one-click **Call** & **Done** with outcome |

### 2.3 APIs

```
GET    /leads            POST /leads          GET/PATCH/DELETE /leads/:id
POST   /leads/bulk        {ids[], op: assign|status|tag|delete, payload}
POST   /leads/import      multipart → {job_id}    GET /jobs/:id
POST   /leads/export      {filter} → {job_id}  (async, emailed link, audited)
POST   /leads/:id/convert {create_company, create_deal, deal:{...}}
POST   /leads/:id/lost    {reason_id, note}
POST   /leads/:id/merge   {into_id}
GET    /leads/:id/timeline
POST   /public/leads      (API-key or form token; for website/landing page/ad webhooks)
CRUD   /contacts  /companies  /followups  /activities  /lost-reasons
GET    /contacts/:id/360
```

Events: `lead.created, lead.updated, lead.assigned, lead.status_changed, lead.converted, lead.lost, followup.due, followup.missed`.

### 2.4 Lead status workflow

```
new ──(first call/msg logged)──▶ contacted ──▶ qualified ──(convert)──▶ converted
  │                                  │              │
  └──────────────▶ unqualified ◀─────┘              └──▶ lost (reason required)
any non-terminal ──▶ lost          lost/unqualified ──(reopen, mgr)──▶ contacted
```
`first_response_at` is set on the first outbound activity → feeds "lead response time" KPI (§103).

---

## 3. Lead Assignment Engine (§13)

### 3.1 Tables

```
assignment_rules  [std] name, priority INT, is_active,
                  conditions JSONB   -- [{field:'location_city', op:'in', value:['Delhi']},
                                     --  {field:'language', op:'eq', value:'hi'}]
                  target_type ENUM(user, team, branch), target_id,
                  strategy ENUM(round_robin, least_workload, weighted, specific_user),
                  respect_availability BOOL, respect_business_hours BOOL,
                  max_open_leads_per_user INT NULL, fallback_user_id NULL
assignment_state  tenant_id, rule_id, last_assigned_membership_id   -- round-robin cursor
assignment_log    [std] lead_id, rule_id NULL, assigned_to, reason TEXT, by(system/user)
business_hours    [std] branch_id NULL, weekday, open_time, close_time, holidays DATE[]
```

### 3.2 Algorithm (runs in worker on `lead.created` and on manual "Re-run rules")

1. Load active rules ordered by `priority`; first rule whose all conditions match wins.
2. Candidate pool = members of target (team/branch) with `lead.view` permission and `is_available = true` (if flag), not on break (dialer status), under `max_open_leads_per_user`.
3. Filter by skill/language if lead has them and the rule asks.
4. Strategy:
   - **round_robin**: next after cursor, cursor updated with `SELECT … FOR UPDATE` (no double-assign under concurrency).
   - **least_workload**: min(count of open leads + pending follow-ups today).
5. Empty pool → `fallback_user_id` → else leave unassigned and notify team manager.
6. Write `owner_id`, `assigned_at`, `assignment_log`, emit `lead.assigned`, notify assignee (in-app + push).

### 3.3 Screens / APIs
- **S-30 Assignment rules**: ordered list (drag to reprioritise), rule builder (condition rows + target + strategy), **Test rule** (paste sample lead → shows who would get it and why).
- `CRUD /assignment-rules`, `POST /assignment-rules/test`, `POST /leads/:id/reassign {user_id | rerun:true}`.
- SLA (MVP-lite): if `first_response_at` is null N minutes after assignment → notify manager (configurable N). `→ P1` becomes a full automation.

---

## 4. Calling & Power Dialer (§16–18)

MVP = **click-to-call via cloud telephony bridge** + **power (sequential) dialer**. Predictive dialing and AI calling are out of scope.

### 4.1 Provider abstraction

```ts
interface TelephonyProvider {
  placeCall(p: { agentNumber; customerNumber; callerId; callbackUrl; recording: boolean; metadata }): Promise<{ providerCallId }>;
  parseWebhook(req): CallEvent;          // ringing | answered | completed | failed | recording_ready
  fetchRecording(providerCallId): Promise<Stream>;
  verifyWebhookSignature(req): boolean;
}
```
Implement one Indian provider first (Exotel / Knowlarity / Ozonetel class — choose by commercial terms) + a `MockProvider` for dev/demo/trial ("Calling demo", §83). Agent's phone rings first, then the customer → works with any mobile, no softphone needed in MVP. Number masking comes free: customer sees the virtual number (§16).

### 4.2 Tables

```
telephony_accounts [std] provider, credentials_enc JSONB, is_active
phone_numbers      [std] e164, provider_account_id, branch_id, purpose(outbound/inbound/both)
agent_phones       [std] membership_id, e164, verified_at
call_logs          [std] provider_call_id UNIQUE, direction(in/out), from_e164, to_e164,
                   agent_membership_id, lead_id NULL, contact_id NULL, campaign_id NULL,
                   status ENUM(initiated, ringing_agent, ringing_customer, in_progress,
                   completed, no_answer, busy, failed, cancelled),
                   started_at, answered_at, ended_at, ring_seconds, talk_seconds,
                   recording_key NULL, disposition_id NULL, notes, callback_at NULL,
                   provider_cost_minor, raw JSONB
                   -- → AI: transcript_key, summary, sentiment, qa_score (P3, nullable columns now)
dispositions       [std] label, key, category ENUM(connected_positive, connected_negative,
                   not_connected, invalid), requires_callback BOOL, sets_lead_status NULL,
                   is_system BOOL
                   -- seeds: Interested, Not Interested, Busy, No Answer, Call Back, Converted,
                   --        Wrong Number, Follow-up Required
dialer_campaigns   [std] name, status(draft/active/paused/done), lead_filter JSONB,
                   member_ids UUID[], calling_window JSONB {start:'09:00', end:'21:00'},
                   max_attempts INT, retry_gap_minutes INT
dialer_queue       [std] campaign_id, lead_id, attempts, next_attempt_at, locked_by NULL,
                   locked_at NULL, state(pending/locked/done/exhausted)
agent_status       tenant_id, membership_id PK, state(offline/available/on_call/wrap_up/break),
                   break_reason, since
dnd_registry       tenant_id, e164, source(manual/opt_out/ncpr), added_at
```

### 4.3 Compliance gates (enforced server-side before `placeCall`, §18)

1. Number in tenant `dnd_registry` or contact `dnd = true` → block (`CALL_BLOCKED_DND`).
2. Outside tenant's calling window in the **customer's** timezone (default 09:00–21:00 IST) → block.
3. Every block/allow decision written to `audit_logs` (compliance log).
4. Disposition "Not interested — do not call" adds to `dnd_registry` (opt-out handling).
5. Recording: announce-recording flag on provider; recording access requires `call.recording.listen` and is audited.

### 4.4 Click-to-call flow

```
UI "Call" ─POST /calls─▶ API: permission(call.make, scope on lead) → compliance gates
  → call_logs(initiated) → provider.placeCall → 202 {call_id}
Provider webhooks ─▶ /webhooks/telephony/:provider (signature verified, idempotent on provider_call_id+event)
  → update status/timestamps → push to agent via WebSocket
completed ─▶ UI forces Disposition modal (cannot start next call until saved, configurable)
disposition saved ─▶ activity on timeline, lead.status updated if disposition maps,
  follow-up created if requires_callback, lead.first_response_at set,
  recording fetched async → object storage (S3 key per tenant prefix)
emit call.completed
```

### 4.5 Power dialer flow

```
Agent clicks "Start session" on campaign → agent_status=available
Worker: SELECT next dialer_queue row WHERE campaign, state=pending, next_attempt_at<=now
        FOR UPDATE SKIP LOCKED  → locked_by=agent
        → compliance gates (skip + mark if blocked) → placeCall
Agent sees lead card (details + last 5 activities) while ringing
Call ends → disposition (mandatory) → wrap-up timer (configurable 0–60s)
        → no_answer/busy: attempts++, next_attempt_at = now + retry_gap (until max_attempts)
        → else state=done
Auto-next after wrap-up unless agent pressed Break / Stop
```

### 4.6 Screens

| # | Screen | Elements |
|---|---|---|
| S-40 | Call widget (global, bottom-right) | Status, timer, customer name, **Hang up** (provider permitting), notes box, disposition picker |
| S-41 | Dialer session | Campaign selector, **Start / Break (reason) / Stop**, current lead card, script panel (static text per campaign), queue counter, today's stats (calls, connected, talk time) |
| S-42 | Dialer campaigns (manager) | Create from lead filter, assign agents, calling window, retries; live board: agents × state |
| S-43 | Call logs | Filters (agent, disposition, date, direction, duration > x); recording player |
| S-44 | Telephony settings | Provider creds, numbers, agent phone verification (OTP to agent mobile), dispositions editor, DND list (add/import/remove) |

### 4.7 APIs

```
POST  /calls                 {lead_id|contact_id, phone_override?}  (Idempotency-Key)
GET   /calls   GET /calls/:id   PATCH /calls/:id/disposition {disposition_id, notes, callback_at}
GET   /calls/:id/recording   → short-lived signed URL (audited)
POST  /webhooks/telephony/:provider
CRUD  /dialer/campaigns   POST /dialer/campaigns/:id/{start|pause}
POST  /dialer/session/start {campaign_id}  /dialer/session/next  /dialer/session/break  /dialer/session/stop
CRUD  /dispositions  /dnd  /phone-numbers  /agent-phones
WS    /realtime  (channels: call:{id}, agent:{membership_id}, campaign:{id})
```

---

## 5. Sales Pipeline (§22)

### 5.1 Tables

```
pipelines      [std] name, is_default
pipeline_stages[std] pipeline_id, name, order, probability SMALLINT, type ENUM(open, won, lost)
               -- seed: New, Contacted, Qualified, Demo, Quotation, Negotiation, Won, Lost
deals          [std] number, title, pipeline_id, stage_id, contact_id, company_id, lead_id NULL,
               owner_id, amount_minor, currency, expected_close_date, closed_at,
               lost_reason_id NULL, stage_entered_at, tags, custom JSONB
deal_stage_history [std] deal_id, from_stage_id, to_stage_id, at, by
```

### 5.2 Screens
- **S-50 Pipeline Kanban**: columns = stages with count & sum; drag card → stage (moving to *Lost* requires reason; *Won* sets `closed_at`); filters owner/branch/date; toggle **List / Calendar (by expected close) / Analytics** (§22 views).
- **S-51 Deal detail**: same layout as lead detail + linked quotations, **Create quotation**.
- **S-52 Pipeline settings**: stages, probabilities, multiple pipelines.

### 5.3 APIs
`CRUD /pipelines /deals`, `POST /deals/:id/move {stage_id, lost_reason_id?}`, `GET /deals/board?pipeline_id=` (grouped, totals).
Events: `deal.created, deal.stage_changed, deal.won, deal.lost`.

---

## 6. Products (minimal, required by quotations/invoices — §25)

```
product_categories [std] name, parent_id
taxes              [std] name ('GST 18%'), rate_bp INT (1800 = 18.00%), type ENUM(gst, cess, other)
products           [std] sku UNIQUE(tenant), name, type ENUM(goods, service), category_id,
                   unit ('pcs','kg','hr'), hsn_sac, selling_price_minor, purchase_price_minor,
                   tax_id, is_tax_inclusive BOOL, description, image_keys TEXT[], is_active,
                   custom JSONB
                   -- → P1: track_inventory BOOL, min_stock, barcode, batch/serial flags
```
Screens: **S-60 Products list** (import CSV), **S-61 Product form**. APIs: `CRUD /products /product-categories /taxes`.

---

## 7. Quotations (§23)

### 7.1 Tables

```
quotations      [std] number ('QT/2026-27/0007'), deal_id NULL, contact_id, company_id NULL,
                status ENUM(draft, pending_approval, approved, sent, viewed, accepted, rejected,
                            expired, converted, cancelled),
                issue_date, valid_until, currency, place_of_supply_state,
                subtotal_minor, discount_minor, tax_minor, round_off_minor, total_minor,
                terms TEXT, notes TEXT, version INT, parent_quotation_id NULL (revisions),
                public_token (random 32 bytes, for customer link), viewed_at, view_count,
                accepted_at, accepted_by_name, accepted_ip, signature_key NULL,
                pdf_key NULL, custom JSONB
quotation_items [std] quotation_id, product_id NULL, description, hsn_sac, qty, unit,
                unit_price_minor, discount_bp, discount_minor, tax_id, tax_rate_bp,
                cgst_minor, sgst_minor, igst_minor, line_total_minor, order
approval_requests [std] entity_type, entity_id, reason, requested_by, approver_id NULL,
                  approver_role_id NULL, status(pending/approved/rejected), decided_at, comment
                  -- generic; reused by §66 approval engine later
discount_policies [std] role_id, max_discount_bp     -- e.g. Sales Exec 1000 = 10%
```

### 7.2 Calculation rules (single shared `pricing` module used by quotation AND invoice)
- Line: `gross = qty × unit_price`; `disc = gross × discount_bp/10000` (or absolute); `taxable = gross − disc`.
- GST: if seller branch `state_code == place_of_supply_state` → CGST = SGST = rate/2; else IGST = rate.
- Round each tax component per line to paise (banker's rounding off; use half-up); `round_off` brings total to nearest rupee (tenant setting).
- Computed **server-side only**; client preview uses the same TS package (shared lib) for parity.

### 7.3 Workflow

```
draft ─(submit)─▶ [any line or overall discount > role's max?] ─yes─▶ pending_approval ─▶ approved | rejected(→draft)
                                                               └─no──▶ approved
approved ─(send: email / WhatsApp link → P1 / copy link)─▶ sent ─(customer opens link)─▶ viewed
viewed/sent ─(customer clicks Accept + types name + optional draw signature)─▶ accepted
            ─(customer Reject + reason)─▶ rejected
valid_until passed (nightly job) ─▶ expired
accepted ─(Convert)─▶ converted → creates Invoice draft (MVP) / Sales Order (→ P1)
Edit after sent ⇒ new version (parent_quotation_id), old one locked.
```
Acceptance stores name, IP, user-agent, timestamp, document hash of PDF → evidence record (§67 lite e-signature).

### 7.4 Screens
- **S-70 Quotations list** (status tabs, totals).
- **S-71 Quotation editor**: customer picker, line-item grid (product search, qty, price, disc, tax auto), totals panel with GST split, terms (template), validity; buttons **Save draft · Submit · Preview PDF · Send · Duplicate · New version · Convert to invoice**.
- **S-72 Public quotation page** `/q/:token`: branded, PDF download, **Accept / Reject**; view tracking (feeds lead scoring later — §14 "quotation views").
- **S-73 Approvals inbox** (shared across modules).

### 7.5 APIs
```
CRUD /quotations   POST /quotations/:id/{submit|send|duplicate|revise|cancel|convert}
GET  /quotations/:id/pdf
POST /approvals/:id/{approve|reject}   GET /approvals?status=pending&mine=true
GET  /public/quotations/:token   POST /public/quotations/:token/{accept|reject}   (rate-limited)
```
Events: `quotation.created, quotation.sent, quotation.viewed, quotation.accepted, quotation.rejected`.

PDF: HTML template (per tenant, logo/colours) → headless Chromium in a worker → S3; regenerated on change.

---

## 8. Invoices & Payment Recording (§30–31, MVP subset)

MVP records payments manually and generates a payment link (single gateway, e.g. Razorpay). Reconciliation, refunds, credit/debit notes, recurring invoices → P1.

### 8.1 Tables

```
invoices      [std] number (gapless per branch per FY), quotation_id NULL, deal_id NULL,
              contact_id, company_id, billing_address JSONB, shipping_address JSONB,
              seller_gstin, buyer_gstin, place_of_supply_state, issue_date, due_date,
              payment_terms_days, status ENUM(draft, issued, partially_paid, paid, overdue, cancelled),
              subtotal_minor, discount_minor, tax_minor, round_off_minor, total_minor,
              amount_paid_minor, balance_minor, cancelled_reason, cancelled_at,
              public_token, pdf_key, custom JSONB
              -- number assigned ONLY at draft → issued (drafts have no number → no gaps)
invoice_items (same shape as quotation_items)
payments      [std] number, contact_id, amount_minor, method ENUM(cash, bank_transfer, upi,
              cheque, card, gateway), reference, received_on, gateway_payment_id NULL,
              status(recorded/void), notes
payment_allocations [std] payment_id, invoice_id, amount_minor
payment_links [std] invoice_id, gateway, gateway_link_id, url, status, expires_at
reminder_schedules [std] offsets_days INT[] DEFAULT '{-3,0,3,7}', channels TEXT[] DEFAULT '{email}'
```

### 8.2 Workflow

```
draft ─(issue: assigns number, locks lines, generates PDF)─▶ issued
issued ─(payment allocated < balance)─▶ partially_paid ─(balance 0)─▶ paid
issued/partially_paid ─(nightly: due_date < today and balance>0)─▶ overdue
issued/partially_paid/overdue ─(cancel: invoice.cancel + reason; only if no payments,
                                 else void payments first)─▶ cancelled   (number retained)
Gateway webhook (payment.captured) → create payment + allocation → status recompute (idempotent on gateway_payment_id)
Reminder job daily per tenant TZ: offsets −3, 0, +3, +7 days → email (WhatsApp → P1)
```
Issued invoices are immutable; corrections = cancel + reissue (credit note → P1).

### 8.3 Screens
- **S-80 Invoices list**: tabs Draft/Unpaid/Overdue/Paid/Cancelled, totals bar (outstanding, overdue).
- **S-81 Invoice editor** (same grid as quotation) — **Issue · Send · Record payment · Payment link · Cancel · Download PDF**.
- **S-82 Record payment modal**: amount, method, date, reference, allocate across multiple open invoices of the customer.
- **S-83 Receivables**: by customer, ageing buckets 0–30 / 31–60 / 61–90 / 90+.
- **S-84 Public invoice page** `/i/:token`: PDF + **Pay now**.
- **S-85 Invoice settings**: numbering prefix, terms, bank/UPI details on PDF, reminder schedule, gateway keys.

### 8.4 APIs
```
CRUD /invoices   POST /invoices/:id/{issue|send|cancel|payment-link}   GET /invoices/:id/pdf
CRUD /payments   POST /payments (with allocations[])   POST /payments/:id/void
GET  /receivables/ageing
POST /webhooks/payments/:gateway
GET  /public/invoices/:token
```
Events: `invoice.created, invoice.issued, invoice.overdue, invoice.paid, payment.received`.

---

## 9. Dashboard & Basic Reports (§10, §74)

### 9.1 Approach
- MVP: SQL over OLTP with **materialised daily rollups** (`daily_metrics(tenant_id, branch_id, membership_id, date, metric, value)`) refreshed by a worker every 15 min + on-demand for "today".
- Widgets are permission-filtered: a telecaller's dashboard never queries revenue (permission `report.revenue.view`).

### 9.2 Role dashboards

| Role | Widgets |
|---|---|
| Admin / Branch Admin | Revenue (invoiced, collected), new leads, conversion %, calls (total/connected/talk time), follow-ups due/overdue, outstanding & overdue receivables, deals by stage, top performers; branch filter + compare period |
| Sales Mgr / Telecaller Mgr | Team leaderboard (calls, connected %, talk time, conversions), unassigned leads, uncontacted leads > SLA, follow-ups overdue by agent |
| Sales Exec / Telecaller | My calls today vs target, my follow-ups today, my hot leads, my conversions this month |
| Accountant | Invoiced vs collected, ageing, overdue list, payments today |

**AI Business Summary card** (§10): in MVP render a **rule-based summary** from the same rollups ("17 hot leads have no follow-up", "₹2.1 L overdue"). The card's data contract (`insights[]: {severity, text, metric_refs, action}`) is what the LLM version will fill in P3 — no UI change needed later.

### 9.3 Reports (each: filters date/branch/team/user, table + chart, CSV export with `*.export` permission)
1. Leads by source / status / owner, conversion funnel
2. Lead response time (median `first_response_at − created_at`)
3. Calls by agent: dialled, connected, connection %, talk time, avg handle time, dispositions
4. Pipeline: value by stage, win rate, avg deal cycle
5. Quotations: sent, accepted %, value
6. Sales: invoiced by customer / product / salesperson / branch
7. Receivables ageing; collections

APIs: `GET /dashboard?role_view=`, `GET /reports/:key?filters`, `POST /reports/:key/export`.

---

## 10. Subscription & Tenant Billing (§81–83, §86–87)

### 10.1 Tables (platform-level, **no RLS tenant filter**, accessed only by billing module / super admin)

```
plans           id, key (starter/business/professional/enterprise), name, price_monthly_minor,
                price_yearly_minor, per_user BOOL, included_users, is_public
plan_features   plan_id, feature_key ('module.calling', 'module.dialer', 'api.access'),
                limit_value NULL   -- e.g. 'users': 5, 'call_minutes': 1000, 'storage_gb': 10
tenant_modules  tenant_id, module_key, enabled BOOL, source(plan/business_type/override)
subscriptions   id, tenant_id, plan_id, status ENUM(trialing, active, past_due, grace,
                restricted, suspended, cancelled), billing_cycle, seats, current_period_start,
                current_period_end, gateway_subscription_id, cancel_at_period_end
usage_counters  tenant_id, meter ('call_minutes','users','storage_bytes','api_requests'),
                period_start, value BIGINT       -- incremented via worker, not request path
platform_invoices id, tenant_id, period, amount_minor, tax_minor, status, gateway_invoice_id, pdf_key
platform_admin_access_log id, admin_id, tenant_id, reason, at   -- §87 "access should be logged"
```

### 10.2 Entitlement check
`@Feature('module.dialer')` guard + `usage.assertWithin('call_minutes')` before placing calls. Results cached in Redis per tenant (60 s), busted on plan change. Calling minutes are **metered, not unlimited** (§82).

### 10.3 Trial lifecycle (daily job, §83)

```
signup → trialing (14 d, Business-plan features + MockProvider calling demo)
T-3, T-1 days: email + in-app banner
trial end, no payment → grace (7 d, full access, sticky banner)
grace end → restricted (read-only + export; no calls, no new records)
+30 d → suspended (login shows "reactivate" only); data retained 90 d then deletion notice
payment at any point → active
```

### 10.4 Screens
- **S-100 Billing (tenant admin)**: current plan, seats, usage meters with bars, **Upgrade / Change plan / Add seats**, invoices, payment method.
- **S-101 Super Admin console** (separate app/subdomain, separate auth + mandatory 2FA): tenants list (status, plan, MRR, users, last active), tenant detail (usage, subscription, **Suspend / Extend trial / Override module**), plans & features editor, platform KPIs (MRR, ARR, trial→paid, churn, call minutes). **No access to tenant business data** in MVP; impersonation deferred and, when built, requires reason + logged.

### 10.5 APIs
```
GET /billing/subscription   POST /billing/checkout {plan_id, cycle, seats}   GET /billing/usage
POST /webhooks/billing/:gateway
/platform/* (super admin): tenants, plans, features, metrics
```

---

## 11. Notifications (MVP subset of §69)

```
notifications [std] recipient_membership_id, type, title, body, entity_type, entity_id,
              read_at, channels_sent TEXT[]
notification_prefs  membership_id, type, channels TEXT[]
```
Types in MVP: lead assigned, follow-up due (15 min before), follow-up missed, approval requested/decided, quotation viewed/accepted, payment received, invoice overdue, SLA breach.
Channels: in-app (WebSocket + bell), email, mobile push (via the PWA/web-push in MVP).
API: `GET /notifications`, `POST /notifications/read {ids|all}`, `GET/PUT /me/notification-prefs`.

---

## 12. Mobile in MVP

P0 does not include native apps (§101 puts "Mobile app" at P1). Ship the web app as a **responsive PWA** with priority layouts for: Leads list, Lead detail, Call button, Disposition modal, Follow-ups "My day", Notifications. Click-to-call bridge rings the telecaller's own mobile, so telecallers are fully productive from a phone without a native app.

---

## 13. AI Seams to Build Now (cheap, unblock P3)

| Seam | What to build in MVP | Used later by |
|---|---|---|
| Event outbox | §0 — every domain event stored | Business Brain, automation, anomaly detection |
| Unified timeline (`activities`) | §2 | Customer 360 summary, next best action |
| `actor_type = 'ai'` in audit logs + `ai` system user per tenant | §1 | AI action audit (§93) |
| Nullable AI columns on `call_logs` (`transcript_key, summary, sentiment, qa_score`) and `leads` (`score, score_band`) | §2, §4 | Call summary/QA, lead scoring |
| Rule-based lead score v0 (source weight + activity count + quotation viewed + recency) written to `leads.score` | Nightly job | Replaced by ML/LLM scoring, same column |
| `insights` contract on dashboard | §9 | AI Business Summary |
| `approval_requests` generic table | §7 | High-risk AI actions require approval (§55) |
| Permission guard is the only data-access path | §1 | AI tool calls inherit RBAC |
| `ai_usage(tenant_id, user_id, module, model, input_tokens, output_tokens, cost_minor, at)` table (empty) | — | §97 cost tracking |

---

## 14. Non-Functional Requirements (MVP targets)

| Item | Target |
|---|---|
| p95 API latency (list/detail) | < 300 ms at 1M leads/tenant |
| Click-to-call initiate | < 1.5 s to provider request |
| Availability | 99.5 % (MVP), single region (Mumbai) for data residency |
| Backups | Postgres PITR 7 days + daily snapshot 30 days; S3 versioning; restore drill monthly |
| Security | TLS 1.2+, AES-256 at rest (managed), secrets in KMS/secret manager, provider creds encrypted at app layer, OWASP ASVS L2 checklist, dependency scanning in CI |
| Tenant isolation tests | Automated suite: for every endpoint, user of tenant A requesting tenant B's IDs must get 404. Runs in CI; release blocker. |
| Data export | Tenant admin can export all data (CSV/JSON zip) — supports "Restricted" state and offboarding |
| Observability | Structured logs with `tenant_id, request_id`; OpenTelemetry traces; error tracking; per-tenant queue lag metrics |
| Privacy | DPDP Act 2023 (India) alignment: consent fields, purpose, deletion workflow; TRAI/TCCCPR for commercial calling (DND, calling hours) |

---

## 15. Suggested Repository Layout

```
apps/
  web/            Next.js (tenant app + public quote/invoice pages)
  admin/          Next.js (super admin)
  api/            NestJS (HTTP + WebSocket)
  worker/         NestJS standalone (BullMQ consumers, cron)
packages/
  db/             Prisma schema, migrations, RLS SQL, seeds (roles, permissions, dispositions, stages, taxes)
  pricing/        shared GST/totals engine (used by api + web)
  contracts/      zod schemas / OpenAPI types shared FE↔BE
  ui/             component library (shadcn/ui on Tailwind)
  telephony/      provider adapters + MockProvider
  pdf/            HTML templates
```
Backend modules map 1:1 to §91: `auth, tenants, org (branches/departments/teams), users, rbac, crm (leads/contacts/companies/activities/followups), assignment, calling (telephony/dialer/dispositions/dnd), sales (pipelines/deals), catalog (products/taxes), quotations, invoicing (invoices/payments), approvals, notifications, reports, billing, platform, audit, files, events (outbox)`.

---

## 16. Build Plan (≈ 6 × 2-week sprints, team of 4–5: 2 BE, 2 FE, 1 full-stack/QA)

| Sprint | Deliverable | Exit criteria |
|---|---|---|
| 1 | Monorepo, CI, Postgres+RLS, auth (password, OTP, 2FA, sessions), tenants, signup/onboarding shell, audit interceptor, outbox | Isolation test suite green; can sign up and invite a user |
| 2 | RBAC with scopes, roles UI, branches/teams, custom fields, leads CRUD + list views + import/export + dedupe, timeline, follow-ups | Telecaller sees only own leads (tested) |
| 3 | Assignment engine, notifications (in-app + email), telephony adapter + Mock, click-to-call, webhooks, dispositions, recordings, DND/calling-hour gates | Real call placed end-to-end on chosen provider |
| 4 | Power dialer (queue, session, wrap-up, retries), agent status board, pipelines/deals Kanban, products/taxes, pricing package | One agent can run 100 calls in a session without touching the mouse except dispositions |
| 5 | Quotations (editor, approval, PDF, public accept), invoices (issue, numbering, PDF, payment record, payment link, reminders), receivables ageing | GST math verified against 30 golden test cases (intra/inter-state, discounts, round-off) |
| 6 | Dashboards per role, 7 reports, billing (plans, checkout, entitlements, trial lifecycle), super admin console, PWA polish, load test, security review | Pilot with 5–10 businesses (§100 Phase 1 goal) |

---

## 17. Open Decisions (need product-owner input)

1. **Telephony provider** for launch (commercial terms, per-minute cost, recording retention) — blocks Sprint 3.
2. **Payment gateway** for both customer payment links and our own subscriptions (one vendor or two).
3. **E-invoicing (IRN/QR)** for tenants above the GST e-invoice turnover threshold — in MVP or P1? Affects invoice schema (add `irn, ack_no, signed_qr`).
4. **Pricing** for Starter/Business (per user vs per company) and included call minutes.
5. **Data residency** commitment (India-only hosting) for marketing claims.
6. Whether **WhatsApp quotation/invoice sending** should be pulled into MVP — it is P1 in the BRD but is often the #1 ask from Indian SMBs.
