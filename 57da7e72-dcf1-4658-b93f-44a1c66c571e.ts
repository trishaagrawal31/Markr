import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import manifestJson from './src/manifest.json';

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
