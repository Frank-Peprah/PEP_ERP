/**
 * Bars-plus-line chart drawn as plain SVG (about 3 KB instead of a 105 KB charting library).
 * Measures its own width so text stays at true size on every screen; hover or tap a month for values.
 * No animation: dashboards are opened many times a day.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export interface ComboDatum { key: string; label: string; bars: (number | null)[]; line: number | null }
export interface ComboSeries { name: string; color: string }

function niceTicks(min: number, max: number, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, raw = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export function ComboChart({ data, bars, line, height = 280, format, renderTip, ariaLabel }: {
  data: ComboDatum[]; bars: ComboSeries[]; line: ComboSeries; height?: number; ariaLabel: string;
  format: (v: number) => string; renderTip: (d: ComboDatum) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const values = data.flatMap((d) => [...d.bars, d.line]).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0], hi = ticks.at(-1)!;
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / Math.max(data.length, 1);
  const bw = Math.min(14, (band - 10) / bars.length);
  const cx = (i: number) => pad.l + band * i + band / 2;
  const pts = data.map((d, i) => (d.line === null ? null : [cx(i), y(d.line)] as const));
  const segs: string[] = []; let cur = '';
  pts.forEach((p) => { if (p) cur += `${cur ? 'L' : 'M'}${p[0]},${p[1]}`; else if (cur) { segs.push(cur); cur = ''; } });
  if (cur) segs.push(cur);
  const tipLeft = hover === null ? 0 : Math.min(Math.max(cx(hover) - 90, 0), width - 200);

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" style={{ height }} onMouseLeave={() => setHover(null)}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#cbd3e3' : '#eef1f6'} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#5b6b80" className="num">{format(t)}</text>
          </g>
        ))}
        {hover !== null && <rect x={pad.l + band * hover + 2} y={pad.t} width={band - 4} height={ih} rx="6" fill="rgb(37 99 235 / 0.06)" />}
        {data.map((d, i) => (
          <g key={d.key}>
            {d.bars.map((v, k) => v === null ? null : (
              <rect key={k} x={cx(i) - (bars.length * bw + (bars.length - 1) * 2) / 2 + k * (bw + 2)} width={bw}
                y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="3" fill={bars[k].color} />
            ))}
            <text x={cx(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="#5b6b80">{d.label}</text>
          </g>
        ))}
        {segs.map((s, i) => <path key={i} d={s} fill="none" stroke={line.color} strokeWidth="2.2" strokeLinejoin="round" />)}
        {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4.5 : 3.2} fill={line.color} />)}
        {data.map((d, i) => (
          <rect key={d.key} x={pad.l + band * i} y={pad.t} width={band} height={ih + pad.b} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover((h) => (h === i ? null : i))} />
        ))}
      </svg>
      {hover !== null && data.at(hover) && (
        <div className="pointer-events-none absolute top-2 z-10 w-[200px] rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-overlay)]" style={{ left: tipLeft }}>
          {renderTip(data.at(hover)!)}
        </div>
      )}
    </div>
  );
}
