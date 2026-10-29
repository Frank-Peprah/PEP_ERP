/** Three ascending bars, as in the reference mark. Decorative: the brand name always sits beside it. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="4" y="18" width="5.5" height="10" rx="1.2" fill="#F5B301" />
      <rect x="13" y="11" width="5.5" height="17" rx="1.2" fill="#F5B301" />
      <rect x="22" y="4" width="5.5" height="24" rx="1.2" fill="#F5B301" />
    </svg>
  );
}
