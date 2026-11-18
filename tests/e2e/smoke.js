const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
async function login(page, email) {
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Password@123');
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 }), page.click('button:has-text("Sign in")')]);
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  let cur = '';
  page.on('pageerror', e => errors.push('pageerror on ' + cur + ': ' + e.message.slice(0, 120)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await login(page, 'admin@sharma.demo');
  const pages = ['/dashboard','/leads','/leads/new','/leads/import','/contacts','/contacts/new','/followups','/pipeline','/dialer','/calls','/products','/quotations','/quotations/new','/invoices','/invoices/new','/tickets','/reports','/notifications','/search?q=Verma','/copilot','/settings','/settings/users','/settings/roles','/settings/branches','/settings/assignment','/settings/calling','/settings/api','/settings/audit','/settings/billing','/settings/security','/switch','/platform','/approvals','/tasks','/projects','/attendance','/leave','/expenses','/inventory','/purchases','/workflows','/workflows/new','/workflows/recipes','/workflows/runs','/workflows/templates','/messages','/knowledge','/security','/settings/fields','/settings/objects','/records/visit'];
  const bad = [];
  for (const p of pages) {
    cur = p; const r = await page.goto(BASE + p); await page.waitForLoadState('networkidle').catch(() => {});
    const txt = await page.textContent('body');
    if (!r || r.status() >= 400 || /Application error|Unhandled Runtime|Internal Server Error/.test(txt)) bad.push(`${p} -> ${r && r.status()}`);
  }
  // detail pages
  await page.goto(BASE + '/leads');
  const leadHref = await page.getAttribute('table a[href^="/leads/"]', 'href');
  for (const sel of [['/leads', 'a[href^="/leads/c"]'], ['/contacts', 'table a[href^="/contacts/"]'], ['/quotations', 'table a[href^="/quotations/"]'], ['/invoices', 'table a[href^="/invoices/"]']]) {
    await page.goto(BASE + sel[0]);
    const h = await page.getAttribute(sel[1], 'href');
    cur = h; const r = await page.goto(BASE + h); await page.waitForLoadState('networkidle').catch(() => {});
    const txt = await page.textContent('body');
    if (r.status() >= 400 || /Application error/.test(txt)) bad.push(`${h} -> ${r.status()}`);
  }
  console.log('BAD PAGES:', bad);
  console.log('ERRORS:', errors.slice(0, 20));
  await page.goto(BASE + '/dashboard'); await page.screenshot({ path: 'dashboard.png', fullPage: true });
  await page.goto(BASE + leadHref); await page.screenshot({ path: 'lead.png', fullPage: true });
  await page.goto(BASE + '/pipeline'); await page.screenshot({ path: 'pipeline.png' });
  await browser.close();
})();
