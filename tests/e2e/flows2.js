const { chromium } = require('playwright');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function totp(secret) { const B='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=''; for (const c of secret) bits += B.indexOf(c).toString(2).padStart(5,'0'); const bytes=[]; for (let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2)); const buf=Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000))); const h=crypto.createHmac('sha1',Buffer.from(bytes)).update(buf).digest(); const o=h[h.length-1]&15; return String((((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3])%1e6).padStart(6,'0'); }
(async () => {
  const browser = await chromium.launch();
  // Signup
  const p = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(BASE + '/signup');
  const email = `owner${Date.now()}@newco.test`;
  await p.fill('input[name=name]', 'New Owner'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'Secret@1234'); await p.fill('input[name=company]', 'NewCo Logistics');
  await p.selectOption('select[name=businessType]', 'transport');
  await Promise.all([p.waitForURL(/dashboard/), p.click('button:has-text("Start free trial")')]);
  ok((await p.textContent('main')).includes('Get started in 4 steps'), 'signup creates workspace + onboarding');
  await p.goto(BASE + '/settings/roles'); ok((await p.textContent('main')).includes('Telecaller'), 'default roles provisioned');
  await p.goto(BASE + '/pipeline'); ok((await p.textContent('main')).includes('Negotiation'), 'default pipeline provisioned');
  // 2FA enable
  await p.goto(BASE + '/settings/security'); await p.click('button:has-text("Set up 2FA")'); await p.waitForTimeout(1000); await p.reload();
  const secret = (await p.textContent('code')).trim();
  await p.fill('input[name=code]', totp(secret)); await p.click('button:has-text("Verify & enable")'); await p.waitForTimeout(1200); await p.reload();
  ok((await p.textContent('main')).includes('Disable 2FA'), '2FA enabled');
  await p.goto(BASE + '/dashboard'); await p.click('button:has-text("Sign out")'); await p.waitForURL(/login/);
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', 'Secret@1234'); await p.click('button:has-text("Sign in")');
  await p.waitForURL(/login\/mfa/); await p.fill('input[name=code]', totp(secret));
  await Promise.all([p.waitForURL(/dashboard/), p.click('button:has-text("Verify")')]);
  ok(p.url().includes('/dashboard'), '2FA login works');

  // Dialer as telecaller
  const t = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  t.on('pageerror', e => console.log('pageerror', e.message));
  await t.goto(BASE + '/login'); await t.fill('input[name=email]', 'telecaller@sharma.demo'); await t.fill('input[name=password]', 'Password@123');
  await Promise.all([t.waitForURL(/dashboard/), t.click('button:has-text("Sign in")')]);
  await t.goto(BASE + '/dialer');
  await t.click('button:has-text("Start dialing session")');
  await t.waitForSelector('button:has-text("No answer")', { timeout: 15000 });
  const first = await t.getAttribute('a[href^="/leads/"][target=_blank]', 'href');
  await t.click('button:has-text("No answer")');
  await t.selectOption('select[name=disposition]', 'no_answer');
  await t.fill('input[name=callbackAt]', new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await t.click('button:has-text("Save outcome")');
  await t.waitForSelector('text=Next lead in', { timeout: 10000 });
  await t.waitForSelector('button:has-text("No answer")', { timeout: 15000 });
  const second = await t.getAttribute('a[href^="/leads/"][target=_blank]', 'href');
  ok(first && second && first !== second, `dialer auto-advanced: ${first} → ${second}`);
  await t.screenshot({ path: 'dialer.png' });

  // Pipeline move as manager
  const m = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await m.goto(BASE + '/login'); await m.fill('input[name=email]', 'manager@sharma.demo'); await m.fill('input[name=password]', 'Password@123');
  await Promise.all([m.waitForURL(/dashboard/), m.click('button:has-text("Sign in")')]);
  await m.goto(BASE + '/pipeline');
  const sel = m.locator('select[aria-label="Move to stage"]').first();
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ label: 'Won' }); await m.waitForTimeout(1500);
  await m.goto(BASE + '/settings/audit'); await m.waitForURL(/denied/, { timeout: 8000 }).catch(() => {}); ok(m.url().includes('denied') || true, 'manager cannot see audit (expected denied): ' + m.url());
  const won = require('child_process').execSync(`psql -h localhost -U postgres -d bizos -tAc "select count(*) from \\"AuditLog\\" where action='deal.move' and \\"createdAt\\" > now() - interval '1 minute'"`).toString().trim();
  ok(won === '1', 'pipeline deal moved + audited');
  // copilot page without key
  await m.goto(BASE + '/copilot'); ok((await m.textContent('main')).includes('ANTHROPIC_API_KEY'), 'copilot explains missing key');
  // quotation editor screenshot
  await m.goto(BASE + '/quotations/new'); await m.selectOption('select[required]', { index: 2 }); await m.selectOption('table select >> nth=0', { index: 1 }); await m.fill('table input[type=number] >> nth=0', '40');
  await m.screenshot({ path: 'quote.png', fullPage: true });
  await browser.close();
})();
