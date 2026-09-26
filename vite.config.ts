import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // Only isolate engines that are reached through lazy viewers.
          // Do not force React/i18n/query into manual chunks: Rollup can create
          // circular startup dependencies between them, which may leave the
          // WebView alive with a blank window before React mounts.
          if (id.includes('pdfjs-dist')) return 'viewer-pdf-engine';
          if (id.includes('mp4box')) return 'viewer-mp4-engine';
          if (id.includes('hls.js')) return 'viewer-hls-engine';

          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
