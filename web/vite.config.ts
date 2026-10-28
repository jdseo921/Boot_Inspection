/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // The Spring Boot API in development.
    proxy: {
      "/api": "http://localhost:8080",
      "/actuator": "http://localhost:8080",
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/main.tsx", "src/**/*.test.{ts,tsx}"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
