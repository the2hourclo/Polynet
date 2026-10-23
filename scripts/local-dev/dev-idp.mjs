#!/usr/bin/env node
// Local-only OIDC provider for running Polynet against a local Convex backend.
// Never point a hosted deployment at this. It signs in a dev user with no
// password, and its keys live in scripts/local-dev/.state/.
//
// Auto sign-in: /authorize signs in DEV_IDP_AUTO_USER (default "owner") at once.
// DEV_IDP_AUTO_USER=off shows the picker instead. A one-off hint overrides it:
// ?dev_user=<key> on /authorize, or GET /as?user=<key>&next=<url> first (sets a
// short-lived cookie, then redirects to next).
//
//   GET  /authorize                   sign in the auto/hinted user, or pick one
//   GET  /as                          set a one-off dev_user hint, then redirect
//   POST /token                       authorization_code (PKCE S256) + refresh_token
//   GET  /.well-known/jwks.json       RS256 public key
//   GET  /.well-known/openid-configuration

import { createServer } from "node:http";
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_IDP, DEV_USERS } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, ".state");
const keyFile = join(stateDir, "dev-idp-key.json");

function loadOrCreateKey() {
  mkdirSync(stateDir, { recursive: true });
  if (existsSync(keyFile)) {
    const saved = JSON.parse(readFileSync(keyFile, "utf8"));
    return { privateKey: createPrivateKey(saved.privatePem), kid: saved.kid, refreshSecret: saved.refreshSecret };
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const saved = {
    kid: `dev-${randomBytes(6).toString("hex")}`,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    refreshSecret: randomBytes(32).toString("hex"),
  };
  writeFileSync(keyFile, JSON.stringify(saved, null, 2));
  return { privateKey, kid: saved.kid, refreshSecret: saved.refreshSecret };
}

const { privateKey, kid, refreshSecret } = loadOrCreateKey();
const publicJwk = { ...createPublicKey(privateKey).export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

const b64url = (input) => Buffer.from(input).toString("base64url");

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

// Refresh tokens are stateless and HMAC-signed so they survive restarts.
function makeRefreshToken(userKey) {
  const body = `${userKey}.${randomBytes(12).toString("base64url")}`;
  const mac = createHmac("sha256", refreshSecret).update(body).digest("base64url");
  return `rt.${body}.${mac}`;
}

function readRefreshToken(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "rt") return null;
  const body = `${parts[1]}.${parts[2]}`;
  const expected = Buffer.from(createHmac("sha256", refreshSecret).update(body).digest("base64url"));
  const provided = Buffer.from(parts[3]);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return DEV_USERS[parts[1]] ? parts[1] : null;
}

function issueTokens(userKey) {
  const user = DEV_USERS[userKey];
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: DEV_IDP.issuer,
    sub: user.sub,
    aud: DEV_IDP.clientId,
    email: user.email,
    email_verified: true,
    name: user.name,
    given_name: user.givenName,
    family_name: user.familyName,
    iat: now,
    nbf: now - 5,
    exp: now + DEV_IDP.accessTokenTtlSeconds,
  };
  return {
    token_type: "Bearer",
    access_token: signJwt({ ...claims, jti: randomBytes(8).toString("hex") }),
    id_token: signJwt(claims),
    refresh_token: makeRefreshToken(userKey),
    expires_in: DEV_IDP.accessTokenTtlSeconds,
    scope: "openid profile email offline_access",
    user: {
      id: user.sub,
      email: user.email,
      email_verified: true,
      first_name: user.givenName,
      last_name: user.familyName,
    },
  };
}

const pendingCodes = new Map();

const AUTO_USER = String(process.env.DEV_IDP_AUTO_USER ?? "owner").trim().toLowerCase();
const HINT_COOKIE = "dev_idp_user";

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Hint (query, then cookie) wins over the env default; "off" or unknown = picker.
function pickAutoUser(req, params) {
  for (const candidate of [params.get("dev_user"), readCookie(req, HINT_COOKIE), AUTO_USER]) {
    const key = String(candidate ?? "").trim().toLowerCase();
    if (!key) continue;
    return DEV_USERS[key] ? key : null;
  }
  return null;
}

function redirectWithCode(res, params, userKey, extraHeaders = {}) {
  const redirect = new URL(params.get("redirect_uri"));
  const code = randomBytes(24).toString("base64url");
  pendingCodes.set(code, {
    userKey,
    clientId: params.get("client_id"),
    redirectUri: params.get("redirect_uri"),
    challenge: params.get("code_challenge"),
    method: params.get("code_challenge_method") || "S256",
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  redirect.searchParams.set("code", code);
  if (params.get("state")) redirect.searchParams.set("state", params.get("state"));
  return send(res, 302, "", { Location: redirect.toString(), ...extraHeaders });
}

const clearHintCookie = { "Set-Cookie": `${HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderPicker(params) {
  const hidden = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"]
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key))}">`)
    .join("");
  const buttons = Object.entries(DEV_USERS)
    .map(
      ([key, user]) =>
        `<button name="user" value="${key}"><strong>${escapeHtml(user.label)}</strong><span>${escapeHtml(user.email)}</span></button>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Polynet dev sign-in</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#f6f6f4;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border:1px solid #ddd;border-radius:14px;padding:28px;width:min(380px,90vw)}
h1{font-size:18px;margin:0 0 4px}p{color:#666;font-size:13px;margin:0 0 18px}
button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:12px 14px;margin:0 0 10px;border:1px solid #ccc;border-radius:10px;background:#fafafa;cursor:pointer;font-size:15px}
button:hover{border-color:#111}button span{font-size:12px;color:#777}</style></head>
<body><main><h1>Polynet local sign-in</h1><p>Local dev identity provider. Pick who to sign in as.</p>
<form method="post" action="/authorize">${hidden}${buttons}</form></main></body></html>`;
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function oauthError(res, status, error, description) {
  sendJson(res, status, { error, error_description: description });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", DEV_IDP.issuer);
  try {
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      return sendJson(res, 200, { keys: [publicJwk] });
    }
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return sendJson(res, 200, {
        issuer: DEV_IDP.issuer,
        authorization_endpoint: `${DEV_IDP.issuer}/authorize`,
        token_endpoint: `${DEV_IDP.issuer}/token`,
        jwks_uri: `${DEV_IDP.issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256"],
        subject_types_supported: ["public"],
      });
    }
    if (url.pathname === "/authorize" && req.method === "GET") {
      if (url.searchParams.get("client_id") !== DEV_IDP.clientId) {
        return send(res, 400, "Unknown client_id.");
      }
      if (!url.searchParams.get("redirect_uri") || !url.searchParams.get("code_challenge")) {
        return send(res, 400, "redirect_uri and code_challenge are required.");
      }
      const autoUser = pickAutoUser(req, url.searchParams);
      if (autoUser) return redirectWithCode(res, url.searchParams, autoUser, clearHintCookie);
      return send(res, 200, renderPicker(url.searchParams), { "Content-Type": "text/html; charset=utf-8" });
    }
    if (url.pathname === "/as" && req.method === "GET") {
      const userKey = String(url.searchParams.get("user") ?? "").trim().toLowerCase();
      if (!DEV_USERS[userKey]) return send(res, 400, "Unknown dev user.");
      const next = url.searchParams.get("next") ?? "";
      if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(next)) return send(res, 400, "next must be a local URL.");
      return send(res, 302, "", {
        Location: next,
        "Set-Cookie": `${HINT_COOKIE}=${userKey}; Path=/; Max-Age=120; HttpOnly; SameSite=Lax`,
      });
    }
    if (url.pathname === "/authorize" && req.method === "POST") {
      const form = await readForm(req);
      const userKey = form.get("user");
      if (!DEV_USERS[userKey]) return send(res, 400, "Unknown dev user.");
      if (form.get("client_id") !== DEV_IDP.clientId) return send(res, 400, "Unknown client_id.");
      return redirectWithCode(res, form, userKey);
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const form = await readForm(req);
      const grantType = form.get("grant_type");
      if (form.get("client_id") !== DEV_IDP.clientId) {
        return oauthError(res, 401, "invalid_client", "Unknown client_id.");
      }
      if (grantType === "authorization_code") {
        const pending = pendingCodes.get(form.get("code") ?? "");
        pendingCodes.delete(form.get("code") ?? "");
        if (!pending || pending.expiresAt < Date.now()) {
          return oauthError(res, 400, "invalid_grant", "Code is unknown or expired.");
        }
        if (form.get("redirect_uri") && form.get("redirect_uri") !== pending.redirectUri) {
          return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch.");
        }
        const verifier = form.get("code_verifier") ?? "";
        const computed =
          pending.method === "plain" ? verifier : createHash("sha256").update(verifier).digest("base64url");
        if (!verifier || computed !== pending.challenge) {
          return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
        }
        return sendJson(res, 200, issueTokens(pending.userKey));
      }
      if (grantType === "refresh_token") {
        const userKey = readRefreshToken(form.get("refresh_token"));
        if (!userKey) return oauthError(res, 400, "invalid_grant", "Refresh token is invalid.");
        return sendJson(res, 200, issueTokens(userKey));
      }
      return oauthError(res, 400, "unsupported_grant_type", `Unsupported grant_type ${grantType}.`);
    }
    if (url.pathname === "/" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, issuer: DEV_IDP.issuer, users: Object.keys(DEV_USERS) });
    }
    send(res, 404, "Not found.");
  } catch (error) {
    sendJson(res, 500, { error: "server_error", error_description: String(error?.message ?? error) });
  }
});

server.listen(DEV_IDP.port, DEV_IDP.host, () => {
  const mode = DEV_USERS[AUTO_USER] ? `auto sign-in as ${AUTO_USER}` : "picker";
  console.log(`[dev-idp] ${DEV_IDP.issuer} (client ${DEV_IDP.clientId}, ${mode})`);
});
