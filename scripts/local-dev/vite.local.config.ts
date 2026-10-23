// Dev-only Vite config for the local stack. It wraps apps/web/vite.config.ts
// unchanged and adds one plugin that serves the Vercel functions in api/**
// (the /api/auth/* sign-in bridge) from the dev server, Vercel-style:
// req.query is parsed, req.body is the raw/JSON body, handler(req, res).
//
//   cd apps/web && npx vite --config ../../scripts/local-dev/vite.local.config.ts

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import baseConfig from "../../apps/web/vite.config";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const apiRoot = resolve(repoRoot, "api");

function resolveHandlerFile(pathname: string): string | null {
  const rel = pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  if (!rel || rel.split("/").some((part) => !part || part.startsWith(".") || part.startsWith("_"))) return null;
  for (const candidate of [`${rel}.js`, `${rel}/index.js`]) {
    const file = resolve(apiRoot, candidate);
    if (file.startsWith(apiRoot) && existsSync(file)) return file;
  }
  return null;
}

async function readBody(req: any): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  if (!raw.length) return undefined;
  const type = String(req.headers["content-type"] ?? "");
  if (type.includes("application/json")) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return raw.toString("utf8");
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  }
  return raw;
}

function vercelApiPlugin() {
  return {
    name: "polynet-local-vercel-api",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const file = resolveHandlerFile(url.pathname);
        if (!file) {
          res.statusCode = 404;
          res.end("Not found.");
          return;
        }
        try {
          // Vercel always sets this; the handlers default to https without it.
          if (!req.headers["x-forwarded-proto"]) req.headers["x-forwarded-proto"] = "http";
          req.query = Object.fromEntries(url.searchParams);
          req.body = await readBody(req);
          // Reload on change so edits to api/** apply without restarting.
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          await mod.default(req, res);
        } catch (error) {
          server.config.logger.error(`[local-api] ${url.pathname}: ${(error as Error)?.stack ?? error}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
          }
          res.end(JSON.stringify({ ok: false, error: "local_api_handler_failed" }));
        }
      });
    },
  };
}

export default (env: any) => {
  const config = typeof baseConfig === "function" ? (baseConfig as any)(env) : baseConfig;
  return {
    ...config,
    root: resolve(repoRoot, "apps/web"),
    plugins: [vercelApiPlugin(), ...(config.plugins ?? [])],
  };
};
