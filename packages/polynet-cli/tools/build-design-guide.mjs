#!/usr/bin/env node
// Copies the polynet-ui-design skill into shared/ as one Markdown string, so
// agents that only use Polynet's MCP can read it at
// /communities/<slug>/builder/design-guide.md. The skill in guide/skills is the
// source; run this after changing it (a test fails if the copy is stale).
//
//   node packages/polynet-cli/tools/build-design-guide.mjs
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const SKILL = "packages/polynet-cli/guide/skills/polynet-ui-design";
export const DESIGN_GUIDE_TARGET = "shared/communityDesignGuide.ts";

export async function buildDesignGuide() {
  const skill = (await readFile(join(repo, SKILL, "SKILL.md"), "utf8")).replace(/^---\n[\s\S]*?\n---\n+/, "");
  const inTheApp = await readFile(join(repo, SKILL, "references/in-the-app.md"), "utf8");
  const markdown = `${skill.trimEnd()}\n\n---\n\n${inTheApp.trimEnd()}\n`;
  return `// Generated from ${SKILL} by packages/polynet-cli/tools/build-design-guide.mjs. Do not edit.\n` +
    `export const COMMUNITY_DESIGN_GUIDE_MARKDOWN = ${JSON.stringify(markdown)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(join(repo, DESIGN_GUIDE_TARGET), await buildDesignGuide());
  console.log(`✓ ${DESIGN_GUIDE_TARGET} from ${SKILL}`);
}
