/** Display formatting (blueprint § Number and date rules). Arithmetic never happens here. */

/** Whole-unit money with thousands separators, rounded half-up on the string (no floats). */
export function wholeMoney(v: string): string {
  const neg = v.startsWith('-');
  const [i, f = '0'] = (neg ? v.slice(1) : v).split('.');
  let int = BigInt(i || '0');
  if (Number(f.slice(0, 1)) >= 5) int += 1n;
  const s = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg && int !== 0n ? `(${s})` : s;
}

/** Compact for chart axes and KPI subtitles only: 12.45m, 980k. */
export function compactMoney(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}bn` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0);
  return v < 0 ? `-${s}` : s;
}

const plurals = new Intl.PluralRules('en-GB');
export function plural(n: number, one: string, other: string) {
  return `${n.toLocaleString('en-GB')} ${plurals.select(n) === 'one' ? one : other}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-10-31' -> '31 Oct 2026' (string-based, no time-zone drift). */
export function dateLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function monthShort(ym: string) { return MONTHS[Number(ym.slice(5, 7)) - 1]; }
export function monthLong(ym: string) { return `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`; }

/** Greeting in the user's business time zone (Ghana, UTC+0, no daylight saving). */
export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Accra' }).format(now));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Relative time under 7 days, absolute date after. */
export function when(iso: string, now = Date.now()) {
  const diff = (now - Date.parse(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return plural(Math.floor(diff / 60), 'minute', 'minutes') + ' ago';
  if (diff < 86400) return plural(Math.floor(diff / 3600), 'hour', 'hours') + ' ago';
  if (diff < 7 * 86400) return plural(Math.floor(diff / 86400), 'day', 'days') + ' ago';
  return dateLabel(iso);
}

/** KPI-sized money: whole units, switching to 2-decimal millions/billions once the figure would not fit (full value stays in the title). */
export function kpiMoney(v: string): string {
  const whole = wholeMoney(v);
  if (whole.replace(/[^0-9]/g, '').length <= 9) return whole;
  const n = Number(v); const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}bn` : `${(a / 1e6).toFixed(2)}m`;
  return n < 0 ? `(${s})` : s;
}

/** Percentage change for display; very large swings read as a multiple. */
export function changeLabel(pct: number): string {
  const a = Math.abs(pct);
  if (a >= 1000) return `${(a / 100 + (pct > 0 ? 1 : 0)).toLocaleString('en-GB', { maximumFractionDigits: 0 })}× ${pct > 0 ? 'higher' : 'lower'}`;
  return `${a.toFixed(1)}%`;
}
