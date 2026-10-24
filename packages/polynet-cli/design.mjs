// A community's design as a folder, edited like a website: pull it, change the
// files, watch the draft preview, publish. Everything goes through the same
// MCP tools any agent uses, and through the same draft the app's editor saves,
// so the app, an agent and this CLI never disagree about what is live.
// Contract: docs/community-design-contract.md.

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = join(HERE, "templates");

// .polynet/design.json remembers which draft the folder was last in step with,
// so a save or publish never overwrites someone else's newer change.
const STATE_FILE = join(".polynet", "design.json");

const themePath = (community) => `/communities/${community}/builder/theme.json`;
const capability = (community, operation) => `/communities/${community}/capabilities/${operation}.json`;

function parseDocument(document) {
  if (!document || typeof document.body !== "string") return null;
  try {
    return JSON.parse(document.body);
  } catch {
    return null;
  }
}

/** The community's theme: draft, published, and the draft revision to build on. */
export async function readTheme({ community, call }) {
  const theme = parseDocument(await call("polynet_read", { path: themePath(community) }));
  if (!theme) throw new Error("Polynet didn't return this community's theme.");
  return theme;
}

function idempotencyKey(community, operation, payload) {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
  return `design:${community}:${operation}:${hash}`;
}

async function callTheme({ community, call, operation, input }) {
  const value = await call("polynet_call", {
    operation,
    version: 1,
    target: capability(community, operation),
    input,
    idempotency_key: idempotencyKey(community, operation, input),
  });
  return value?.result ?? value;
}

/** Saves the theme as the draft only managers see. Refuses if the draft moved past `expectedRevision`. */
export async function saveThemeDraft({ community, theme, expectedRevision, call }) {
  return await callTheme({ community, call, operation: "community.theme.save_draft",
    input: { theme, expected_draft_revision: expectedRevision } });
}

/** Makes the draft live for members, if it is still the one at `expectedRevision`. */
export async function publishTheme({ community, expectedRevision, call }) {
  return await callTheme({ community, call, operation: "community.theme.publish",
    input: { expected_draft_revision: expectedRevision } });
}

async function readState(root) {
  try {
    return JSON.parse(await readFile(join(root, STATE_FILE), "utf8"));
  } catch {
    return null;
  }
}

async function writeState(root, state) {
  await mkdir(join(root, ".polynet"), { recursive: true });
  await writeFile(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Writes the community's current draft theme into the folder's theme file. */
export async function pullDesign({ root, themeFile, community, call }) {
  const theme = await readTheme({ community, call });
  await mkdir(dirname(themeFile), { recursive: true });
  await writeFile(themeFile, json(theme.draft));
  await writeState(root, { community, draft_revision: theme.draft_revision });
  return theme;
}

export async function listTemplates({ templatesDir = TEMPLATES_DIR } = {}) {
  if (!existsSync(templatesDir)) return [];
  const names = (await readdir(templatesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const templates = [];
  for (const name of names.sort()) {
    try {
      templates.push({ name, ...JSON.parse(await readFile(join(templatesDir, name, "template.json"), "utf8")) });
    } catch {
      // A folder without template.json isn't a template.
    }
  }
  return templates;
}

/**
 * Starts a design folder from a template: its theme, layout and anything else
 * it ships, never content. A template's `apply` says what it may overwrite:
 * `"theme": "keep_existing"` keeps the founder's own colours and fonts (the
 * folder's theme.json, or the community's theme when `community` and `call`
 * are given) and uses the template's theme only when there is none. Theme and
 * layout are separate records, so taking one never resets the other.
 */
export async function initFromTemplate({ root, template, community, call, templatesDir = TEMPLATES_DIR }) {
  const source = join(templatesDir, template);
  if (!existsSync(join(source, "template.json"))) {
    const names = (await listTemplates({ templatesDir })).map((entry) => entry.name);
    throw new Error(`No template named "${template}".${names.length ? ` Templates: ${names.join(", ")}.` : ""}`);
  }
  const chosen = JSON.parse(await readFile(join(source, "template.json"), "utf8"));
  const keepTheme = chosen.apply?.theme === "keep_existing";
  const themeFile = join(root, "theme.json");
  let theme = "template";
  if (existsSync(themeFile)) {
    if (!keepTheme) throw new Error("This folder already has a theme.json. Start a template in an empty folder.");
    theme = "kept";
  } else if (keepTheme && community && call) {
    const current = await readTheme({ community, call });
    if (current.published) {
      await pullDesign({ root, themeFile, community, call });
      theme = "community";
    }
  }
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === "template.json" || (entry === "theme.json" && theme !== "template")) continue;
    await cp(join(source, entry), join(root, entry), { recursive: true });
  }
  return { ...chosen, theme };
}

/**
 * Saves the folder's theme.json as the draft. `check(theme)` returns problems
 * (the CLI passes its contract check); errors stop the save before Polynet sees it.
 */
export async function saveFolderDraft({ root, themeFile, community, call, check }) {
  let theme;
  try {
    theme = JSON.parse(await readFile(themeFile, "utf8"));
  } catch (error) {
    return { ok: false, problems: [{ level: "error", path: basename(themeFile), message: `Not valid JSON: ${error instanceof Error ? error.message : error}` }] };
  }
  const problems = check ? check(theme) : [];
  if (problems.some((problem) => problem.level === "error")) return { ok: false, problems };
  const state = await readState(root);
  const revision = state?.community === community ? state.draft_revision : (await readTheme({ community, call })).draft_revision;
  const saved = await saveThemeDraft({ community, theme, expectedRevision: revision, call });
  await writeState(root, { community, draft_revision: saved.draft_revision });
  return { ok: true, problems, saved };
}

/** Publishes the draft the folder last saved. */
export async function publishFolderDraft({ root, community, call }) {
  const state = await readState(root);
  if (!state || state.community !== community) throw new Error("Nothing saved from this folder yet. Run polynet dev or polynet design save first.");
  return await publishTheme({ community, expectedRevision: state.draft_revision, call });
}

/** Calls `onChange` (debounced) whenever the theme file changes. Returns a function that stops watching. */
export function watchDesign({ themeFile, onChange, delayMs = 300 }) {
  let timer = null;
  let last = null;
  const watcher = watch(dirname(themeFile), (_event, file) => {
    if (file !== basename(themeFile)) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const stamp = await stat(themeFile).then((info) => info.mtimeMs, () => null);
      if (stamp === null || stamp === last) return;
      last = stamp;
      onChange();
    }, delayMs);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** The owner's draft preview of the community in the real app. */
export function draftPreviewUrl(appOrigin, community) {
  return `${appOrigin.replace(/\/$/, "")}/c/${community}?design=draft`;
}
