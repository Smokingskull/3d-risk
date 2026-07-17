#!/usr/bin/env node
/**
 * Capture a screenshot of the running client with headless Chrome — so globe /
 * label / HUD changes can be eyeballed locally instead of via a staging deploy.
 *
 * WebGL in headless Chrome is driven by SwiftShader (software), so this needs no
 * GPU and works in CI. The 3D scene loads models + textures async, so we give it a
 * virtual-time budget before the frame is grabbed.
 *
 * Usage (from apps/client, via `pnpm screenshot`):
 *   pnpm screenshot                                  # ?autostart=classic&cam=2.4 -> screenshot.png
 *   pnpm screenshot "?scenario=alexander&cam=1.9"    # a bundled scenario
 *   pnpm screenshot "?autostart=classic" globe.png   # custom output file
 *   pnpm screenshot https://staging.3drisk.iainwilson.uk/ live.png  # a remote URL (no dev server)
 *
 * The `?autostart=classic` and `?scenario=<id>` hooks are DEV-only, so a local
 * capture spins up `vite` automatically; a full http(s) URL skips that and shoots
 * the given page as-is.
 *
 * Env overrides: CHROME_PATH, PORT (default 5199), W/H (viewport, default
 * 1400x950), WAIT (virtual-time ms, default 9000).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const [, , rawTarget = "?autostart=classic&cam=2.4", rawOut = "screenshot.png"] = process.argv;
const PORT = Number(process.env.PORT) || 5199;
const [W, H] = [Number(process.env.W) || 1400, Number(process.env.H) || 950];
const WAIT = Number(process.env.WAIT) || 9000;
const out = resolve(process.cwd(), rawOut);

// A full URL shoots that page directly; anything else is a query/path against a
// freshly-started local dev server.
const isRemote = /^https?:\/\//.test(rawTarget);
const url = isRemote
  ? rawTarget
  : `http://localhost:${PORT}/${rawTarget.startsWith("?") || rawTarget.startsWith("/") ? rawTarget.replace(/^\//, "") : rawTarget}`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    console.error("No Chrome/Chromium found. Set CHROME_PATH to your browser binary.");
    process.exit(1);
  }
  return hit;
}

async function waitForServer(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Dev server did not respond at ${base} within ${timeoutMs}ms`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", rejectRun);
    child.on("exit", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${cmd} exited ${code}`))));
  });
}

const chrome = findChrome();
let vite = null;

try {
  if (!isRemote) {
    // strictPort so we fail loudly rather than silently shooting the wrong port.
    vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
    await waitForServer(`http://localhost:${PORT}/`);
  }

  await run(chrome, [
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    `--window-size=${W},${H}`,
    `--virtual-time-budget=${WAIT}`,
    `--screenshot=${out}`,
    url,
  ]);

  console.log(`Saved ${out}  (${url})`);
} finally {
  if (vite) vite.kill();
}
