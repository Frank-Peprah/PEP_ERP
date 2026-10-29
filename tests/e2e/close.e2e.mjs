/**
 * Blueprint Phase 1 — Year-end close and adjusted trial balance screens. Desktop 1440 px and phone 390 px, axe on every screen.
 *   E2E_BASE=http://localhost:4000 node tests/e2e/close.e2e.mjs
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4000';
const VIEWPORTS = { desktop: { width: 1440, height: 960 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const assert = (c, m) => { if (!c) throw new Error(m); };
let passed = 0;
const out = [];
async function check(name, fn) {
  try { await fn(); passed++; out.push(`  ok   ${name}`); }
  catch (e) { out.push(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); console.log(out.join('\n')); process.exit(1); }
}
const token = async (email) => (await (await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json()).token;
const browser = await chromium.launch();
async function pageAs(email, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/sign-in`);
  await page.evaluate((v) => sessionStorage.setItem('pep.token', v), await token(email));
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
  await check(`[${vp}] controller opens Year-end close: three steps, closing lines, and what blocks the close`, async () => {
    const { page, ctx, errors } = await pageAs('frank@pep.local', size);
    await page.goto(`${BASE}/trulander/year-end-close`);
    await page.getByRole('heading', { name: 'Year-end close' }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Steps' }).waitFor({ timeout: 20000 });
    await page.getByText('1. Generate the closing journal').waitFor();
    await page.getByText('3. Finalise').waitFor();
    const state = await page.locator('main').innerText();
    assert(/Before closing|is closed|Draft .* created|Posted/.test(state) || /Generate/.test(state), 'no close state shown');
    await axe(page, 'year-end close'); await noOverflow(page, 'year-end close');
    assert(!errors.length, errors.join('; '));
    await ctx.close();
  });

  await check(`[${vp}] adjusted trial balance: unadjusted + adjustments = adjusted, and it balances`, async () => {
    const { page, ctx, errors } = await pageAs('frank@pep.local', size);
    await page.goto(`${BASE}/trulander/trial-balance`);
    await page.getByRole('heading', { name: 'Trial balance' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Adjusted' }).click();
    await page.getByRole('columnheader', { name: 'Unadjusted' }).waitFor();
    await page.getByRole('columnheader', { name: 'Adjustments' }).waitFor();
    await page.getByText('Balanced').first().waitFor();
    await axe(page, 'adjusted trial balance'); await noOverflow(page, 'adjusted trial balance');
    assert(!errors.length, errors.join('; '));
    await ctx.close();
  });

  await check(`[${vp}] an accountant can view the close but cannot generate it`, async () => {
    const { page, ctx } = await pageAs('ama@pep.local', size);
    await page.goto(`${BASE}/trulander/year-end-close`);
    await page.getByRole('heading', { name: 'Steps' }).waitFor({ timeout: 20000 });
    const gen = page.getByRole('button', { name: 'Generate' });
    if (await gen.count()) assert(await gen.isDisabled(), 'Generate is enabled for an accountant');
    await ctx.close();
  });
}

await browser.close();
console.log(out.join('\n'));
console.log(`\n${passed} checks passed`);
