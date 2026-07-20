import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Version + build stamp shown in the on-screen footer. The version is the single
// source of truth in package.json; the build number is yyyymmdd.hhmm in UTC, stamped
// at build time so a stale deploy is obvious at a glance (no manual tracking).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const now = new Date();
const p = (n: number) => String(n).padStart(2, "0");
const buildStamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}.${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildStamp),
  },
  server: {
    port: 5173,
  },
});
