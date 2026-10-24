import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { COMMUNITY_DESIGN_CONTRACT_VERSION } from "../shared/communityDesignContract";
import { normalizeCommunityTheme } from "../shared/communityTheme";
import {
  TEMPLATES_DIR, draftPreviewUrl, initFromTemplate, listTemplates, publishFolderDraft, pullDesign, saveFolderDraft,
} from "../packages/polynet-cli/design.mjs";
import { checkTheme } from "../packages/polynet-cli/content.mjs";

test("every template is a valid design record on the current contract", async () => {
  const templates = await listTemplates();
  expect(templates.length).toBeGreaterThan(0);
  for (const template of templates) {
    expect(template.contract, template.name).toBe(COMMUNITY_DESIGN_CONTRACT_VERSION);
    expect(template.description, template.name).toBeTruthy();
    const files = readdirSync(join(TEMPLATES_DIR, template.name));
    expect(files, `${template.name} ships no content`).not.toContain("courses");
    const theme = JSON.parse(readFileSync(join(TEMPLATES_DIR, template.name, "theme.json"), "utf8"));
    expect(normalizeCommunityTheme(theme), template.name).toMatchObject({ ok: true });
  }
});

test("a folder goes from template to draft to published, and a stale folder can't overwrite a newer draft", async () => {
  const root = mkdtempSync(join(tmpdir(), "polynet-design-"));
  const themeFile = join(root, "theme.json");
  await initFromTemplate({ root, template: "stopwatch" });
  await expect(initFromTemplate({ root, template: "stopwatch" })).rejects.toThrow("already has a theme.json");
  await expect(initFromTemplate({ root: join(root, "x"), template: "nope" })).rejects.toThrow('No template named "nope"');

  // A stand-in for the MCP: one community's theme draft with revisions.
  let server = { draft: {}, draft_revision: 0, published: null as unknown };
  const calls: string[] = [];
  const call = async (tool: string, input: any) => {
    calls.push(input.operation ?? tool);
    if (tool === "polynet_read") return { body: JSON.stringify({ ...server, contract: 1 }) };
    if (input.input.expected_draft_revision !== server.draft_revision) throw new Error("theme_revision_conflict: The draft changed.");
    if (input.operation === "community.theme.save_draft") server = { ...server, draft: input.input.theme, draft_revision: server.draft_revision + 1 };
    else server = { ...server, published: server.draft };
    return { result: { ...server } };
  };
  const check = (theme: unknown) => checkTheme(theme);

  const first = await saveFolderDraft({ root, themeFile, community: "the-2-hour-club", call, check });
  expect(first).toMatchObject({ ok: true, saved: { draft_revision: 1 } });
  expect(await publishFolderDraft({ root, community: "the-2-hour-club", call })).toMatchObject({ draft_revision: 1 });
  expect((server.published as any).heading_case).toBe("upper");

  // Broken JSON and contract errors stop before Polynet is called.
  const before = calls.length;
  writeFileSync(themeFile, "{ not json");
  expect(await saveFolderDraft({ root, themeFile, community: "the-2-hour-club", call, check })).toMatchObject({ ok: false });
  writeFileSync(themeFile, JSON.stringify({ version: 1, schemes: { light: { background: "#FFFFFF", surface: "#FFFFFF", text: "#EEEEEE",
    muted: "#999999", border: "#DDDDDD", accent: "#2F55FF", on_accent: "#FFFFFF", button: "#171719", on_button: "#FFFFFF" } } }));
  const refused = await saveFolderDraft({ root, themeFile, community: "the-2-hour-club", call, check });
  expect(refused.ok).toBe(false);
  expect(JSON.stringify(refused.problems)).toContain("schemes.light.text");
  expect(calls.length).toBe(before);

  // Someone else saves a newer draft: this folder's next save is refused, then pull catches up.
  server = { ...server, draft_revision: 5 };
  writeFileSync(themeFile, JSON.stringify({ version: 1, radius: 4 }));
  await expect(saveFolderDraft({ root, themeFile, community: "the-2-hour-club", call, check })).rejects.toThrow("theme_revision_conflict");
  await pullDesign({ root, themeFile, community: "the-2-hour-club", call });
  writeFileSync(themeFile, JSON.stringify({ version: 1, radius: 4 }));
  expect(await saveFolderDraft({ root, themeFile, community: "the-2-hour-club", call, check })).toMatchObject({ ok: true, saved: { draft_revision: 6 } });

  expect(draftPreviewUrl("https://www.polynet.ai/", "the-2-hour-club")).toBe("https://www.polynet.ai/c/the-2-hour-club?design=draft");
});

test("a layout template keeps the founder's own colours and fonts, and uses its theme only when there is none", async () => {
  const templatesDir = mkdtempSync(join(tmpdir(), "polynet-templates-"));
  mkdirSync(join(templatesDir, "feed"));
  writeFileSync(join(templatesDir, "feed", "template.json"), JSON.stringify({ name: "feed", contract: 1, apply: { layout: "replace", theme: "keep_existing" } }));
  writeFileSync(join(templatesDir, "feed", "theme.json"), JSON.stringify({ version: 1, radius: 2 }));
  writeFileSync(join(templatesDir, "feed", "layout.json"), JSON.stringify({ version: 1, nav: "top" }));
  const ours = { version: 1, radius: 14, heading_case: "upper" };

  // The folder already has a theme: only the layout arrives.
  const folder = mkdtempSync(join(tmpdir(), "polynet-design-"));
  writeFileSync(join(folder, "theme.json"), JSON.stringify(ours));
  expect(await initFromTemplate({ root: folder, template: "feed", templatesDir })).toMatchObject({ theme: "kept" });
  expect(JSON.parse(readFileSync(join(folder, "theme.json"), "utf8"))).toEqual(ours);
  expect(JSON.parse(readFileSync(join(folder, "layout.json"), "utf8"))).toEqual({ version: 1, nav: "top" });

  // An empty folder for a community with a published theme gets the community's theme.
  const call = async () => ({ body: JSON.stringify({ contract: 1, draft: ours, draft_revision: 3, published: ours }) });
  const fresh = join(mkdtempSync(join(tmpdir(), "polynet-design-")), "c");
  expect(await initFromTemplate({ root: fresh, template: "feed", templatesDir, community: "the-2-hour-club", call })).toMatchObject({ theme: "community" });
  expect(JSON.parse(readFileSync(join(fresh, "theme.json"), "utf8"))).toEqual(ours);
  expect(JSON.parse(readFileSync(join(fresh, ".polynet", "design.json"), "utf8"))).toEqual({ community: "the-2-hour-club", draft_revision: 3 });

  // A community with no theme yet starts from the template's.
  const none = async () => ({ body: JSON.stringify({ contract: 1, draft: {}, draft_revision: 0, published: null }) });
  const blank = join(mkdtempSync(join(tmpdir(), "polynet-design-")), "c");
  expect(await initFromTemplate({ root: blank, template: "feed", templatesDir, community: "new-club", call: none })).toMatchObject({ theme: "template" });
  expect(JSON.parse(readFileSync(join(blank, "theme.json"), "utf8"))).toEqual({ version: 1, radius: 2 });
  expect(existsSync(join(blank, "layout.json"))).toBe(true);
});
