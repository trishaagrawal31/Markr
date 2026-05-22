import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import manifestJson from "./src/manifest.json";

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [
    react(), 
    crx({ 
      manifest,
      contentScripts: {
        injectCss: true, // Ensures styles load correctly in extensions
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
    cors: {
      origin: "*",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true, // Cleans the dist folder before every single build
  },
});