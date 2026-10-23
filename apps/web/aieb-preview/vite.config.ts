// Preview of the AIEB portal inside Polynet's own web components, fed by local
// fixtures instead of Convex. Run from apps/web: npx vite --config aieb-preview/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const webModules = resolve(here, "../node_modules");

export default defineConfig({
  root: here,
  base: "./",
  publicDir: resolve(here, "public"),
  plugins: [react()],
  // Same dedupe as apps/web: shared/ must use apps/web's single React copy.
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: resolve(webModules, "react"),
      "react-dom": resolve(webModules, "react-dom"),
      "highlight.js": resolve(webModules, "highlight.js"),
      "lucide-react": resolve(webModules, "lucide-react"),
    },
  },
  define: { __POLYNET_BUILD_ID__: JSON.stringify("aieb-preview") },
  server: { port: 8790, fs: { allow: [resolve(here, "../../..")] } },
  build: { outDir: resolve(here, "dist"), emptyOutDir: true },
});
