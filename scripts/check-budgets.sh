#!/usr/bin/env bash
# Performance budgets (blueprint § Performance budgets): fail the build when a bundle is too large.
#   shell (entry chunk) <= 180 KB gzip; every lazily loaded module <= 80 KB gzip.
set -euo pipefail
dist="${1:-apps/web/dist}"
entry=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$dist/index.html" | head -1)
fail=0
for f in "$dist"/assets/*.js; do
  kb=$(( $(gzip -c "$f" | wc -c) / 1024 ))
  name=$(basename "$f")
  if [[ "assets/$name" == "$entry" ]]; then limit=180; kind=shell; else limit=80; kind=module; fi
  if (( kb > limit )); then echo "BUDGET FAIL: $name $kind ${kb} KB > ${limit} KB"; fail=1; else echo "budget ok:   $name $kind ${kb} KB (limit ${limit})"; fi
done
exit $fail
