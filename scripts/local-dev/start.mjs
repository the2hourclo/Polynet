#!/usr/bin/env node
// `npm run local`: the whole local stack in one terminal.
//   1. dev-idp       http://127.0.0.1:8799   (local OIDC sign-in)
//   2. site-server   http://127.0.0.1:8797   (community sites + /open/<slug> links)
//   3. convex dev    http://127.0.0.1:3210   (anonymous LOCAL backend, pushes functions)
//   4. env           points .env + the local Convex env at the dev-idp
//   5. web           http://localhost:5174   (Vite + the /api/auth/* handlers)
// Ctrl+C stops everything. Nothing here talks to a hosted deployment.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPEN_COMMUNITIES, openCommunityUrl } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const convexCli = join(repoRoot, "node_modules", "convex", "bin", "main.js");
const viteCli = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");
const children = [];

function run(name, args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}]`.padEnd(9);
  const relay = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) out.write(`${prefix} ${line}\n`);
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix} exited (${code})`);
    if (!stopping) shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  if (!existsSync(join(repoRoot, ".env.local"))) {
    console.log("[local] no .env.local yet: creating the anonymous local Convex deployment");
    spawnSync(process.execPath, [convexCli, "dev", "--once", "--typecheck", "disable"], {
      cwd: repoRoot,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      stdio: "inherit",
    });
  }
  run("idp", [join(here, "dev-idp.mjs")]);
  run("site", ["--no-warnings", join(here, "site-server.mjs")]);
  run("convex", [convexCli, "dev", "--typecheck", "disable", "--tail-logs", "always"], {
    env: { CONVEX_AGENT_MODE: "anonymous" },
  });
  await waitFor("http://127.0.0.1:3210/version", "local Convex backend");
  await waitFor("http://127.0.0.1:8799/", "dev-idp");
  const env = spawnSync(process.execPath, [join(here, "setup-env.mjs")], { cwd: repoRoot, stdio: "inherit" });
  if (env.status !== 0) throw new Error("setup-env failed");
  run(
    "web",
    [viteCli, "--config", "../../scripts/local-dev/vite.local.config.ts", "--port", "5174", "--strictPort"],
    { cwd: join(repoRoot, "apps", "web") },
  );
  await waitFor("http://localhost:5174/api/auth/session", "web");
  console.log("\n[local] ready: http://localhost:5174  (seed: npm run seed:preview)");
  console.log("[local] open a community, already signed in as the owner (add ?as=member for the member):");
  for (const [slug, { label }] of Object.entries(OPEN_COMMUNITIES)) {
    console.log(`[local]   ${label.padEnd(22)} ${openCommunityUrl(slug)}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(`[local] ${error.message}`);
  shutdown(1);
});
