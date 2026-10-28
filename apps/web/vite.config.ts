import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE: URL path the app is served from. '/' for root hosting (SiteGround, Netlify, local);
// '/PEP_ERP/' for GitHub Pages project sites (https://<user>.github.io/PEP_ERP/).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
