// A community's design as a folder, edited like a website: pull it, change the
// files, watch the draft preview, publish. Everything goes through the same
// MCP tools any agent uses, and through the same draft the app's editor saves,
// so the app, an agent and this CLI never disagree about what is live.
// Contract: docs/community-design-contract.md.

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { dirname, join } from "node:path";
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

/** Writes the community's current draft theme into the folder. */
export async function pullDesign({ root, community, call }) {
  const theme = await readTheme({ community, call });
  await writeFile(join(root, "theme.json"), json(theme.draft));
  await writeState(root, { community, draft_revision: theme.draft_revision });
  return theme;
}

export async function listTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  const names = (await readdir(TEMPLATES_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const templates = [];
  for (const name of names.sort()) {
    try {
      templates.push({ name, ...JSON.parse(await readFile(join(TEMPLATES_DIR, name, "template.json"), "utf8")) });
    } catch {
      // A folder without template.json isn't a template.
    }
  }
  return templates;
}

/** Starts a design folder from a template: its theme and anything else it ships, never content. */
export async function initFromTemplate({ root, template }) {
  const source = join(TEMPLATES_DIR, template);
  if (!existsSync(join(source, "template.json"))) {
    const names = (await listTemplates()).map((entry) => entry.name);
    throw new Error(`No template named "${template}".${names.length ? ` Templates: ${names.join(", ")}.` : ""}`);
  }
  if (existsSync(join(root, "theme.json"))) throw new Error("This folder already has a theme.json. Start a template in an empty folder.");
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === "template.json") continue;
    await cp(join(source, entry), join(root, entry), { recursive: true });
  }
  return JSON.parse(await readFile(join(source, "template.json"), "utf8"));
}

/**
 * Saves the folder's theme.json as the draft. `check(theme)` returns problems
 * (the CLI passes its contract check); errors stop the save before Polynet sees it.
 */
export async function saveFolderDraft({ root, community, call, check }) {
  const theme = JSON.parse(await readFile(join(root, "theme.json"), "utf8"));
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

/** Calls `onChange` (debounced) whenever theme.json changes. Returns a function that stops watching. */
export function watchDesign({ root, onChange, delayMs = 300 }) {
  let timer = null;
  let last = null;
  const watcher = watch(root, (_event, file) => {
    if (file !== "theme.json") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const stamp = await stat(join(root, "theme.json")).then((info) => info.mtimeMs, () => null);
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
