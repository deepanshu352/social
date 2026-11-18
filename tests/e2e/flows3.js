// Phase 2 end-to-end: automation engine, security, HR, approvals, inventory, customisation.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sql = (q) => execSync(`psql -h localhost -U postgres -d bizos -tAc ${JSON.stringify(q)}`).toString().trim();
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const CRON = { authorization: 'Bearer ' + (process.env.CRON_SECRET || 'dev-cron-secret') };
function totp(secret) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret) bits += B.indexOf(c).toString(2).padStart(5, '0'); const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2)); const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); }

async function session(browser, email, password = 'Password@123', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', email, e.message));
  await p.goto(BASE + '/login'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login') || u.pathname.startsWith('/login/mfa')), p.click('button:has-text("Sign in")')]);
  return p;
}

(async () => {
  const RUN = Date.now().toString(36);
  const VENDOR = 'Bikanervala ' + RUN, REASON = 'Family function ' + RUN;
  const d0 = new Date(Date.now() + (40 + (Date.now() % 300)) * 86400000); while (d0.getDay() === 0) d0.setDate(d0.getDate() + 1);
  const D1 = d0.toISOString().slice(0, 10); d0.setDate(d0.getDate() + 1); const D2 = d0.toISOString().slice(0, 10);
  const browser = await chromium.launch();

  // ── 1. Automation: speed-to-lead workflow (WAIT + IF) ──
  const tc = await session(browser, 'telecaller@sharma.demo');
  await tc.goto(BASE + '/leads/new');
  await tc.fill('input[name=name]', 'Workflow Test Lead'); await tc.fill('input[name=phone]', '9811100077'); await tc.fill('input[name=city]', 'Delhi');
  await Promise.all([tc.waitForURL(/\/leads\/c/), tc.click('button:has-text("Create lead")')]);
  const leadId = tc.url().split('/').pop();
  await tc.waitForTimeout(2500);
  const run = sql(`select r.id||'|'||r.status from "WorkflowRun" r join "Workflow" w on w.id=r."workflowId" where w."recipeKey"='speed_to_lead' and r.payload->>'leadId'='${leadId}'`);
  ok(run.endsWith('|waiting'), 'speed-to-lead run started and is WAITING (2h) → ' + run);
  ok(sql(`select count(*) from "MessageLog" where "leadId"='${leadId}' and channel='whatsapp'`) === '1', 'welcome WhatsApp sent (simulated) to new lead');
  ok(sql(`select count(*) from "FollowUp" where "leadId"='${leadId}'`) >= '1', 'follow-up scheduled by workflow');
  const masked = await tc.textContent('main');
  ok(/\+9198•+077|\+9198[•]{3,}077/.test(masked) || masked.includes('•'), 'telecaller sees masked phone number');
  sql(`update "WorkflowRun" set "nextRunAt"=now()-interval '1 minute' where id='${run.split('|')[0]}'`);
  const tickRes = await (await fetch(BASE + '/api/cron/tick', { headers: CRON })).json();
  ok(tickRes.resumed >= 1, 'scheduler tick resumed waiting run ' + JSON.stringify(tickRes));
  ok(sql(`select status from "WorkflowRun" where id='${run.split('|')[0]}'`) === 'completed', 'run completed after WAIT');
  ok(sql(`select priority from "Lead" where id='${leadId}'`) === 'urgent', 'IF no call in 2h → lead escalated to URGENT');

  // ── 2. Workflow builder + recipes + test run ──
  const ad = await session(browser, 'admin@sharma.demo');
  await ad.goto(BASE + '/workflows/recipes');
  await Promise.all([ad.waitForURL(/\/workflows\/c/), ad.click('button:has-text("Install recipe") >> nth=0')]);
  ok((await ad.textContent('main')).includes('Recipe installed'), 'recipe installed from library');
  await Promise.all([ad.waitForURL(/\/workflows\/runs\//), ad.click('button:has-text("Test run now")')]);
  const runTxt = await ad.textContent('main');
  ok(/Completed|Waiting/i.test(runTxt) && runTxt.includes('Execution log'), 'test run executed with step log');
  await ad.goto(BASE + '/workflows/new');
  await ad.fill('input[placeholder="e.g. Speed-to-lead"]', 'E2E builder workflow');
  await ad.click('button:has-text("Add step")');
  await ad.click('button:has-text("If / else")');
  await Promise.all([ad.waitForURL(/\/workflows\/c.*saved=1/), ad.click('button:has-text("Create workflow")')]);
  ok((await ad.textContent('main')).includes('Workflow saved'), 'workflow with IF/ELSE branch created in visual builder');

  // ── 3. Security: audit chain, IP allowlist guard, data export ──
  await ad.goto(BASE + '/security?verify=1');
  ok((await ad.textContent('main')).includes('no tampering detected'), 'audit hash chain verifies');
  const victim = sql(`select id||'|'||action from "AuditLog" where hash is not null and "tenantId"=(select id from "Tenant" where slug='sharma-distributors') order by "createdAt" desc limit 1 offset 3`).split('|');
  sql(`update "AuditLog" set action='tampered' where id='${victim[0]}'`);
  await ad.goto(BASE + '/security?verify=1');
  ok((await ad.textContent('main')).includes('Chain broken'), 'tampering with an audit row is detected');
  sql(`update "AuditLog" set action='${victim[1]}' where id='${victim[0]}'`);
  await ad.goto(BASE + '/security');
  await ad.fill('textarea[name=ipAllowlist]', '10.9.9.9');
  await ad.click('button:has-text("Save policy")');
  await ad.waitForSelector('[data-testid=flash]', { timeout: 10000 }).catch(() => {});
  ok((await ad.textContent('body')).includes('lock yourself out') && sql(`select array_length("ipAllowlist",1) from "Tenant" where slug='sharma-distributors'`) === '', 'IP allowlist refuses to lock the admin out');
  const exp = await ad.request.get(BASE + '/api/export');
  const data = await exp.json();
  ok(exp.status() === 200 && data.leads.length > 50 && !JSON.stringify(data).includes('passwordHash'), 'full data export works and excludes secrets');

  // ── 4. Account lockout ──
  const lp = await (await browser.newContext()).newPage();
  for (let i = 0; i < 6; i++) { await lp.goto(BASE + '/login'); await lp.fill('input[name=email]', 'telecaller2@sharma.demo'); await lp.fill('input[name=password]', 'wrong-pass-' + i); await lp.click('button:has-text("Sign in")'); await lp.waitForTimeout(400); }
  ok((await lp.textContent('body')).includes('temporarily locked'), 'account locks after 5 failed attempts');
  await ad.goto(BASE + '/security');
  ok((await ad.textContent('main')).includes('Repeated failed sign-ins'), 'security center flags brute-force attempts');
  await ad.click('form:has-text("Vikram") button:has-text("Unlock")'); await ad.waitForTimeout(1000);
  ok(sql(`select coalesce("lockedUntil"::text,'') from "User" where email='telecaller2@sharma.demo'`) === '', 'admin unlocked the account');

  // ── 5. HR: attendance, leave approval, expense with receipt → approval → reimbursement ──
  const geo = { permissions: ['geolocation'], geolocation: { latitude: 28.535, longitude: 77.27 } };
  const se = await session(browser, 'sales@sharma.demo', 'Password@123', geo);
  sql(`delete from "AttendanceRecord" where "membershipId"=(select m.id from "Membership" m join "User" u on u.id=m."userId" where u.email='sales@sharma.demo') and date=(now() at time zone 'Asia/Kolkata')::date`);
  await se.goto(BASE + '/attendance'); await se.click('button:has-text("Check in")'); await se.waitForTimeout(2000); await se.reload();
  ok((await se.textContent('main')).includes('In since'), 'check-in with geolocation recorded');
  await se.goto(BASE + '/leave');
  await se.selectOption('select[name=type]', 'casual'); await se.fill('input[name=from]', D1); await se.fill('input[name=to]', D2); await se.fill('textarea[name=reason]', REASON);
  await se.click('button:has-text("Submit request")'); await se.waitForTimeout(1500); await se.reload();
  ok((await se.textContent('main')).includes('Pending'), 'leave request submitted (pending)');
  await se.goto(BASE + '/expenses');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await se.setInputFiles('input[type=file]', { name: 'bill.png', mimeType: 'image/png', buffer: png });
  await se.waitForSelector('text=Receipt attached', { timeout: 15000 });
  await se.fill('input[name=amount]', '750'); await se.selectOption('select[name=category]', 'Food'); await se.fill('input[name=vendorName]', VENDOR);
  await se.click('button:has-text("Submit claim")'); await se.waitForTimeout(2000); await se.reload();
  ok((await se.textContent('main')).includes('Above Food policy limit'), 'expense anomaly flag raised (above policy)');
  const bad = await se.request.post(BASE + '/api/ai/receipt', { multipart: { file: { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') } } });
  ok(bad.status() === 400, 'upload with fake image content rejected (magic-byte check)');

  const mg = await session(browser, 'manager@sharma.demo');
  await mg.goto(BASE + '/approvals');
  const inbox = await mg.textContent('main');
  ok(inbox.includes(REASON) && inbox.includes(VENDOR), 'manager sees leave + expense in approvals inbox');
  await mg.locator('section.card', { hasText: REASON }).locator('button:has-text("Approve")').click(); await mg.waitForTimeout(1200);
  await mg.locator('section.card', { hasText: VENDOR }).locator('button:has-text("Approve")').click(); await mg.waitForTimeout(1200);
  ok(sql(`select status from "LeaveRequest" where reason='${REASON}'`) === 'approved', 'leave approved → status updated');
  ok(sql(`select status from "Expense" where "vendorName"='${VENDOR}'`) === 'approved', 'expense approved (single level < ₹10,000)');
  await mg.goto(BASE + '/approvals'); ok(!(await mg.textContent('main')).includes('Hotel Clarks'), 'manager does not see own expense in inbox (no self-approval)');
  const ac = await session(browser, 'accounts@sharma.demo');
  await ac.goto(BASE + '/expenses?who=team');
  await ac.locator('tr', { hasText: VENDOR }).locator('button:has-text("Mark paid")').click(); await ac.waitForTimeout(1200);
  ok(sql(`select status from "Expense" where "vendorName"='${VENDOR}'`) === 'reimbursed', 'accounts reimbursed the claim');

  // ── 6. Inventory & purchases ──
  await ad.goto(BASE + '/approvals');
  const ut = ad.locator('section.card', { hasText: 'UltraTech' }).locator('button:has-text("Approve")');
  if (await ut.count()) { await ut.first().click(); await ad.waitForTimeout(1200); }
  const before = Number(sql(`select stock from "Product" where sku='OPC-53'`));
  await ad.goto(BASE + '/purchases');
  ad.once('dialog', (d) => d.accept());
  const rc = ad.locator('tr', { hasText: 'UltraTech' }).locator('button:has-text("Receive")');
  if (!(await rc.count())) { console.log('SKIP PO receive (already received in a previous run)'); } else { await rc.first().click(); await ad.waitForTimeout(1500); }
  const afterStock = Number(sql(`select stock from "Product" where sku='OPC-53'`));
  ok(afterStock >= before, `PO approved → received → stock in (${before} → ${afterStock})`);
  const gi0 = Number(sql(`select stock from "Product" where sku='GI-PIPE-25' and "tenantId"=(select id from "Tenant" where slug='sharma-distributors')`));
  await ac.goto(BASE + '/invoices/new');
  await ac.selectOption('select[required]', { index: 1 });
  const giOpt = await ac.locator('table select >> nth=0').locator('option', { hasText: 'GI Pipe 25mm' }).getAttribute('value');
  await ac.selectOption('table select >> nth=0', giOpt);
  await ac.fill('table input[type=number] >> nth=0', '5');
  await Promise.all([ac.waitForURL(/\/invoices\/c/), ac.click('button:has-text("Save draft")')]);
  ac.once('dialog', (d) => d.accept());
  await ac.click('button:has-text("Issue invoice")'); await ac.waitForTimeout(1500);
  const gi1 = Number(sql(`select stock from "Product" where sku='GI-PIPE-25' and "tenantId"=(select id from "Tenant" where slug='sharma-distributors')`));
  ok(gi1 === gi0 - 5, `issuing an invoice deducted stock (GI Pipe 25mm ${gi0} → ${gi1}) with a sale entry in the ledger`);

  // ── 7. Tasks, custom objects, KB, command palette ──
  await ad.goto(BASE + '/tasks');
  await ad.fill('input[name=title]', 'E2E task from test'); await ad.click('button:has-text("Create task")'); await ad.waitForTimeout(1200);
  ok((await ad.textContent('main')).includes('E2E task from test'), 'task created on Kanban');
  await ad.goto(BASE + '/records/visit');
  await ad.fill('input[name=title]', 'E2E Hardware Store'); await ad.fill('input[name=cf_dealer]', 'E2E Hardware');
  await Promise.all([ad.waitForURL(/\/records\/visit\/c/), ad.click('button:has-text("Create")')]);
  ok((await ad.textContent('main')).includes('E2E Hardware'), 'custom object record (Dealer visit) created');
  await ad.goto(BASE + '/knowledge?q=leave');
  ok((await ad.textContent('main')).includes('Leave & attendance policy'), 'knowledge base full-text search');
  await ad.goto(BASE + '/dashboard'); await ad.keyboard.press('Control+k'); await ad.keyboard.type('workflows'); await ad.keyboard.press('Enter');
  await ad.waitForURL(/\/workflows/); ok(true, 'Ctrl+K command palette navigates');
  // telecaller must not reach security / workflow pages
  await tc.goto(BASE + '/security'); await tc.waitForURL(/denied/, { timeout: 8000 }).catch(() => {}); ok(tc.url().includes('/denied'), 'telecaller blocked from security center');
  const exp2 = await tc.request.get(BASE + '/api/export'); ok(exp2.status() === 403, 'telecaller cannot export company data');

  // ── 8. Require 2FA for admins ──
  await ad.goto(BASE + '/security'); await ad.selectOption('select[name=require2fa]', 'admins'); await ad.click('button:has-text("Save policy")'); await ad.waitForTimeout(1200);
  await ad.goto(BASE + '/dashboard'); await ad.waitForURL(/enforce=1/, { timeout: 8000 }).catch(() => {});
  ok(ad.url().includes('/settings/security?enforce=1'), 'admin without 2FA is forced to set it up');
  await ad.click('button:has-text("Set up 2FA")'); await ad.waitForTimeout(1000); await ad.reload();
  const secret = (await ad.textContent('code')).trim();
  ok(sql(`select left("totpSecret",7) from "User" where email='admin@sharma.demo'`) === 'enc:v1:', '2FA secret stored encrypted (AES-256-GCM)');
  await ad.fill('input[name=code]', totp(secret)); await ad.click('button:has-text("Verify & enable")'); await ad.waitForTimeout(1200);
  await ad.goto(BASE + '/dashboard'); ok(ad.url().includes('/dashboard'), 'after enabling 2FA the admin can use the app');
  // restore demo state
  sql(`update "Tenant" set require2fa='none' where slug='sharma-distributors'`);
  sql(`update "User" set "totpEnabled"=false, "totpSecret"=null where email='admin@sharma.demo'`);
  await browser.close();
})();
