import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Plain React + Vite. The SEO story is static prerendering (scripts/prerender.mjs)
// plus per-route metadata, not a framework.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});
