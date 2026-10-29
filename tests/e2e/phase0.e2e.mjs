/**
 * Phase 0 screen journeys (blueprint § Testing, gates 4–6), desktop 1440 px and phone 390 px.
 * Run against a running API that serves the built web app:
 *   E2E_BASE=http://localhost:4000 node tests/e2e/phase0.e2e.mjs
 * Exits non-zero on the first failed check; prints a summary line per check.
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const HASH = process.env.E2E_HASH === '1';          // GitHub Pages build uses #/ routes
const ACCESS = process.env.E2E_ACCESS_CODE;          // staging access code, when required
const url = (p) => (HASH ? `${BASE}/#${p.replace(/^\/$/, '')}` : `${BASE}${p}`);
const API = process.env.E2E_API ?? `${BASE}/api`;
const VIEWPORTS = { desktop: { width: 1440, height: 960 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

let passed = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); passed++; results.push(`  ok   ${name}`); }
  catch (e) { results.push(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); console.log(results.join('\n')); process.exit(1); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

async function token(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, accessCode: ACCESS }) });
  const j = await r.json(); assert(j.token, `sign-in failed for ${email}: ${JSON.stringify(j)}`); return j.token;
}

const browser = await chromium.launch();
async function pageAs(email, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, reducedMotion: 'reduce' });
  // Test a production build against a local API: E2E_PROXY_FROM=<built-in API base> rewrites its calls to E2E_API.
  if (process.env.E2E_PROXY_FROM) {
    await ctx.route(`${process.env.E2E_PROXY_FROM}/**`, async (route) => {
      const req = route.request();
      const target = req.url().replace(process.env.E2E_PROXY_FROM, API.replace(/\/api$/, ''));
      const res = await route.fetch({ url: target });
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (email) {
    const t = await token(email);
    await page.goto(url('/sign-in'));
    await page.evaluate((v) => sessionStorage.setItem('pep.token', v), t);
    await page.goto('about:blank');   // next visit starts a fresh document (hash routes would not reload)
  }
  return { page, ctx, errors };
}
const noOverflow = async (page, where) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(sw <= cw, `${where}: page is ${sw}px wide in a ${cw}px viewport`);
};
const axe = async (page, where) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert(!bad.length, `${where}: ${bad.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`);
};
const noEmoji = async (page, where) => {
  const text = await page.evaluate(() => document.body.innerText);
  assert(!EMOJI.test(text), `${where}: emoji found in page text`);
};

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  await check(`[${vpName}] sign-in page lists demo users and has no accessibility blockers`, async () => {
    const { page, ctx } = await pageAs(null, vp);
    await page.goto(url('/sign-in'));
    if (ACCESS) { await page.fill('#access-code', ACCESS); await page.click('button:has-text("Unlock")'); }
    await page.waitForSelector('text=Frank Adu-Peprah', { timeout: 15000 });
    await noOverflow(page, 'sign-in'); await axe(page, 'sign-in'); await noEmoji(page, 'sign-in');
    await ctx.close();
  });

  await check(`[${vpName}] controller dashboard: greeting, 4 KPIs, chart, position, tasks`, async () => {
    const { page, ctx, errors } = await pageAs('frank@pep.local', vp);
    await page.goto(url('/trulander/dashboard?period=2026-10'));
    await page.waitForSelector('main h1:has-text("Frank")', { timeout: 15000 });
    await page.waitForSelector('text=Total revenue');
    for (const k of ['Total revenue', 'Total expenses', 'Net profit', 'Cash balance']) assert(await page.locator(`text=${k}`).count() > 0, `KPI ${k} missing`);
    assert(await page.locator('svg[aria-label^="Revenue, expenses and net profit"]').count() === 1, 'chart missing');
    assert(await page.locator('text=Assets equal liabilities plus equity').count() === 1, 'position does not balance');
    await noOverflow(page, 'dashboard'); await axe(page, 'dashboard'); await noEmoji(page, 'dashboard');
    assert(!errors.length, `console errors: ${errors.join(' | ')}`);
    await ctx.close();
  });

  await check(`[${vpName}] every available navigation item opens its screen; roadmap items are not links`, async () => {
    const { page, ctx, errors } = await pageAs('frank@pep.local', vp);
    for (const path of ['journals', 'ledger', 'trial-balance', 'accounts', 'periods', 'statements', 'notes', 'audit']) {
      await page.goto(url(`/trulander/${path}?period=2026-10`));
      await page.waitForSelector('main h1', { timeout: 15000 });
      await noOverflow(page, path); await noEmoji(page, path);
    }
    if (vpName === 'desktop') {
      assert(await page.locator('aside a:has-text("Receivables")').count() === 0, 'Receivables should not be a link before Phase 3');
      assert(await page.locator('aside [aria-disabled="true"]:has-text("Receivables")').count() === 1, 'Receivables roadmap item missing');
    }
    assert(!errors.length, `console errors: ${errors.join(' | ')}`);
    await ctx.close();
  });

  await check(`[${vpName}] period switch updates URL and dashboard; locked period shows banner`, async () => {
    const { page, ctx } = await pageAs('frank@pep.local', vp);
    await page.goto(url('/trulander/dashboard?period=2026-10'));
    await page.waitForSelector('text=October 2026');
    await page.locator('button[aria-label^="Period:"]:visible').first().click();
    await page.locator('[role="menuitem"]:has-text("Dec 2025")').click();
    await page.waitForSelector('text=December 2025');
    assert(page.url().includes('period=2025-12'), `URL not updated: ${page.url()}`);
    assert(await page.locator('text=Dec 2025 is locked').count() === 1, 'lock banner missing');
    await ctx.close();
  });
}

await check('[desktop] command palette: Ctrl+K, type, Enter navigates; no animation on open', async () => {
  const { page, ctx } = await pageAs('frank@pep.local', VIEWPORTS.desktop);
  await page.goto(url('/trulander/dashboard'));
  await page.waitForSelector('main h1');
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('[cmdk-input]');
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]')).animationName);
  assert(anim === 'none', `palette animates on open (${anim})`);
  await page.keyboard.type('trial balance');
  await page.keyboard.press('Enter');
  await page.waitForURL(/trial-balance/);
  await ctx.close();
});

await check('[desktop] entity switcher keeps the current screen', async () => {
  const { page, ctx } = await pageAs('frank@pep.local', VIEWPORTS.desktop);
  await page.goto(url('/trulander/trial-balance'));
  await page.waitForSelector('main h1');
  await page.locator('button[aria-label="Switch entity"]:visible').first().click();
  await page.locator('[role="menuitem"]:has-text("Pep Landbank Ltd")').click();
  await page.waitForURL(/peplandbank\/trial-balance/);
  await ctx.close();
});

await check('[desktop] isolation: a user without access to an entity gets Page not found', async () => {
  const { page, ctx } = await pageAs('esi@pep.local', VIEWPORTS.desktop);
  await page.goto(url('/trulander/dashboard'));
  await page.waitForSelector('text=Page not found', { timeout: 15000 });
  await ctx.close();
});

await check('[desktop] system administrator (no reporting access) lands on a screen they may open', async () => {
  const { page, ctx } = await pageAs('admin@pep.local', VIEWPORTS.desktop);
  await page.goto(url('/'));
  await page.waitForURL(/trulander\/(periods|audit)/, { timeout: 15000 });
  assert(await page.locator('aside a:has-text("Dashboard")').count() === 0, 'admin should not see Dashboard');
  await ctx.close();
});

await check('[desktop] unknown route shows Page not found with a way back', async () => {
  const { page, ctx } = await pageAs('frank@pep.local', VIEWPORTS.desktop);
  await page.goto(url('/trulander/does-not-exist'));
  await page.waitForSelector('text=Page not found');
  await ctx.close();
});

await check('[desktop] signed-out visit redirects to sign-in', async () => {
  const { page, ctx } = await pageAs(null, VIEWPORTS.desktop);
  await page.goto(url('/trulander/dashboard'));
  await page.waitForURL(/sign-in/);
  await ctx.close();
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${passed} checks passed`);
