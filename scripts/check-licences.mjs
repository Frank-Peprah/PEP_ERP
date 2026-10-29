#!/usr/bin/env node
// Licence gate (Blueprint 03 §5): fail the build if any production dependency is under a
// copyleft, source-available or unknown licence. Our own workspace packages are exempt.
// Usage: node scripts/check-licences.mjs   (CI runs it on every push)
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0',
  'OFL-1.1',          // fonts (Plus Jakarta Sans, JetBrains Mono): permissive for embedding
  'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0',
]);
const OWN = /^(pep-erp|@pep\/)/;

const pkgs = JSON.parse(execSync('npm query ".prod"', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const bad = [];
for (const p of pkgs) {
  if (OWN.test(p.name)) continue;
  const raw = typeof p.license === 'string' ? p.license : p.license?.type ?? 'UNKNOWN';
  // SPDX expressions: "A OR B" passes if any option is allowed; "A AND B" needs all.
  const expr = raw.replace(/[()]/g, '');
  const ok = expr.includes(' OR ')
    ? expr.split(' OR ').some((x) => ALLOWED.has(x.trim()))
    : expr.split(' AND ').every((x) => ALLOWED.has(x.trim()));
  if (!ok) bad.push(`${p.name}@${p.version}: ${raw}`);
}
if (bad.length) {
  console.error(`LICENCE GATE FAILED — ${bad.length} production dependenc${bad.length === 1 ? 'y' : 'ies'} not on the allow-list:`);
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`licence gate ok: ${pkgs.length} production packages, all permissive`);
