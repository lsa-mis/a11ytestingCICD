import { defineConfig } from "vite";

// Vanilla front-end: Vite serves index.html at the project root and bundles
// src/main.ts. No framework plugin is required.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
