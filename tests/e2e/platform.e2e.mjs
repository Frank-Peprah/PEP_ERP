/**
 * Blueprint Phase 0 · M0 Platform — browser journeys for Users & Access, Approval Policies and the
 * invitation/password-reset landing. Desktop 1440 px and phone 390 px, axe on every screen.
 *   E2E_BASE=http://localhost:4000 node tests/e2e/platform.e2e.mjs
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const API = `${BASE}/api`;
const VIEWPORTS = { desktop: { width: 1440, height: 960 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const assert = (c, m) => { if (!c) throw new Error(m); };
let passed = 0;
const out = [];
async function check(name, fn) {
  try { await fn(); passed++; out.push(`  ok   ${name}`); }
  catch (e) { out.push(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); console.log(out.join('\n')); process.exit(1); }
}
async function token(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  return (await r.json()).token;
}
const browser = await chromium.launch();
async function pageAs(email, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (email) {
    await page.goto(`${BASE}/sign-in`);
    await page.evaluate((v) => sessionStorage.setItem('pep.token', v), await token(email));
  }
  return { page, ctx, errors };
}
const axe = async (page, where) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert(!bad.length, `${where}: ${bad.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`);
};
const noOverflow = async (page, where) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(sw <= cw, `${where}: page is ${sw}px wide in a ${cw}px viewport`);
};

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  await check(`[${vp}] administrator invites a person; they appear with role and "not yet" sign-in`, async () => {
    const { page, ctx, errors } = await pageAs('admin@pep.local', size);
    await page.goto(`${BASE}/trulander/users`);
    await page.getByRole('heading', { name: 'Users & access' }).waitFor();
    await axe(page, 'users'); await noOverflow(page, 'users');
    const email = `e2e.${vp}.${Date.now()}@example.com`;
    await page.getByLabel('Full name').fill(`E2E ${vp} Person`);
    await page.getByLabel('Work e-mail').fill(email);
    await page.getByLabel(/Journal Preparer/).check();
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await page.getByText(/was added|Invitation e-mailed/).waitFor({ timeout: 10000 });
    const row = page.locator('tr', { hasText: email });
    await row.getByText('Journal Preparer').waitFor();
    await row.getByText('Not yet').waitFor();
    assert(!errors.length, errors.join('; '));
    await ctx.close();
  });

  await check(`[${vp}] administrator cannot invite themselves (segregation of duties shown)`, async () => {
    const { page, ctx } = await pageAs('admin@pep.local', size);
    await page.goto(`${BASE}/trulander/users`);
    await page.getByLabel('Full name').fill('Me Again');
    await page.getByLabel('Work e-mail').fill('admin@pep.local');
    await page.getByLabel(/Accountant/).check();
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await page.getByText(/cannot invite yourself/).waitFor({ timeout: 10000 });
    await ctx.close();
  });

  await check(`[${vp}] controller adds a payment approval tier; it is listed with its reason`, async () => {
    const { page, ctx, errors } = await pageAs('frank@pep.local', size);
    await page.goto(`${BASE}/trulander/approval-policies`);
    await page.getByRole('heading', { name: 'Approval policies' }).waitFor();
    await axe(page, 'policies'); await noOverflow(page, 'policies');
    const reason = `E2E ${vp} dual control ${Date.now()}`;
    await page.getByLabel(/Above amount/).fill(String(70000 + Math.floor(Math.random() * 9000)));   // unique tier per run
    await page.getByLabel(/Reason/).fill(reason);
    await page.getByRole('button', { name: 'Add policy' }).click();
    await page.getByText(reason).waitFor({ timeout: 10000 });
    await page.getByText(/need 2 approvers/).waitFor();
    assert(!errors.length, errors.join('; '));
    await ctx.close();
  });

  await check(`[${vp}] an auditor sees policies read-only (no form)`, async () => {
    const { page, ctx } = await pageAs('auditor@pep.local', size);
    await page.goto(`${BASE}/trulander/approval-policies`);
    await page.getByRole('heading', { name: 'Approval policies' }).waitFor();
    assert(await page.getByRole('button', { name: 'Add policy' }).count() === 0, 'auditor sees the add form');
    await ctx.close();
  });

  await check(`[${vp}] expired invitation link lands on a clear message, not a blank page`, async () => {
    const { page, ctx } = await pageAs(null, size);
    await page.goto(`${BASE}/sign-in#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await page.waitForURL(/set-password/);
    await page.getByText(/Open the link from your invitation|expired/).waitFor();
    assert(!page.url().includes('error_description'), 'link details left in the address bar');
    await axe(page, 'set-password');
    await ctx.close();
  });
}

await browser.close();
console.log(out.join('\n'));
console.log(`\n${passed} checks passed`);
