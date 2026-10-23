#!/usr/bin/env node
// Seeds the LOCAL stack with Rashid's two communities so they can be previewed
// inside the real app. Everything goes through the app's own sign-in and its
// own Convex functions, signed in as the dev owner (scripts/local-dev/dev-idp).
// Course content is read from this PC at seed time and never committed.
//
//   node scripts/seed-preview/seed.mjs
//
// Needs the local stack running (npm run local). Safe to re-run: existing
// communities, courses and lessons are matched by slug/name/title and updated.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { parseCommunityLessonMarkdown } from "../../shared/communityLessonContract.ts";
import { DEV_IDP, LOCAL_CONVEX, WEB_ORIGIN } from "../local-dev/config.mjs";
import { COMMUNITY_CONTENT } from "../local-dev/content-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const convexCli = join(repoRoot, "node_modules", "convex", "bin", "main.js");
const themes = JSON.parse(readFileSync(join(here, "themes.json"), "utf8"));
const SITE_TEMPLATE = process.env.VITE_POLYNET_SITE_ORIGIN_TEMPLATE || "http://127.0.0.1:8797/sites/{slug}";

const COMMUNITIES = [
  {
    slug: "ai-employee-builders",
    name: "AI Employee Builders",
    oneLiner: "Build AI Employees that run real parts of your business.",
    theme: themes.clo,
  },
  {
    slug: "the-2-hour-club",
    name: "The 2 Hour Club",
    oneLiner: "Two focused hours a day, with AI doing the rest.",
    theme: themes.stopwatch,
  },
];

const log = (...args) => console.log("[seed]", ...args);
const api = anyApi;

// ---------------------------------------------------------------- local guard

function assertLocal() {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(LOCAL_CONVEX.cloudUrl)) throw new Error("Seed only runs against a loopback backend.");
  const envLocal = existsSync(join(repoRoot, ".env.local")) ? readFileSync(join(repoRoot, ".env.local"), "utf8") : "";
  if (!/^CONVEX_DEPLOYMENT=(anonymous|local):/m.test(envLocal)) {
    throw new Error("Refusing: .env.local does not select a local Convex deployment.");
  }
}

function convexCliRun(args) {
  const result = spawnSync(process.execPath, [convexCli, ...args], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`convex ${args[0]} failed: ${result.stderr || result.stdout}`);
  // `convex run` prints nothing for a null result.
  return result.stdout.trim() || "null";
}

// AIEB course.json files carry no title; the folder name is the title.
const TITLE_WORDS = { ai: "AI", x: "X", ray: "Ray", claude: "Claude", code: "Code" };
function titleFromFolder(folder) {
  return folder
    .replace(/^\d+-/, "")
    .split("-")
    .map((word, index) => TITLE_WORDS[word] ?? (index === 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
    .replace(/\bX Ray\b/, "X-Ray");
}

// ------------------------------------------------- sign in through the real app

function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (/Max-Age=0/i.test(raw) || !value) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

async function signIn(userKey) {
  const jar = cookieJar();
  const start = await fetch(`${WEB_ORIGIN}/api/auth/google/start?return_to=/`, { redirect: "manual" });
  jar.absorb(start);
  const authorizeUrl = new URL(start.headers.get("location") ?? "");
  if (!authorizeUrl.href.startsWith(DEV_IDP.issuer)) {
    throw new Error(`Sign-in did not reach the dev IdP: ${authorizeUrl.href}`);
  }
  const form = new URLSearchParams({ user: userKey });
  for (const key of ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"]) {
    form.set(key, authorizeUrl.searchParams.get(key) ?? "");
  }
  const chosen = await fetch(`${DEV_IDP.issuer}/authorize`, { method: "POST", body: form, redirect: "manual" });
  const callback = await fetch(chosen.headers.get("location") ?? "", {
    headers: { cookie: jar.header() },
    redirect: "manual",
  });
  jar.absorb(callback);
  if (/error=/.test(callback.headers.get("location") ?? "")) {
    throw new Error(`Sign-in failed: ${decodeURIComponent(callback.headers.get("location"))}`);
  }
  const session = await (await fetch(`${WEB_ORIGIN}/api/auth/session`, { headers: { cookie: jar.header() } })).json();
  const token = session?.session?.access_token;
  if (!token) throw new Error(`No session for ${userKey}: ${JSON.stringify(session)}`);
  const client = new ConvexHttpClient(LOCAL_CONVEX.cloudUrl);
  client.setAuth(token);
  return { client, sub: session.session.user.id };
}

// --------------------------------------------------------------------- media

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

async function uploadFile(uploadUrl, file) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" },
    body: readFileSync(file),
  });
  if (!response.ok) throw new Error(`Upload failed for ${file}: ${response.status}`);
  return (await response.json()).storageId;
}

function firstImage(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = firstImage(path);
      if (found) return found;
    } else if (MIME[extname(entry.name).toLowerCase()]) {
      return path;
    }
  }
  return null;
}

// --------------------------------------------------------------- user setup

async function ensureProfile(client, { displayName, handle, avatarFile }) {
  const { uploadUrl } = await client.mutation(api.profiles.generateProfileAvatarUploadUrl, {});
  const avatarStorageId = await uploadFile(uploadUrl, avatarFile);
  const legal = await import("../../shared/legalDocuments.ts");
  await client.mutation(api.profiles.upsertProfileDetail, {
    displayName,
    handle,
    avatarStorageId,
    termsOfServiceVersion: legal.TERMS_OF_SERVICE_VERSION,
    privacyPolicyVersion: legal.PRIVACY_AI_DATA_POLICY_VERSION,
    completeOnboarding: true,
  });
}

// The one row the app has no self-serve path for: the first platform owner
// (it lets the owner create communities without a Stripe founder plan).
function ensurePlatformOwner(sub) {
  const found = JSON.parse(
    convexCliRun([
      "run",
      "--inline-query",
      `const u = await ctx.db.query("users").withIndex("by_authSubject", q => q.eq("authSubject", ${JSON.stringify(sub)})).first();
       const r = u ? await ctx.db.query("operatorRoles").withIndex("by_user", q => q.eq("userId", u._id)).first() : null;
       return { userId: u?._id ?? null, email: u?.email ?? null, hasRole: Boolean(r) };`,
    ]),
  );
  if (!found.userId) throw new Error("Owner user row not found after sign-in.");
  if (found.hasRole) return found.userId;
  const dir = mkdtempSync(join(tmpdir(), "polynet-seed-"));
  const file = join(dir, "operatorRoles.jsonl");
  const now = Date.now();
  writeFileSync(
    file,
    `${JSON.stringify({
      userId: found.userId,
      email: found.email,
      normalizedEmail: String(found.email ?? "").toLowerCase(),
      role: "owner",
      active: true,
      createdAt: now,
      updatedAt: now,
    })}\n`,
  );
  convexCliRun(["import", "--table", "operatorRoles", "--append", "-y", file]);
  rmSync(dir, { recursive: true, force: true });
  log("granted the local platform owner role to the dev owner");
  return found.userId;
}

// -------------------------------------------------------------- communities

async function ensureCommunity(owner, spec, bannerFile) {
  const existingId = JSON.parse(
    convexCliRun([
      "run",
      "--inline-query",
      `return (await ctx.db.query("communities").withIndex("by_slug", q => q.eq("slug", ${JSON.stringify(spec.slug)})).first())?._id ?? null;`,
    ]),
  );
  if (existingId) return existingId;
  const { uploadUrl } = await owner.client.mutation(api.communityLifecycle.generateCommunityBrandingUploadUrl, {
    kind: "banner",
  });
  const bannerStorageId = bannerFile ? await uploadFile(uploadUrl, bannerFile) : null;
  const created = await owner.client.mutation(api.communityLifecycle.createCommunity, {
    name: spec.name,
    slug: spec.slug,
    oneLiner: spec.oneLiner,
    ...(bannerStorageId ? { bannerStorageId } : null),
    entryPolicy: "open",
  });
  log(`created community ${spec.slug}`);
  return created.id ?? created.community_id ?? created._id;
}

async function ensureTheme(owner, communityId, theme) {
  const state = await owner.client.query(api.communityThemes.getCommunityThemeDraft, { communityId });
  let revision = state.draftRevision;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(state.draft, theme) || state.draftRevision === 0) {
    const saved = await owner.client.mutation(api.communityThemes.saveCommunityThemeDraft, {
      communityId,
      expectedDraftRevision: revision,
      theme,
    });
    revision = saved.draftRevision;
  }
  await owner.client.mutation(api.communityThemes.publishCommunityThemeDraft, {
    communityId,
    expectedDraftRevision: revision,
  });
}

// ---------------------------------------------------------- courses/lessons

function readCourses(slug) {
  const root = COMMUNITY_CONTENT[slug];
  const siteOrigin = SITE_TEMPLATE.replace("{slug}", slug);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "course.json")))
    .map((entry) => entry.name)
    .sort()
    .map((folder) => {
      const dir = join(root, folder);
      const meta = JSON.parse(readFileSync(join(dir, "course.json"), "utf8"));
      const lessons = readdirSync(dir)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => {
          const parsed = parseCommunityLessonMarkdown(readFileSync(join(dir, name), "utf8"));
          // Lesson media lives on the community site (media/...). polynet-embed
          // blocks are kept exactly as written; the renderer resolves them.
          const body = parsed.body_md
            .replace(/\]\((?:\.\.\/)?media\//g, `](${siteOrigin}/media/`)
            .replace(/(<img[^>]*\ssrc=")(?:\.\.\/)?media\//g, `$1${siteOrigin}/media/`);
          return { file: name, title: parsed.title ?? basename(name, ".md"), lesson: parsed.lesson, body };
        });
      return {
        folder,
        name: meta.title || titleFromFolder(folder),
        description: meta.description ?? "",
        banner: meta.banner ? join(root, meta.banner) : null,
        status: meta.status === "draft" ? "draft" : "live",
        lessons,
      };
    });
}

function asList(result) {
  if (Array.isArray(result)) return result;
  for (const key of ["items", "modules", "resources", "rows", "page"]) if (Array.isArray(result?.[key])) return result[key];
  return [];
}

const canonical = (value) =>
  JSON.stringify(value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort()) : value);

const idOf = (row) => String(row?.id ?? row?._id ?? row?.module_id ?? row?.resource_id ?? "");

async function seedCourses(owner, ownerUserId, communityId, slug) {
  const courses = readCourses(slug);
  const modules = asList(
    await owner.client.query(api.communityResources.listCommunityResourceModules, { communityId, limit: 200 }),
  );
  const pending = [];
  const orderedModuleIds = [];
  for (const course of courses) {
    // Also match the first seed's folder-derived names so a re-run renames in place.
    const firstSeedName = course.folder.replace(/^\d+-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const sameCourse = (row) =>
      [course.name, firstSeedName].some((name) => String(row.name).toLowerCase() === name.toLowerCase());
    const matches = modules.filter(sameCourse);
    // Prefer the copy whose name is already right; remove extra copies.
    matches.sort((a, b) => Number(b.name === course.name) - Number(a.name === course.name));
    let module = matches[0];
    for (const extra of matches.slice(1)) {
      await owner.client.mutation(api.communityResources.deleteCommunityResourceModule, { moduleId: idOf(extra) });
      log(`${slug}: removed duplicate course "${extra.name}"`);
    }
    let bannerStorageId;
    if (course.banner && existsSync(course.banner) && !module?.banner_storage_id) {
      const { uploadUrl } = await owner.client.mutation(api.communityLifecycle.generateCommunityBrandingUploadUrl, {
        kind: "banner",
      });
      bannerStorageId = await uploadFile(uploadUrl, course.banner);
    }
    const payload = {
      name: course.name,
      description_md: course.description.slice(0, 1200),
      module_status: course.status,
      ...(bannerStorageId ? { banner_storage_id: bannerStorageId } : null),
    };
    module = await owner.client.mutation(api.communityResources.saveCommunityResourceModule, {
      communityId,
      ...(module ? { moduleId: idOf(module), isPatch: true } : null),
      payload,
    });
    const moduleId = idOf(module);
    orderedModuleIds.push(moduleId);
    log(`${slug}: course "${course.name}" (${course.status}, ${course.lessons.length} lessons)`);

    const resources = asList(
      await owner.client.query(api.communityResources.listCommunityResources, { communityId, limit: 500 }),
    );
    for (const lesson of course.lessons) {
      let page = resources.find(
        (row) => row.title === lesson.title && String(row.module_id ?? row.moduleId ?? "") === moduleId,
      );
      page = await owner.client.mutation(api.communityResources.saveCommunityResource, {
        communityId,
        ...(page ? { resourceId: idOf(page), isPatch: true } : null),
        payload: {
          title: lesson.title,
          type: "post",
          resource_role: "page",
          module_id: moduleId,
          body_md: lesson.body,
        },
      });
      pending.push({ resourceId: idOf(page), lesson: lesson.lesson });
    }
  }
  await owner.client.mutation(api.communityResources.reorderCommunityResourceModules, {
    communityId,
    moduleIds: orderedModuleIds,
  });
  await applyLessonFields(owner, ownerUserId, communityId, slug, pending);
}

// Lesson fields go through the builder changeset (edit_page.lesson), the same
// path the builder's agent uses. Staging is internal-only, so it runs through
// the local CLI; applying is the owner's own public mutation.
async function applyLessonFields(owner, ownerUserId, communityId, slug, pending) {
  const resources = asList(
    await owner.client.query(api.communityResources.listCommunityResources, { communityId, limit: 500 }),
  );
  const byId = new Map(resources.map((row) => [idOf(row), row]));
  const operations = [];
  for (const item of pending) {
    const row = byId.get(item.resourceId);
    if (!row) continue;
    if (canonical(row.lesson ?? null) === canonical(item.lesson ?? null)) continue;
    operations.push({
      op: "edit_page",
      resource_id: item.resourceId,
      expected_updated_at: typeof row.updated_at === "number" ? row.updated_at : Date.parse(row.updated_at),
      lesson: item.lesson,
    });
  }
  for (let i = 0; i < operations.length; i += 25) {
    const batch = operations.slice(i, i + 25);
    const staged = JSON.parse(
      convexCliRun([
        "run",
        "communityResources:stageCommunityResourceBuilderChangesetInternal",
        JSON.stringify({
          userId: ownerUserId,
          communityId,
          summary: `Seed lesson fields (${slug})`,
          operations: batch,
        }),
      ]),
    );
    await owner.client.mutation(api.communityResources.applyCommunityResourceBuilderChangeset, {
      communityId,
      changesetId: staged.changeset_id,
    });
  }
  log(`${slug}: lesson fields set on ${operations.length} pages`);
}

// ------------------------------------------------------------------ members

async function ensureMember(member, slug) {
  const result = await member.client.mutation(api.communityPublic.joinPublicCommunityBySlug, { communitySlug: slug });
  log(`${slug}: member join -> ${result?.status ?? result?.kind ?? JSON.stringify(result).slice(0, 120)}`);
}

// --------------------------------------------------------------------- main

async function main() {
  assertLocal();
  const avatar = firstImage(join(COMMUNITY_CONTENT["ai-employee-builders"], "media"));
  const owner = await signIn("owner");
  await ensureProfile(owner.client, { displayName: "Rashid", handle: "rashid_local", avatarFile: avatar });
  const ownerUserId = ensurePlatformOwner(owner.sub);
  const member = await signIn("member");
  await ensureProfile(member.client, { displayName: "Test Member", handle: "test_member", avatarFile: avatar });

  for (const spec of COMMUNITIES) {
    const courses = readCourses(spec.slug);
    const communityId = await ensureCommunity(owner, spec, courses.find((c) => c.banner)?.banner ?? null);
    await ensureTheme(owner, communityId, spec.theme);
    // The knowledge comes from the course content below, so close the setup wizard.
    await owner.client.mutation(api.communityBuilderKnowledgeSetup.completeBuilderKnowledgeSetup, { communityId });
    await seedCourses(owner, ownerUserId, communityId, spec.slug);
    await ensureMember(member, spec.slug);
  }
  log("done");
}

main().catch((error) => {
  console.error("[seed] failed:", error?.data ?? error?.message ?? error);
  process.exit(1);
});
