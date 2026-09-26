/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// GitHub Pages serves the site under /<repo>/. The deploy workflow sets VITE_BASE;
// locally everything runs from "/".
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000, // Phaser alone is ~1.2 MB
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
