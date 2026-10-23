#!/usr/bin/env node
// Points the root .env and the LOCAL Convex deployment at the dev-idp.
// Refuses to touch anything that is not the local (127.0.0.1) deployment.
//
//   node scripts/local-dev/setup-env.mjs            write .env + set Convex env
//   node scripts/local-dev/setup-env.mjs --env-only write .env only

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_IDP, LOCAL_CONVEX, WEB_ORIGIN } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const stateDir = join(here, ".state");
const secretFile = join(stateDir, "bridge-secret");
const convexCli = join(repoRoot, "node_modules", "convex", "bin", "main.js");

function localSecret(file) {
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"));
  return readFileSync(file, "utf8").trim();
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function assertLocalDeployment() {
  const envLocal = parseEnvFile(join(repoRoot, ".env.local"));
  const deployment = String(envLocal.CONVEX_DEPLOYMENT ?? "");
  const url = String(envLocal.VITE_CONVEX_URL ?? "");
  if (!deployment.startsWith("anonymous:") && !deployment.startsWith("local:")) {
    throw new Error(`Refusing: CONVEX_DEPLOYMENT in .env.local is not a local deployment (${deployment || "unset"}).`);
  }
  if (url && !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
    throw new Error(`Refusing: VITE_CONVEX_URL in .env.local is not loopback (${url}).`);
  }
}

const secret = localSecret(secretFile);

// Values shared by the Vite/api process (root .env) and the Convex backend.
const shared = {
  ARX_DB_KEY: "dev-only-key",
  ARX_AUTH_AUTHORIZE_URL: `${DEV_IDP.issuer}/authorize`,
  ARX_AUTH_TOKEN_URL: `${DEV_IDP.issuer}/token`,
  ARX_AUTH_CLIENT_ID: DEV_IDP.clientId,
  ARX_AUTH_SCOPE: "openid profile email offline_access",
  ARX_AUTH_JWT_ISSUER: DEV_IDP.issuer,
  ARX_AUTH_JWT_JWKS_URL: `${DEV_IDP.issuer}/.well-known/jwks.json`,
  ARX_AUTH_JWT_AUDIENCE: DEV_IDP.clientId,
  ARX_AUTH_JWT_ALGORITHM: "RS256",
  ARX_MCP_AUTH_JWT_AUDIENCE: DEV_IDP.mcpAudience,
  ARX_MCP_RESOURCE_URL: `${WEB_ORIGIN}/runtime/mcp`,
  ARX_AUTH_BRIDGE_SECRET: secret,
  ARX_ALLOW_UNVERIFIED_AUTH_SUBJECT: "false",
  ARX_ALLOWED_APP_ORIGINS: `${WEB_ORIGIN},http://127.0.0.1:5174`,
  ARX_PUBLIC_APP_URL: WEB_ORIGIN,
  // Only used to sign checkout-recovery receipts; billing is not live locally.
  POLYNET_FOUNDER_CHECKOUT_RECOVERY_SECRET: localSecret(join(stateDir, "founder-recovery-secret")),
};

const webOnly = {
  VITE_CONVEX_URL: LOCAL_CONVEX.cloudUrl,
  VITE_CONVEX_SITE_URL: LOCAL_CONVEX.siteUrl,
  VITE_AUTH_JWT_ISSUER: DEV_IDP.issuer,
  VITE_PUBLIC_APP_URL: WEB_ORIGIN,
  VITE_POLYNET_SITE_ORIGIN_TEMPLATE: "http://127.0.0.1:8797/sites/{slug}",
};

function writeRootEnv() {
  const path = join(repoRoot, ".env");
  const wanted = { ...shared, ...webOnly };
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !(match[1] in wanted)) return line;
    seen.add(match[1]);
    return `${match[1]}=${wanted[match[1]]}`;
  });
  const missing = Object.keys(wanted).filter((key) => !seen.has(key));
  if (missing.length) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push("# Local stack (scripts/local-dev/setup-env.mjs)");
    for (const key of missing) next.push(`${key}=${wanted[key]}`);
  }
  writeFileSync(path, `${next.join("\n").replace(/\n+$/, "")}\n`);
  console.log(`[setup-env] wrote ${Object.keys(wanted).length} keys to .env`);
}

function setConvexEnv() {
  assertLocalDeployment();
  for (const [key, value] of Object.entries(shared)) {
    let result;
    // A push from `convex dev` can race env writes (OCC 503); retry a few times.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      result = spawnSync(process.execPath, [convexCli, "env", "set", key, value], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      if (result.status === 0 || !/503|OptimisticConcurrency/.test(result.stderr ?? "")) break;
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{}, 2000)"]);
    }
    if (result.status !== 0) {
      throw new Error(`convex env set ${key} failed: ${result.stderr || result.stdout}`);
    }
  }
  console.log(`[setup-env] set ${Object.keys(shared).length} env vars on the local Convex deployment`);
}

writeRootEnv();
if (!process.argv.includes("--env-only")) setConvexEnv();
