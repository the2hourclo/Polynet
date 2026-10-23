#!/usr/bin/env node
// Local stand-in for https://{slug}.polynet.page, so lessons can frame their
// polynet-embed widgets during local development. Dev-only.
//
//   /__polynet/embed.js           EMBED_SOURCE from infra/community-edge
//   /sites/<slug>/embeds/*        from the slug's embeds folder
//   /sites/<slug>/media/*         from the slug's media folder
//   /open/<slug>[?as=member]      sign in (dev-idp auto sign-in) and land on
//                                 that community's Knowledge page
//
// Env:
//   POLYNET_SITE_PORT        default 8797
//   POLYNET_SITE_ALLOWED     comma-separated origins allowed to frame/fetch
//                            (default http://localhost:5174,http://127.0.0.1:5174)
//   POLYNET_CONTENT_ROOT     folder holding .dev/content and 2hc-content
//                            (default the Rashid Business polynet-site folder)
//   POLYNET_SITE_DIRS_JSON   optional {"<slug>":{"embeds":"...","media":"..."}}

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { EMBED_SOURCE } from "../../infra/community-edge/dispatch/src/embed.ts";
import { CONTENT_ROOT } from "./content-paths.mjs";
import { DEV_IDP, DEV_USERS, OPEN_COMMUNITIES, SITE_PORT, WEB_ORIGIN } from "./config.mjs";

const port = SITE_PORT;
const allowed = String(process.env.POLYNET_SITE_ALLOWED || "http://localhost:5174,http://127.0.0.1:5174")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const sites = process.env.POLYNET_SITE_DIRS_JSON
  ? JSON.parse(process.env.POLYNET_SITE_DIRS_JSON)
  : {
      "ai-employee-builders": {
        embeds: join(CONTENT_ROOT, "embeds"),
        media: join(CONTENT_ROOT, ".dev", "content", "media"),
      },
      "the-2-hour-club": {
        embeds: join(CONTENT_ROOT, "2hc-content", "embeds"),
        media: join(CONTENT_ROOT, "2hc-content", "media"),
      },
    };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};

function baseHeaders(req) {
  const origin = String(req.headers.origin ?? "");
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `frame-ancestors 'self' ${allowed.join(" ")}`,
    ...(allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : null),
  };
}

function sendFile(req, res, root, rel) {
  const base = resolve(root);
  const file = resolve(base, decodeURIComponent(rel));
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, baseHeaders(req));
    return res.end("Not found.");
  }
  res.writeHead(200, {
    ...baseHeaders(req),
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...baseHeaders(req), "Access-Control-Allow-Methods": "GET, OPTIONS" });
    return res.end();
  }
  if (url.pathname === "/__polynet/embed.js") {
    res.writeHead(200, { ...baseHeaders(req), "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(EMBED_SOURCE);
  }
  const open = /^\/open\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (open && OPEN_COMMUNITIES[open[1]]) {
    const start = new URL("/api/auth/google/start", WEB_ORIGIN);
    start.searchParams.set("return_to", OPEN_COMMUNITIES[open[1]].returnTo);
    const as = String(url.searchParams.get("as") ?? "").trim().toLowerCase();
    let location = start.toString();
    if (DEV_USERS[as]) {
      const hint = new URL("/as", DEV_IDP.issuer);
      hint.searchParams.set("user", as);
      hint.searchParams.set("next", location);
      location = hint.toString();
    }
    res.writeHead(302, { "Cache-Control": "no-store", Location: location });
    return res.end();
  }
  const match = /^\/sites\/([a-z0-9-]+)\/(embeds|media)\/(.+)$/.exec(url.pathname);
  if (match && sites[match[1]]?.[match[2]]) {
    return sendFile(req, res, sites[match[1]][match[2]], match[3]);
  }
  res.writeHead(404, baseHeaders(req));
  res.end("Not found.");
}).listen(port, "127.0.0.1", () => {
  console.log(`[site-server] http://127.0.0.1:${port}/sites/{slug} (frame-ancestors ${allowed.join(" ")})`);
});
