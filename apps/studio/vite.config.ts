import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@packs": new URL("../../packs", import.meta.url).pathname,
    },
  },
  server: {
    fs: { allow: [repoRoot] },
    // Never watch the Rust build tree. It stages a whole bundled CPython
    // (tens of thousands of files), which exhausts the inotify limit and
    // kills the dev server with ENOSPC once the desktop app has been built.
    watch: { ignored: ["**/src-tauri/**", "**/tools/**", "**/dist/**"] },
  },
  build: {
    // Monaco and Blockly are large; this is a bundled local desktop app,
    // not a website, so bundle weight is not a paged-load concern.
    chunkSizeWarningLimit: 6000,
  },
  // replicad/opencascade.js (CAD Kernel Phase 1) load only inside
  // src/cad/worker.ts, a real ES module Worker -- the reference replicad
  // app's own config, needed for `?url`-imported .wasm to resolve inside a
  // worker context. See docs/decisions/cad-kernel-foundation.md.
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/testSetup.ts"],
  },
});
