import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Client unit tests run in jsdom. `useHotseat` imports no Three.js, so the controller
// (and the extracted leaf hooks) test without WebGL; the AI worker fails to construct in
// jsdom, so `useAiWorker` falls back to a synchronous decide — CPU turns run in-process.
export default defineConfig({
  plugins: [react()],
  // Mirror the build-time defines so any module that reads them still compiles under test.
  define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"' },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
