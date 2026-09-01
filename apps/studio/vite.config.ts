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
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
