import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  root: 'client',
  // GitHub Pages serves the app from /mafia-online/; local dev and preview use /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  // Lets the host and phones notice when one of them runs an older version of the app.
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  // Older target so phones with older Safari/Chrome can still run the app (iOS 14+).
  build: { outDir: '../dist/web', emptyOutDir: true, target: ['es2020', 'safari14', 'chrome87'] },
  // The narrator's voice model runs in a module worker.
  worker: { format: 'es' },
  // Cross-origin isolation lets the voice model use several CPU threads locally. GitHub Pages
  // can't send these headers, so there the CPU fallback runs single-threaded (WebGPU is unaffected).
  server: { host: true, port: 5174, headers: ISOLATION },
  preview: { host: true, port: 4174, headers: ISOLATION },
});
