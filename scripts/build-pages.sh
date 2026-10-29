#!/usr/bin/env bash
# Build the web app for GitHub Pages and lay it out exactly as Pages serves the repo root:
#   /index.html  → redirect to app/        /404.html → redirect to app/
#   /.nojekyll   → serve files as-is       /app/     → the built React app (relative asset paths)
# Used by .github/workflows/deploy-pages.yml and runnable locally. Output: ./_site (artefact) and ./app (committed).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_API_BASE:=https://ppyancjjjsaogyjpkxcr.supabase.co/functions/v1/pep-api}"
export VITE_API_BASE VITE_BASE=./ VITE_ROUTER=hash   # Pages has no URL rewrites: #/entity/screen routes

npm run build:web
rm -f apps/web/dist/.htaccess                          # Apache-only
grep -q 'src="./assets/' apps/web/dist/index.html || { echo "expected relative asset paths"; exit 1; }
./scripts/check-budgets.sh apps/web/dist

rm -rf app && cp -r apps/web/dist app

rm -rf _site && mkdir -p _site
cp -r app _site/app
cp index.html 404.html .nojekyll _site/
echo "built: app/ ($(find app -type f | wc -l) files) and _site/ for Pages"
