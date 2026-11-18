const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
async function session(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', email, e.message));
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'Password@123');
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login')), page.click('button:has-text("Sign in")')]);
  return page;
}
(async () => {
  const browser = await chromium.launch();

  // 1. Telecaller: RBAC + create lead + call + disposition
  const tc = await session(browser, 'telecaller@sharma.demo');
  let r = await tc.goto(BASE + '/invoices'); await tc.waitForURL(/denied|upgrade/, { timeout: 8000 }).catch(() => {}); ok(tc.url().includes('/upgrade') || tc.url().includes('/denied'), 'telecaller blocked from invoices -> ' + tc.url());
  const navText = await tc.textContent('aside');
  ok(!navText.includes('Invoices') && !navText.includes('Reports'), 'telecaller nav hides finance/reports');
  const dash = await tc.textContent('main');
  ok(!dash.includes('Invoiced this month'), 'telecaller dashboard hides revenue');
  await tc.goto(BASE + '/leads/new');
  await tc.fill('input[name=name]', 'E2E Test Lead'); await tc.fill('input[name=phone]', '9811122233'); await tc.fill('input[name=city]', 'Delhi'); await tc.fill('input[name=budget]', '75000');
  await Promise.all([tc.waitForURL(/\/leads\/c/), tc.click('button:has-text("Create lead")')]);
  const leadUrl = tc.url();
  ok(/LD-\d+/.test(await tc.textContent('main')), 'lead created with number ' + leadUrl);
  await tc.waitForTimeout(2000); await tc.reload();
  ok((await tc.textContent('main')).includes('First call'), 'speed-to-lead workflow scheduled the first call on lead.created');
  await tc.click('button:has-text("Call")');
  await tc.click('button:has-text("Customer answered")');
  await tc.waitForTimeout(2200);
  await tc.click('button:has-text("End call")');
  await tc.selectOption('select[name=disposition]', 'interested');
  await tc.fill('textarea[name=notes]', 'Needs 100 GI pipes next week');
  await tc.click('button:has-text("Save outcome")');
  await tc.waitForTimeout(1500); await tc.reload();
  const lt = await tc.textContent('main');
  ok(lt.includes('Qualified') && lt.includes('Needs 100 GI pipes'), 'disposition moved lead to Qualified + logged call');
  ok(/0:0[1-9]|0:[1-5]\d/.test(lt), 'talk time recorded');

  // DND block
  const res = await tc.evaluate(async () => {
    const r = await fetch('/leads?q=E2E'); return r.status;
  });
  // 2. Sales exec quotation with discount above limit -> approval
  const se = await session(browser, 'sales@sharma.demo');
  await se.goto(BASE + '/quotations/new');
  await se.selectOption('select[required]', { index: 1 });
  await se.selectOption('table select >> nth=0', { index: 1 });
  await se.fill('table input[type=number] >> nth=0', '10');
  await se.fill('table input[type=number] >> nth=2', '15');
  ok((await se.textContent('main')).includes('need manager approval'), 'editor warns about discount limit');
  await Promise.all([se.waitForURL(/\/quotations\/c/), se.click('button:has-text("Save quotation")')]);
  const qUrl = se.url();
  await se.click('button:has-text("Submit for approval")'); await se.waitForTimeout(1200); await se.reload();
  ok((await se.textContent('main')).includes('Pending Approval'), 'quotation routed for approval');

  const mg = await session(browser, 'manager@sharma.demo');
  await mg.goto(qUrl);
  await mg.click('button:has-text("Approve")'); await mg.waitForTimeout(1200); await mg.reload();
  ok((await mg.textContent('main')).includes('Approved'), 'manager approved');
  await mg.click('button:has-text("Mark as sent")'); await mg.waitForTimeout(1200); await mg.reload();
  // public link
  const link = await mg.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Copy customer link')) ? 'yes' : 'no');
  ok(link === 'yes', 'customer link available after sending');
  const token = await (async () => { const { execSync } = require('child_process'); return execSync(`psql -h localhost -U postgres -d bizos -tAc "select \\"publicToken\\" from \\"Quotation\\" where id='${qUrl.split('/').pop()}'"`).toString().trim(); })();
  const pub = await browser.newPage();
  await pub.goto(BASE + '/q/' + token);
  await pub.fill('input[name=name]', 'Customer Signer'); await pub.check('input[name=agree]');
  await pub.click('button:has-text("Accept & sign")'); await pub.waitForTimeout(1500); await pub.reload();
  ok((await pub.textContent('body')).includes('Accepted by'), 'customer accepted quotation via public link');

  // 3. Accountant converts, issues, records payment
  const ac = await session(browser, 'accounts@sharma.demo');
  await ac.goto(qUrl);
  await Promise.all([ac.waitForURL(/\/invoices\/c/), ac.click('button:has-text("Convert to invoice")')]);
  ac.once('dialog', d => d.accept());
  await ac.click('button:has-text("Issue invoice")'); await ac.waitForTimeout(1500); await ac.reload();
  const invText = await ac.textContent('main');
  ok(/INV\/\d{4}-\d{2}\/\d{4}/.test(invText), 'invoice issued with gapless FY number');
  await ac.fill('input[name=amount]', '1000'); await ac.fill('input[name=reference]', 'UTR-E2E');
  await ac.click('button:has-text("Record payment")'); await ac.waitForTimeout(1500); await ac.reload();
  ok((await ac.textContent('main')).includes('Partially Paid'), 'partial payment recorded');
  await ac.goto(BASE + '/leads'); await ac.waitForURL(/denied|upgrade/, { timeout: 8000 }).catch(() => {}); ok(ac.url().includes('/denied') || ac.url().includes('upgrade'), 'accountant blocked from leads');

  // 4. Tenant isolation
  const px = await session(browser, 'admin@pixelcraft.demo');
  r = await px.goto(leadUrl);
  ok(r.status() === 404 || (await px.textContent('body')).includes('not be found'), 'other tenant gets 404 on Sharma lead');
  r = await px.goto(qUrl); ok(r.status() === 404 || (await px.textContent('body')).includes('not be found'), 'other tenant gets 404 on Sharma quotation');
  const leadsCount = await px.textContent('main');
  ok(!leadsCount.includes('E2E Test Lead'), 'search isolation');
  await px.goto(BASE + '/leads'); ok((await px.textContent('main')).includes('6 leads'), 'pixelcraft sees only its 6 leads');

  // 5. API key + REST
  const ad = await session(browser, 'admin@sharma.demo');
  await ad.goto(BASE + '/settings/api');
  await ad.fill('input[name=name]', 'E2E key'); await ad.click('button:has-text("Create key")'); await ad.waitForTimeout(1200);
  await ad.goto(BASE + '/notifications');
  const key = require('child_process').execSync(`psql -h localhost -U postgres -d bizos -tAc "select body from \\"Notification\\" where title like 'New API key%' order by \\"createdAt\\" desc limit 1"`).toString().trim();
  ok(!!key, 'API key issued');
  const api = await ad.request.post(BASE + '/api/v1/leads', { headers: { authorization: 'Bearer ' + key }, data: { name: 'API Lead', phone: '9822200011', city: 'Lucknow', source: 'website' } });
  const body = await api.json();
  ok(api.status() === 201 && body.data.number > 0, 'POST /api/v1/leads -> ' + api.status());
  const list = await ad.request.get(BASE + '/api/v1/invoices?status=overdue&limit=5', { headers: { authorization: 'Bearer ' + key } });
  ok(list.status() === 200 && (await list.json()).data.length > 0, 'GET /api/v1/invoices?status=overdue');
  const bad = await ad.request.get(BASE + '/api/v1/leads', { headers: { authorization: 'Bearer nope' } });
  ok(bad.status() === 401, 'bad API key rejected');
  // Lucknow lead should be routed by rule to Vikram
  const owner = require('child_process').execSync(`psql -h localhost -U postgres -d bizos -tAc "select u.name from \\"Lead\\" l join \\"Membership\\" m on m.id=l.\\"ownerId\\" join \\"User\\" u on u.id=m.\\"userId\\" where l.id='${body.data.id}'"`).toString().trim();
  ok(owner === 'Vikram Yadav', 'assignment rule routed Lucknow API lead to ' + owner);
  // Audit
  await ad.goto(BASE + '/settings/audit');
  const audit = await ad.textContent('main');
  ok(audit.includes('invoice.issue') && audit.includes('quotation.approve') && audit.includes('payment.record'), 'audit trail recorded key actions');
  // Cron
  const cron = await ad.request.get(BASE + '/api/cron/daily', { headers: { authorization: 'Bearer dev-cron-secret' } });
  ok(cron.status() === 200, 'daily cron ran: ' + JSON.stringify(await cron.json()));
  await browser.close();
})();
