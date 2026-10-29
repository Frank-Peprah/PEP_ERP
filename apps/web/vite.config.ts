import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE: URL path the app is served from. '/' for root hosting (SiteGround, Netlify, local);
// './' for the GitHub Pages build (relative assets). VITE_ROUTER=hash for hosts without rewrites.
// Content security policy (blueprint § Security): only our own scripts, styles and fonts; network calls only
// to this origin and the API origin. Hosts that can set headers (SiteGround .htaccess) repeat it as a header.
function csp(): Plugin {
  const origins = [process.env.VITE_API_BASE, process.env.VITE_SUPABASE_URL]
    .filter(Boolean).map((u) => new URL(u as string).origin);
  const api = [...new Set(origins)].join(' ');
  const policy = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
    "img-src 'self' data:", `connect-src 'self'${api ? ` ${api}` : ''}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; ');
  return {
    name: 'pep-csp', apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), csp()],
  build: { chunkSizeWarningLimit: 600, assetsInlineLimit: 0 },   // no data: URIs, so the CSP needs no data: fonts
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
