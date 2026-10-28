/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { sampleFormAnswers } from "./communityTestMemberAutoplay";
import { mergePersonaAnswers, parsePersonaReply } from "./communityTestMemberPersona";

const completion = vi.hoisted(() => ({ reply: vi.fn() }));
vi.mock("./communityInferenceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./communityInferenceProvider")>()),
  runCommunityFundedCompletion: (input: unknown) => completion.reply(input),
}));

const modules = import.meta.glob([
  "./auth.ts",
  "./authActor.ts",
  "./communityClients.ts",
  "./communityForms.ts",
  "./communityFormRequests.ts",
  "./communityInteractions.ts",
  "./communityMemberWorkflows.ts",
  "./communityResourceProgress.ts",
  "./communityTestMemberAutoplay.ts",
  "./communityTestMembers.ts",
  "./communityTestMemberPersona.ts",
  "./_generated/**/*.*s",
]);

const OWNER = "autoplay-owner";
const nowMs = 1_787_478_400_000;

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); completion.reply.mockReset(); });

const lessonBody = [
  "Install it.",
  "",
  "```button installed required",
  "I installed Claude Code",
  "```",
  "",
  "```quiz which required",
  "Where do you run it?",
  "- [ ] In Word",
  "- [x] In a terminal",
  "```",
].join("\n");

async function fixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authSubject: OWNER, displayName: "Ada Builder", createdAt: nowMs, updatedAt: nowMs });
    await ctx.db.insert("operatorRoles", { userId: ownerId, role: "owner", active: true, createdAt: nowMs, updatedAt: nowMs });
    const communityId = await ctx.db.insert("communities", {
      ownerId, slug: "autoplay", name: "Autoplay", lifecycleStatus: "active", visibility: "unlisted",
      inferenceFundingPolicy: "managed_required", entryPolicy: "open", activeMemberCount: 0, createdAt: nowMs, updatedAt: nowMs,
    });
    const moduleId = await ctx.db.insert("communityResourceModules", {
      communityId, createdByUserId: ownerId, status: "live", name: "Start", sortOrder: 1, createdAt: nowMs, updatedAt: nowMs,
    });
    const lessonId = await ctx.db.insert("communityResources", {
      communityId, moduleId, createdByUserId: ownerId, type: "post", role: "page", status: "published", lesson: { order: 1 },
      title: "Install Claude Code", bodyMd: lessonBody, bodyChars: lessonBody.length, pinned: false, sortOrder: 1, createdAt: nowMs, updatedAt: nowMs,
    } as any);
    for (const [key, name, questions] of [
      ["intake", "Intake", [
        { key: "goal", title: "Your goal", description: "", type: "long_text", required: true, options: [] },
        { key: "size", title: "Team size", description: "", type: "single_choice", required: true, options: ["Solo", "2-10"] },
      ]],
      ["checkpoint", "Checkpoint", [{ key: "proof", title: "Link to your setup", description: "", type: "short_text", required: true, options: [] }]],
    ] as const) {
      const formId = await ctx.db.insert("communityForms", {
        communityId, key, name, questions: questions as any, revision: 1, publishedRevision: 1, createdAt: nowMs, updatedAt: nowMs,
      });
      await ctx.db.insert("communityFormVersions", { communityId, formId, revision: 1, name, questions: questions as any, publishedBy: ownerId, publishedAt: nowMs });
    }
    await ctx.db.insert("communityMemberWorkflows", {
      communityId, welcomeGate: false, revision: 1, createdByUserId: ownerId, updatedByUserId: ownerId,
      milestones: [
        { key: "welcome", name: "Welcome", automations: [
          { key: "join", trigger: { type: "member_joined" }, action: { key: "send-intake", type: "request_form", formKey: "intake" } },
          { key: "greet", trigger: { type: "form_submitted", formKey: "intake" }, action: { key: "say-hi", type: "prompt_agent", prompt: "Welcome them" } },
          { key: "lesson", trigger: { type: "lesson_completed", resourceId: String(lessonId) },
            action: { key: "send-checkpoint", type: "request_form", formKey: "checkpoint" } },
        ] },
        { key: "week1", name: "First week", automations: [
          { key: "checkin", timerGeneration: "g1", trigger: { type: "milestone_elapsed", delayMinutes: 1440 },
            action: { key: "check-in", type: "prompt_agent", prompt: "Check in" } },
          { key: "intro", trigger: { type: "member_contributed" }, action: { key: "reply", type: "prompt_agent", prompt: "Reply to their intro" } },
        ] },
      ],
      createdAt: nowMs, updatedAt: nowMs,
    } as any);
    return { ownerId, communityId };
  });
}

test("sample answers fit each question's type and format", () => {
  expect(sampleFormAnswers([
    { key: "a", title: "Name", description: "", type: "short_text", required: true, options: [] },
    { key: "b", title: "Seats", description: "", type: "short_text", required: true, options: [], answerFormat: "number" },
    { key: "c", title: "Start", description: "", type: "short_text", required: true, options: [], answerFormat: "date" },
    { key: "d", title: "Site", description: "", type: "short_text", required: true, options: [], answerFormat: "url" },
    { key: "e", title: "Tools", description: "", type: "multiple_choice", required: true, options: ["x", "y"] },
  ], "Test member 1", nowMs)).toEqual({ a: "Sample answer from Test member 1", b: "3", c: "2026-08-23", d: "https://example.com", e: ["0"] });
});

test("autoplay walks a test member through the whole Workflow, previewing agent steps", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  const t = convexTest(schema, modules);
  const f = await fixture(t);
  const owner = t.withIdentity({ subject: OWNER });
  const started = await owner.mutation(api.communityTestMembers.startTestMember, { communityId: f.communityId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const args = { communityId: f.communityId, testMemberId: started.id as any };

  const beats: string[] = [];
  let status = "";
  for (let i = 0; i < 20 && status !== "finished"; i += 1) {
    const step = await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args);
    status = step.status;
    if (step.beat) beats.push(`${step.beat.ok ? "ok" : "failed"}: ${step.beat.text}`);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  expect(status).toBe("finished");
  expect(beats).toEqual([
    "ok: Filled in the Intake form with sample answers",
    "ok: Clicked “I installed Claude Code” in “Install Claude Code”",
    "ok: Answered the quiz “Where do you run it?” in “Install Claude Code”",
    "ok: Marked “Install Claude Code” complete",
    "ok: Filled in the Checkpoint form with sample answers",
    "ok: Posted an intro in the general channel",
    "ok: Skipped the 1 day wait",
  ]);

  // The test member's own tab follows along: it reads the latest step, and where it happened.
  const mine: any = await owner.query(api.communityTestMembers.getMyTestRun, { authSubject: started.auth_subject });
  expect(mine.autoplay).toMatchObject({ text: "Skipped the 1 day wait", path: null });
  await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, { ...args, stop: true });
  expect((await owner.query(api.communityTestMembers.getMyTestRun, { authSubject: started.auth_subject }) as any).autoplay).toBeNull();

  const sequence = await owner.query(api.communityTestMembers.getTestRunSequence, args);
  expect(sequence.completed_at).not.toBeNull();
  expect(sequence.stages.flatMap((stage: any) => stage.steps.map((step: any) => [step.key, step.status, step.note])))
    .toEqual([["join", "done", null], ["greet", "done", "Previewed, not sent"], ["lesson", "done", null],
      ["checkin", "done", "Previewed, not sent"], ["intro", "done", "Previewed, not sent"]]);
  // Nothing went to the agent.
  expect(await t.run(async (ctx) => (await ctx.db.query("communityAgentServeRequests").collect()).length)).toBe(0);

  // Ending the run takes the intro post down with it.
  await owner.mutation(api.communityTestMembers.endTestMember, args);
  const posts = await t.run(async (ctx) => (await ctx.db.query("communityInteractionRoots").collect()).map((row) => row.status));
  expect(posts).toEqual(["hidden"]);
});

test("on screen, the member tab does the step; one it doesn't take up is done in the background", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  const t = convexTest(schema, modules);
  const f = await fixture(t);
  const owner = t.withIdentity({ subject: OWNER });
  const started = await owner.mutation(api.communityTestMembers.startTestMember, { communityId: f.communityId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const args = { communityId: f.communityId, testMemberId: started.id as any, onScreenPace: 300 };
  const asTest = { authSubject: started.auth_subject };

  // The owner's player hands the form to the member tab.
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acting", beat: { text: "Filled in the Intake form with sample answers", on_screen: true } });
  const step = (await owner.query(api.communityTestMembers.getMyTestRun, asTest) as any).autoplay_step;
  expect(step).toMatchObject({ kind: "form", formName: "Intake", pace: 300, answers: { size: "0" } });
  await owner.mutation(api.communityTestMemberAutoplay.reportAutoplayScreenStep, { ...asTest, stepId: step.id, phase: "seen" });
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args)).resolves.toMatchObject({ status: "acting" });

  // The member tab fills it in through the member's own form, then says it's done.
  const forms = await owner.query(api.communityFormRequests.listMyRequests, { ...asTest, communityId: f.communityId }) as any[];
  await owner.mutation(api.communityFormRequests.saveMyAnswers, { ...asTest, communityId: f.communityId, requestId: forms[0].id,
    expectedRevision: 0, answers: step.answers, submit: true });
  await owner.mutation(api.communityTestMemberAutoplay.reportAutoplayScreenStep, { ...asTest, stepId: step.id, phase: "finished", ok: true });
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acted", beat: { ok: true, on_screen: true, text: "Filled in the Intake form with sample answers" } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  // The next step nobody takes up: after a few seconds Autoplay does it itself.
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args)).resolves.toMatchObject({ status: "acting" });
  vi.setSystemTime(nowMs + 6_000);
  const fallback = await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args);
  expect(fallback.beat).toMatchObject({ ok: true, text: "Clicked “I installed Claude Code” in “Install Claude Code”" });
  expect(fallback.beat?.on_screen).toBeUndefined();
  expect(fallback.beat?.detail).toContain("member tab isn't open");
});

const intakeQuestions = [
  { key: "goal", title: "Your goal", type: "long_text", options: [] },
  { key: "size", title: "Team size", type: "single_choice", options: ["Solo", "2-10"] },
  { key: "tools", title: "Tools", type: "multiple_choice", options: ["Notion", "Slack", "Kit"] },
  { key: "seats", title: "Seats", type: "short_text", options: [], answerFormat: "number" },
  { key: "site", title: "Site", type: "short_text", options: [], answerFormat: "url" },
];

test("persona replies keep only answers that fit each question", () => {
  const request = { kind: "form" as const, formName: "Intake", questions: intakeQuestions };
  expect(parsePersonaReply('Sure! {"answers": {"goal": "  Fill my two clinics  ", "size": 2, "tools": [1, 3, 9, 1], "nope": "x"}}', request))
    .toEqual({ answers: { goal: "Fill my two clinics", size: "1", tools: ["0", "2"] } });
  expect(parsePersonaReply('{"answers": {"size": 7}}', request)).toBeNull();
  expect(parsePersonaReply("not json", request)).toBeNull();
  expect(parsePersonaReply('{"message": " Hi, I run two dental clinics. "}', { kind: "post", channelName: "general" }))
    .toEqual({ message: "Hi, I run two dental clinics." });
  // A number, date or link the form checks is pulled out of what the persona wrote, or the sample stays.
  expect(parsePersonaReply('{"answers": {"seats": "About 1,200 hours a week", "site": "no site yet"}}', request))
    .toEqual({ answers: { seats: "1200" } });
  expect(mergePersonaAnswers({ goal: "Sample answer from Test member 1", size: "0", seats: "3", site: "https://example.com" },
    { goal: "Fill my two clinics", size: "1", seats: "12" }, intakeQuestions))
    .toEqual({ goal: "Fill my two clinics", size: "1", seats: "12", site: "https://example.com" });
});

async function startPersonaRun(t: ReturnType<typeof convexTest>) {
  vi.stubEnv("POLYNET_COMMUNITY_INFERENCE_PROVIDER", "claude_code_local");
  vi.stubEnv("POLYNET_CLAUDE_CODE_BRIDGE_TOKEN", "test-secret");
  const f = await fixture(t);
  const owner = t.withIdentity({ subject: OWNER });
  const started = await owner.mutation(api.communityTestMembers.startTestMember,
    { communityId: f.communityId, persona: "  a dentist with two clinics who has never used AI  " });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { f, owner, started, args: { communityId: f.communityId, testMemberId: started.id as any } };
}

const intakeAnswers = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) =>
  (await ctx.db.query("communityFormRequests").collect()).find((row) => row.formKey === "intake")?.answers);

test("with the free local engine, autoplay answers forms as the test member's persona", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  completion.reply.mockResolvedValue({ ok: true, type: "assistant",
    assistantText: '{"answers": {"goal": "Answer patients faster at both clinics", "size": 2}}' });
  const t = convexTest(schema, modules);
  const { owner, args } = await startPersonaRun(t);
  expect((await owner.query(api.communityTestMembers.listTestMembers, { communityId: args.communityId }) as any).test_members[0].persona)
    .toBe("a dentist with two clinics who has never used AI");

  // The first step only starts the writing; the form isn't touched yet.
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acting", beat: { text: "Writing Intake answers as Test member 1…" } });
  expect(await intakeAnswers(t)).toEqual({});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const sent = completion.reply.mock.calls[0][0];
  expect(sent.tools).toEqual([]);
  expect(sent.messages[0].content).toContain("a dentist with two clinics");

  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acted", beat: { ok: true, text: "Filled in the Intake form as Test member 1" } });
  expect(await intakeAnswers(t)).toEqual({ goal: "Answer patients faster at both clinics", size: "1" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  // The agent runs for real (and free) on this engine, so its step isn't
  // previewed: it goes to the real send, which fails here only because the
  // fixture's community has no agent set up.
  const sequence = await owner.query(api.communityTestMembers.getTestRunSequence, args);
  const greet = sequence.stages[0].steps.find((step: any) => step.key === "greet");
  expect(greet).toMatchObject({ note: null, error: "agent requester access missing" });
});

test("when the persona can't be written, autoplay uses the sample answers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  completion.reply.mockResolvedValue({ ok: false, status: 503, code: "bridge_down", message: "down" });
  const t = convexTest(schema, modules);
  const { owner, args } = await startPersonaRun(t);
  await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acted", beat: { ok: true, text: "Filled in the Intake form with sample answers" } });
  expect(await intakeAnswers(t)).toMatchObject({ goal: expect.stringContaining("Sample answer from Test member 1"), size: "0" });
});

test("a persona that takes too long gives way to the sample answers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  const t = convexTest(schema, modules);
  const { owner, args } = await startPersonaRun(t);
  await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args);
  // The writing never comes back (no scheduled functions run); a minute later it's skipped.
  vi.setSystemTime(nowMs + 61_000);
  await expect(owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args))
    .resolves.toMatchObject({ status: "acted", beat: { text: "Filled in the Intake form with sample answers" } });
});

test("a persona says hello in its guide channel, where the agent leads it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
  completion.reply.mockImplementation(async (input: any) => ({ ok: true, type: "assistant",
    assistantText: String(input.messages[1].content).includes("first post")
      ? '{"message": "Hi, I run two dental clinics and want fewer no-shows."}' : '{"answers": {"goal": "Fewer no-shows"}}' }));
  const t = convexTest(schema, modules);
  const { args, started } = await startPersonaRun(t);
  const owner = t.withIdentity({ subject: OWNER });
  // A real guide channel is restricted with grants for the member and the agent;
  // an open one stands in here, since the step only needs somewhere to post.
  const guideId = await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("communityChannels", { communityId: args.communityId, name: "guide-test-member-1", slug: "guide-test-member-1",
      accessMode: "all_members", postingPolicy: "members", status: "active", position: 9, createdAt: nowMs, updatedAt: nowMs } as any);
    await ctx.db.patch(started.membership_id as any, { serviceChannelId: channelId });
    return channelId;
  });

  const beats: string[] = [];
  let status = "";
  // It stops at the agent's welcome, which can't send here (the fixture has no agent set up).
  for (let i = 0; i < 30 && status !== "finished" && status !== "idle"; i += 1) {
    const step = await owner.mutation(api.communityTestMemberAutoplay.autoplayTestMemberStep, args);
    status = step.status;
    if (step.beat && step.status === "acted") beats.push(step.beat.text);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  expect(beats).toContain("Posted Test member 1's intro in #guide-test-member-1");
  const posts = await t.run(async (ctx) => (await ctx.db.query("communityInteractionRoots").collect())
    .filter((root) => String(root.channelId) === String(guideId)));
  expect(posts.map((root: any) => root.status)).toEqual(["live"]);
  expect(JSON.stringify(posts[0])).toContain("fewer no-shows");
});
