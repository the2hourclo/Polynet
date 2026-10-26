import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { findTestMemberByUserId } from "./communityTestMemberCore";
import { v } from "convex/values";
import {
  communityMembershipRowIsActive,
  normalizeIdValue,
  requireCommunityManager,
  resolveUserIdForAuthenticatedRequest,
} from "./communityCore";
import { getCommunityMemberWorkflowByCommunity, getMemberMilestone, resolveCurrentMilestone } from "./communityMemberWorkflowReadCore";
import { readMemberFactsForLens } from "./memberOntologyCore";
import { courseSummaries, listMemberVisibleLessonPages, readProgressRows } from "./communityResourceProgress";
import { resolveUserProfileDisplayProjection } from "./userProfileProjection";
import { listActiveCommunityAccessIntegrations, readClientAccessForList, readCommunityAccessTimelineEntries } from "./communityAccessSync";
import { canonicalReceiptAttemptValidator, completeCanonicalOperationReceipt } from "./polynetCanonicalReceipts";
import {
  COMMUNITY_CLIENT_PROPERTY_LIMIT,
  COMMUNITY_CLIENT_STUCK_DEFAULT_DAYS,
  CommunityClientError,
  communityClientPropertyAcceptsQuestion,
  communityClientPropertyKey,
  communityClientValueFromAnswer,
  deriveCommunityClientStatus,
  deriveCommunityClientStuck,
  normalizeCommunityClientPropertyDraft,
  normalizeCommunityClientPropertyOptions,
  normalizeCommunityClientPropertyValue,
  type CommunityClientPropertyDefinition,
  type CommunityClientPropertyValue,
} from "../shared/communityClients";

// The owner's client list. Every client field except owner properties is read
// fresh from the record that owns it; nothing here copies membership, payment,
// workflow, progress or member-fact state. Owners, admins and their agents only.

const CLIENT_PAGE_SIZE = 50;
const FACTS_PER_CLIENT = 12;

const toIso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

async function listActiveProperties(ctx: any, communityId: any) {
  const rows = await ctx.db.query("communityClientProperties")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .take(COMMUNITY_CLIENT_PROPERTY_LIMIT * 4);
  return rows.filter((row: any) => !row.archivedAt)
    .sort((a: any, b: any) => a.position - b.position || a.createdAt - b.createdAt);
}

function projectProperty(row: any) {
  return { key: row.key as string, name: row.name as string, type: row.type, options: row.options as string[], position: row.position as number };
}

async function requireMembershipInCommunity(ctx: any, communityId: any, membershipId: string) {
  const id = ctx.db.normalizeId("communityMemberships", membershipId);
  const membership = id ? await ctx.db.get(id) : null;
  if (!membership || normalizeIdValue(membership.communityId) !== normalizeIdValue(communityId)) {
    throw new CommunityClientError("community_client_not_found");
  }
  return membership;
}

async function findProperty(ctx: any, communityId: any, key: string) {
  const row = await ctx.db.query("communityClientProperties")
    .withIndex("by_community_key", (q: any) => q.eq("communityId", communityId).eq("key", key))
    .unique();
  if (!row || row.archivedAt) throw new CommunityClientError("client_property_not_found", key);
  return row;
}

const managerArgs = { userId: v.id("users"), communityId: v.id("communities") };

async function listProperties(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  return { properties: (await listActiveProperties(ctx, args.communityId)).map(projectProperty) };
}

const createPropertyArgs = { ...managerArgs, name: v.string(), type: v.string(), options: v.optional(v.array(v.string())) };

async function createProperty(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const draft = normalizeCommunityClientPropertyDraft(args);
  const all = await ctx.db.query("communityClientProperties")
    .withIndex("by_community", (q: any) => q.eq("communityId", args.communityId))
    .take(COMMUNITY_CLIENT_PROPERTY_LIMIT * 4);
  const active = all.filter((row: any) => !row.archivedAt);
  if (active.length >= COMMUNITY_CLIENT_PROPERTY_LIMIT) throw new CommunityClientError("client_property_limit_reached");
  if (active.some((row: any) => row.name.toLowerCase() === draft.name.toLowerCase())) {
    throw new CommunityClientError("client_property_name_taken");
  }
  // Keys are never reused, even after archiving, so old values never resurface.
  const base = communityClientPropertyKey(draft.name);
  const taken = new Set(all.map((row: any) => row.key));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const nowMs = Date.now();
  await ctx.db.insert("communityClientProperties", {
    communityId: args.communityId, key, name: draft.name, type: draft.type, options: draft.options,
    position: Math.max(-1, ...active.map((row: any) => row.position)) + 1,
    createdByUserId: args.userId, createdAt: nowMs, updatedAt: nowMs,
  });
  return { property: { key, name: draft.name, type: draft.type, options: draft.options } };
}

const updatePropertyArgs = {
  ...managerArgs, key: v.string(), name: v.optional(v.string()), options: v.optional(v.array(v.string())), position: v.optional(v.number()),
};

async function updateProperty(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const row = await findProperty(ctx, args.communityId, args.key);
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.name !== undefined) {
    const { name } = normalizeCommunityClientPropertyDraft({ name: args.name, type: row.type, options: row.options });
    const clash = (await listActiveProperties(ctx, args.communityId))
      .some((other: any) => other.key !== row.key && other.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new CommunityClientError("client_property_name_taken");
    patch.name = name;
  }
  // A value whose option was removed reads as empty; it is not rewritten.
  if (args.options !== undefined) patch.options = normalizeCommunityClientPropertyOptions(row.type, args.options);
  if (args.position !== undefined) {
    if (!Number.isFinite(args.position)) throw new CommunityClientError("client_property_position_invalid");
    patch.position = args.position;
  }
  await ctx.db.patch(row._id, patch);
  return { property: projectProperty({ ...row, ...patch }) };
}

const archivePropertyArgs = { ...managerArgs, key: v.string() };

async function archiveProperty(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const row = await findProperty(ctx, args.communityId, args.key);
  const nowMs = Date.now();
  await ctx.db.patch(row._id, { archivedAt: nowMs, updatedAt: nowMs });
  return { archived: row.key };
}

const setValueArgs = {
  ...managerArgs, membershipId: v.string(), key: v.string(), value: v.any(),
  via: v.optional(v.union(v.literal("web"), v.literal("agent"))),
};

// Workflows call this too (via "workflow", as the builder who saved the
// Workflow), so a stage rule and an owner edit leave the same trail.
export async function setValue(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const membership = await requireMembershipInCommunity(ctx, args.communityId, args.membershipId);
  const property = await findProperty(ctx, args.communityId, args.key);
  return writeValue(ctx, { communityId: args.communityId, membership, property, actorUserId: args.userId,
    via: args.via ?? "web", value: normalizeCommunityClientPropertyValue(property, args.value) });
}

// A member's submitted form fills the properties its questions map to. The
// member is the actor; an answer that no longer fits its property is skipped,
// so a changed property never blocks the submission.
export async function writeMappedFormAnswers(ctx: any, args: {
  communityId: any; membership: any; questions: Array<{ key: string; type: string; options: string[]; clientPropertyKey?: string }>;
  answers: Record<string, string | string[]>;
}) {
  const written: string[] = [];
  for (const question of args.questions) {
    if (!question.clientPropertyKey) continue;
    const property = await ctx.db.query("communityClientProperties")
      .withIndex("by_community_key", (q: any) => q.eq("communityId", args.communityId).eq("key", question.clientPropertyKey))
      .unique();
    if (!property || property.archivedAt) continue;
    const answer = args.answers[question.key];
    let value = null;
    let fits = communityClientPropertyAcceptsQuestion(property.type, question.type);
    if (fits) { try { value = communityClientValueFromAnswer(property, question, answer); } catch { fits = false; } }
    if (!fits) {
      // Say so on the client's timeline, so the owner sees why the property stayed empty.
      if (answer !== undefined && answer !== "" && !(Array.isArray(answer) && !answer.length)) {
        await ctx.db.insert("communityClientEvents", { communityId: args.communityId, membershipId: args.membership._id,
          type: "property_skipped", actorUserId: args.membership.userId, via: "form", propertyKey: property.key,
          body: (question as { title?: string }).title ?? question.key, createdAt: Date.now() });
      }
      continue;
    }
    if (value === null) continue;
    await writeValue(ctx, { communityId: args.communityId, membership: args.membership, property,
      actorUserId: args.membership.userId, via: "form", value });
    written.push(property.key);
  }
  return written;
}

async function writeValue(ctx: any, args: { communityId: any; membership: any; property: any; actorUserId: any; via: string; value: any }) {
  const { membership, property, value } = args;
  const existing = await ctx.db.query("communityClientValues")
    .withIndex("by_membership_property", (q: any) => q.eq("membershipId", membership._id).eq("propertyKey", property.key))
    .unique();
  const via = args.via;
  await ctx.db.insert("communityClientEvents", {
    communityId: args.communityId, membershipId: membership._id, type: "property_set", actorUserId: args.actorUserId, via,
    propertyKey: property.key, value, createdAt: Date.now(),
  });
  if (value === null) {
    if (existing) await ctx.db.delete(existing._id);
  } else {
    const row = { value, updatedByUserId: args.actorUserId, updatedVia: via, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("communityClientValues", {
      communityId: args.communityId, membershipId: membership._id, propertyKey: property.key, ...row,
    });
  }
  return { membership_id: String(membership._id), key: property.key, value };
}

// Reads one stored value as its property defines it today, so a changed
// option list or type never shows a value that no longer fits.
function currentValue(property: CommunityClientPropertyDefinition, value: unknown): CommunityClientPropertyValue | null {
  try { return normalizeCommunityClientPropertyValue(property, value); } catch { return null; }
}

async function readLastSubmittedFormAt(ctx: any, membership: any) {
  const rows = await ctx.db.query("communityFormRequests")
    .withIndex("by_member_status", (q: any) => q.eq("membershipId", membership._id).eq("status", "submitted"))
    .order("desc").take(10);
  const current = rows.filter((row: any) => row.activationSequence === (membership.activationSequence ?? 0) && row.submittedAt);
  return { count: current.length, last_submitted_at_ms: Math.max(0, ...current.map((row: any) => row.submittedAt)) || null };
}

async function readLatestSubscription(ctx: any, membershipId: any) {
  const rows = await ctx.db.query("communitySubscriptions")
    .withIndex("by_membership", (q: any) => q.eq("membershipId", membershipId))
    .take(20);
  return rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null;
}

const CLIENT_EVENT_TYPES = ["flagged", "note", "drafted", "contacted"] as const;
const CLIENT_CONTACT_CHANNELS = ["email", "message", "call", "other"] as const;
const CLIENT_EVENT_BODY_MAX = 2000;
const TIMELINE_LIMIT = 100;

const recordEventArgs = {
  ...managerArgs, membershipId: v.string(), type: v.string(), body: v.optional(v.string()), channel: v.optional(v.string()),
  via: v.optional(v.union(v.literal("web"), v.literal("agent"))),
};

// The action log: what the owner or their agent did about a client, so two
// people (or an agent and its owner) never contact the same person twice.
async function recordEvent(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const membership = await requireMembershipInCommunity(ctx, args.communityId, args.membershipId);
  if (!(CLIENT_EVENT_TYPES as readonly string[]).includes(args.type)) throw new CommunityClientError("client_event_type_invalid");
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (body.length > CLIENT_EVENT_BODY_MAX || (args.type !== "flagged" && !body)) throw new CommunityClientError("client_event_body_invalid");
  if (args.channel !== undefined && (args.type !== "contacted" || !(CLIENT_CONTACT_CHANNELS as readonly string[]).includes(args.channel))) {
    throw new CommunityClientError("client_event_channel_invalid");
  }
  const createdAt = Date.now();
  await ctx.db.insert("communityClientEvents", {
    communityId: args.communityId, membershipId: membership._id, type: args.type, actorUserId: args.userId,
    via: args.via ?? "web", ...(body ? { body } : {}), ...(args.channel ? { channel: args.channel } : {}), createdAt,
  });
  return { membership_id: String(membership._id), type: args.type, at: toIso(createdAt) };
}

// The latest event of one type, however many others came after it.
async function readLatestOwnerEventAt(ctx: any, membershipId: any, type: "flagged" | "contacted"): Promise<number | undefined> {
  const row = await ctx.db.query("communityClientEvents")
    .withIndex("by_membership_type_createdAt", (q: any) => q.eq("membershipId", membershipId).eq("type", type))
    .order("desc").first();
  return row?.createdAt;
}

async function readOwnerEvents(ctx: any, membershipId: any, limit: number) {
  return await ctx.db.query("communityClientEvents")
    .withIndex("by_membership_createdAt", (q: any) => q.eq("membershipId", membershipId))
    .order("desc").take(limit);
}

type TimelineEntry = { at: number; type: string; summary: string; ref?: string; actor?: string };

const readTimelineArgs = { ...managerArgs, membershipId: v.string() };

// One client's history, newest first, read from the records that own each
// part: membership, Workflow transitions and runs, lesson progress and
// answers (buttons, checklists, quizzes), forms, subscriptions, and the
// owner's own action log. Nothing here is a second copy.
async function readTimeline(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const membership = await requireMembershipInCommunity(ctx, args.communityId, args.membershipId);
  const entries: TimelineEntry[] = [];
  const joinedAt = membership.activatedAt ?? membership.createdAt;
  const testMember = await findTestMemberByUserId(ctx, membership.userId);
  entries.push({ at: joinedAt, type: "joined", summary: testMember ? "Joined as a test member"
    : membership.accessSource === "paid_subscription" ? "Joined with a paid plan"
    : membership.accessSource === "manual_grant" ? "Added by the owner" : "Joined" });
  if (!communityMembershipRowIsActive(membership)) {
    entries.push({ at: membership.revokedAt ?? membership.updatedAt, type: "left", summary: "Left the community" });
  }
  const workflow = await getCommunityMemberWorkflowByCommunity({ ctx, communityId: args.communityId });
  const [transitions, runs, progressRows, forms, subscriptions, ownerEvents, resources] = await Promise.all([
    workflow ? ctx.db.query("communityMemberWorkflowTransitions")
      .withIndex("by_workflow_membership_seq", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membership._id))
      .order("desc").take(TIMELINE_LIMIT) : Promise.resolve([]),
    workflow ? ctx.db.query("communityMemberWorkflowRuns")
      .withIndex("by_workflow_membership_createdAt", (q: any) => q.eq("workflowId", workflow._id).eq("membershipId", membership._id))
      .order("desc").take(TIMELINE_LIMIT) : Promise.resolve([]),
    readProgressRows(ctx, args.communityId, membership.userId),
    ctx.db.query("communityFormRequests")
      .withIndex("by_member_status", (q: any) => q.eq("membershipId", membership._id).eq("status", "submitted"))
      .order("desc").take(TIMELINE_LIMIT),
    ctx.db.query("communitySubscriptions").withIndex("by_membership", (q: any) => q.eq("membershipId", membership._id)).take(20),
    readOwnerEvents(ctx, membership._id, TIMELINE_LIMIT),
    listMemberVisibleLessonPages(ctx, args.communityId),
  ]);
  for (const row of transitions as any[]) {
    entries.push({ at: row.occurredAt, type: row.completedWorkflow ? "workflow_completed" : "stage_moved",
      summary: row.completedWorkflow ? `Finished the workflow from ${row.fromMilestoneName}`
        : `Moved from ${row.fromMilestoneName} to ${row.toMilestoneName ?? "the next stage"}${row.forcedByUserId ? " (moved by the owner)" : ""}` });
  }
  const formNames = new Map<string, string>();
  for (const row of runs as any[]) {
    if (row.status === "running") continue;
    const action = row.actionSnapshot ?? {};
    if (action.type === "request_form" && action.formKey && !formNames.has(action.formKey)) {
      const form = await ctx.db.query("communityForms")
        .withIndex("by_community_key", (q: any) => q.eq("communityId", args.communityId).eq("key", action.formKey)).first();
      formNames.set(action.formKey, form?.name ?? action.formKey);
    }
    // What the Workflow did, in words: sending a form is not the member answering it.
    const code = row.actionResult?.resultCode;
    const did = code === "condition_skipped" ? "Workflow skipped a step (its “only if” didn't match)"
      : code === "path_skipped" ? "Workflow skipped a step (the step before it was skipped)"
      : action.type === "request_form" ? `Workflow sent the ${formNames.get(action.formKey)} form`
      : action.type === "set_client_property" ? `Workflow set ${action.propertyKey}`
      : action.type === "create_service_channel" ? "Workflow opened a private channel"
      : action.type === "prompt_agent" ? row.actionResult?.resultCode === "agent_previewed"
        ? "Workflow previewed an agent message (Autoplay, not sent)" : "Workflow asked the agent to act"
      : `Workflow ran ${String(action.type ?? "an action").replace(/_/g, " ")}`;
    entries.push({ at: row.finishedAt ?? row.updatedAt, type: row.status === "failed" ? "workflow_action_failed" : "workflow_action",
      summary: row.status === "failed" ? `${did}: failed (${String(row.errorCode ?? "unknown").replace(/_/g, " ")})` : `${did} (${row.milestoneName})` });
  }
  const titleById = new Map(resources.pages.map((page: any) => [normalizeIdValue(page._id), page.title ?? "Lesson"]));
  for (const row of progressRows as any[]) {
    const title = titleById.get(normalizeIdValue(row.resourceId)) ?? "A lesson";
    const ref = `resource:${normalizeIdValue(row.resourceId)}`;
    entries.push({ at: row.startedAt, type: "lesson_started", summary: `Started ${title}`, ref });
    if (row.status === "done" && row.completedAt) entries.push({ at: row.completedAt, type: "lesson_done", summary: `Finished ${title}`, ref });
    for (const response of row.responses ?? []) {
      entries.push({ at: response.at, type: "lesson_answered", ref,
        summary: `${title}: answered ${response.element}${response.correct === true ? " (right)" : response.correct === false ? " (wrong)" : ""}` });
    }
  }
  for (const row of forms as any[]) {
    if (!row.submittedAt) continue;
    const version = await ctx.db.get(row.versionId);
    entries.push({ at: row.submittedAt, type: "form_submitted", summary: `Submitted ${version?.name ?? "a form"}` });
  }
  for (const row of subscriptions as any[]) {
    entries.push({ at: row.createdAt, type: "subscription_started", summary: "Started paying" });
    if (row.updatedAt > row.createdAt && row.status !== "active") {
      entries.push({ at: row.endedAt ?? row.updatedAt, type: "subscription_changed",
        summary: `Subscription ${row.status.replace(/_/g, " ")}${row.cancelAtPeriodEnd ? " (cancels at period end)" : ""}` });
    }
  }
  for (const row of ownerEvents as any[]) {
    const who = row.via === "agent" ? "Agent" : row.via === "workflow" ? "Workflow" : row.via === "form" ? "Form" : "Owner";
    const summary = row.type === "property_set" ? `${who} set ${row.propertyKey} to ${row.value === null ? "empty" : JSON.stringify(row.value)}`
      : row.type === "property_skipped" ? `Form answer to “${row.body}” didn’t fit ${row.propertyKey}, so it wasn’t saved`
      : row.type === "flagged" ? `${who} flagged${row.body ? `: ${row.body}` : ""}`
      : row.type === "contacted" ? `${who} contacted by ${row.channel ?? "other"}: ${row.body}`
      : `${who} ${row.type === "drafted" ? "drafted a message" : "added a note"}: ${row.body}`;
    entries.push({ at: row.createdAt, type: row.type, summary, actor: row.via });
  }
  entries.push(...await readCommunityAccessTimelineEntries(ctx, { communityId: args.communityId, membership, limit: TIMELINE_LIMIT }));
  entries.sort((a, b) => b.at - a.at);
  return {
    kind: "community_client_timeline",
    membership_id: String(membership._id),
    read_at: new Date().toISOString(),
    entries: entries.slice(0, TIMELINE_LIMIT).map(({ at, ...entry }) => ({ at: toIso(at), ...entry })),
    truncated: entries.length > TIMELINE_LIMIT,
  };
}

function clampStuckDays(days: number) {
  if (!Number.isFinite(days)) throw new CommunityClientError("client_stuck_days_invalid");
  return Math.min(365, Math.max(1, Math.round(days)));
}

async function readSettings(ctx: any, communityId: any) {
  return await ctx.db.query("communityClientSettings")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId)).unique();
}

const setSettingsArgs = { ...managerArgs, stuckDays: v.number() };

async function setSettings(ctx: any, args: any) {
  await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const stuckDays = clampStuckDays(args.stuckDays);
  const existing = await readSettings(ctx, args.communityId);
  const row = { stuckDays, updatedByUserId: args.userId, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, row);
  else await ctx.db.insert("communityClientSettings", { communityId: args.communityId, ...row });
  return { stuck_days: stuckDays };
}

// stuckDays here previews another rule without saving it.
const listClientsArgs = { ...managerArgs, cursor: v.optional(v.string()), stuckDays: v.optional(v.number()) };

async function listClients(ctx: any, args: any) {
  const { community } = await requireCommunityManager({ ctx, communityId: args.communityId, userId: args.userId });
  const nowMs = Date.now();
  const settings = await readSettings(ctx, args.communityId);
  const stuckDays = args.stuckDays !== undefined ? clampStuckDays(args.stuckDays)
    : settings?.stuckDays ?? COMMUNITY_CLIENT_STUCK_DEFAULT_DAYS;
  const [properties, lessons, workflow, integrations] = await Promise.all([
    listActiveProperties(ctx, args.communityId),
    listMemberVisibleLessonPages(ctx, args.communityId),
    getCommunityMemberWorkflowByCommunity({ ctx, communityId: args.communityId }),
    listActiveCommunityAccessIntegrations(ctx, args.communityId),
  ]);
  const definitions = properties.map(projectProperty);
  const page = await ctx.db.query("communityMemberships")
    .withIndex("by_community", (q: any) => q.eq("communityId", args.communityId))
    .paginate({ numItems: CLIENT_PAGE_SIZE, cursor: args.cursor ?? null });

  const clients = await Promise.all(page.page.map(async (membership: any) => {
    const active = communityMembershipRowIsActive(membership);
    const [profile, subscription, progressRows, forms, facts, values, milestoneState, lastFlaggedAt, lastContactedAt, referral, testMember, access] = await Promise.all([
      resolveUserProfileDisplayProjection(ctx, membership.userId),
      readLatestSubscription(ctx, membership._id),
      readProgressRows(ctx, args.communityId, membership.userId),
      active ? readLastSubmittedFormAt(ctx, membership) : Promise.resolve({ count: 0, last_submitted_at_ms: null }),
      readMemberFactsForLens(ctx, { subjectUserId: membership.userId,
        lens: { kind: "founder_admin", communityId: String(args.communityId) }, scope: { communityId: args.communityId } }),
      ctx.db.query("communityClientValues").withIndex("by_membership", (q: any) => q.eq("membershipId", membership._id))
        .take(COMMUNITY_CLIENT_PROPERTY_LIMIT * 4),
      workflow && active ? getMemberMilestone({ ctx, workflowId: workflow._id, membershipId: membership._id }) : Promise.resolve(null),
      readLatestOwnerEventAt(ctx, membership._id, "flagged"),
      readLatestOwnerEventAt(ctx, membership._id, "contacted"),
      ctx.db.query("communityReferrals")
        .withIndex("by_community_user", (q: any) => q.eq("communityId", args.communityId).eq("userId", membership.userId)).first(),
      findTestMemberByUserId(ctx, membership.userId),
      readClientAccessForList(ctx, { community, membership, integrations, nowMs }),
    ]);
    const stage = workflow && active && workflow.milestones.length
      ? (() => { try { return resolveCurrentMilestone({ workflow, membership, state: milestoneState }); } catch { return null; } })()
      : null;
    const joinedAtMs = membership.activatedAt ?? membership.createdAt;
    const lessonDoneAtMs = Math.max(0, ...progressRows.map((row: any) => row.completedAt ?? 0)) || null;
    const lessonTouchedAtMs = Math.max(0, ...progressRows.map((row: any) => row.updatedAt ?? 0)) || null;
    const lastProgressAtMs = Math.max(joinedAtMs, lessonDoneAtMs ?? 0, forms.last_submitted_at_ms ?? 0, stage?.milestoneEnteredAt ?? 0);
    const lastActiveAtMs = Math.max(lastProgressAtMs, lessonTouchedAtMs ?? 0);
    const valueByKey = new Map(values.map((row: any) => [row.propertyKey, row.value]));
    return {
      membership_id: String(membership._id),
      user_id: String(membership.userId),
      name: profile.display_name,
      avatar_url: profile.avatar_url ?? null,
      // An owner's test run, not a real member: leave it out of real-member work.
      is_test: Boolean(testMember),
      status: deriveCommunityClientStatus({
        active,
        subscription: subscription ? { status: subscription.status, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } : null,
      }),
      role: membership.role,
      access_source: membership.accessSource ?? null,
      joined_at: toIso(joinedAtMs),
      left_at: active ? null : toIso(membership.revokedAt ?? membership.updatedAt),
      subscription: subscription ? {
        status: subscription.status,
        cancel_at_period_end: subscription.cancelAtPeriodEnd,
        current_period_end_at: toIso(subscription.currentPeriodEndAt),
      } : null,
      stage: stage ? { key: stage.milestone.key, name: stage.milestone.name, entered_at: toIso(stage.milestoneEnteredAt),
        completed_at: toIso(stage.completedAt) } : null,
      courses: courseSummaries(lessons, progressRows),
      lessons_done: progressRows.filter((row: any) => row.status === "done").length,
      last_lesson_done_at: toIso(lessonDoneAtMs),
      forms_submitted: forms.count,
      last_form_submitted_at: toIso(forms.last_submitted_at_ms),
      last_active_at: toIso(lastActiveAtMs),
      last_progress_at: toIso(lastProgressAtMs),
      stuck: deriveCommunityClientStuck({ active, lastProgressAtMs, nowMs, days: stuckDays }),
      last_flagged_at: toIso(lastFlaggedAt),
      last_contacted_at: toIso(lastContactedAt),
      // The ref on the join link this member arrived by, first touch.
      referred_by: referral ? referral.ref : null,
      // Plan, what they can use (community, courses, each connected service)
      // and until when: the same answer the AIEB MCP gets.
      access,
      facts: facts.slice(0, FACTS_PER_CLIENT).map((fact: any) => ({ kind: fact.kind, body: fact.body, provenance: fact.provenance })),
      properties: Object.fromEntries(definitions.map((property: any) => [property.key, currentValue(property, valueByKey.get(property.key) ?? null)])),
    };
  }));
  return {
    kind: "community_client_list",
    read_at: new Date(nowMs).toISOString(),
    stuck_days: stuckDays,
    properties: definitions,
    clients,
    next_cursor: page.isDone ? null : page.continueCursor,
    lessons_truncated: lessons.truncated,
  };
}

export const listClientPropertiesInternal = internalQuery({ args: managerArgs, handler: listProperties });
// An agent's change can carry its reserved MCP receipt, completed in the same
// transaction: the change and its retry answer commit together or not at all,
// so a retry can never write twice.
const receiptArgs = { receipt: v.optional(v.object({ attempt: canonicalReceiptAttemptValidator, value: v.any() })) };
function withReceipt<A extends Record<string, unknown>>(handler: (ctx: any, args: A) => Promise<any>) {
  return async (ctx: any, { receipt, ...args }: A & { receipt?: { attempt: any; value: Record<string, unknown> } }) => {
    const result = await handler(ctx, args as unknown as A);
    return receipt ? completeCanonicalOperationReceipt(ctx, { ...receipt.attempt, result: { ...result, ...receipt.value } }) : result;
  };
}
export const createClientPropertyInternal = internalMutation({ args: { ...createPropertyArgs, ...receiptArgs }, handler: withReceipt(createProperty) });
export const updateClientPropertyInternal = internalMutation({ args: { ...updatePropertyArgs, ...receiptArgs }, handler: withReceipt(updateProperty) });
export const archiveClientPropertyInternal = internalMutation({ args: { ...archivePropertyArgs, ...receiptArgs }, handler: withReceipt(archiveProperty) });
export const setClientPropertyValueInternal = internalMutation({ args: { ...setValueArgs, ...receiptArgs }, handler: withReceipt(setValue) });
export const recordClientEventInternal = internalMutation({ args: { ...recordEventArgs, ...receiptArgs }, handler: withReceipt(recordEvent) });
export const readClientTimelineInternal = internalQuery({ args: readTimelineArgs, handler: readTimeline });
export const setClientSettingsInternal = internalMutation({ args: { ...setSettingsArgs, ...receiptArgs }, handler: withReceipt(setSettings) });
export const listClientsInternal = internalQuery({ args: listClientsArgs, handler: listClients });

// The same reads and writes for the signed-in owner or admin in the web app.
function signedIn<A extends { userId: unknown }>(validators: A) {
  const { userId: _userId, ...rest } = validators;
  return { authSubject: v.optional(v.string()), ...rest };
}

async function signedInArgs(ctx: any, args: { authSubject?: string } & Record<string, unknown>) {
  const { authSubject, ...rest } = args;
  const userId = await resolveUserIdForAuthenticatedRequest({ ctx, authSubject: authSubject ?? null });
  return { ...rest, userId };
}

export const listClientProperties = query({
  args: signedIn(managerArgs), handler: async (ctx, args) => listProperties(ctx, await signedInArgs(ctx, args)),
});
export const createClientProperty = mutation({
  args: signedIn(createPropertyArgs), handler: async (ctx, args) => createProperty(ctx, await signedInArgs(ctx, args)),
});
export const updateClientProperty = mutation({
  args: signedIn(updatePropertyArgs), handler: async (ctx, args) => updateProperty(ctx, await signedInArgs(ctx, args)),
});
export const archiveClientProperty = mutation({
  args: signedIn(archivePropertyArgs), handler: async (ctx, args) => archiveProperty(ctx, await signedInArgs(ctx, args)),
});
export const setClientPropertyValue = mutation({
  args: signedIn(setValueArgs), handler: async (ctx, args) => setValue(ctx, { ...(await signedInArgs(ctx, args)), via: "web" }),
});
export const recordClientEvent = mutation({
  args: signedIn(recordEventArgs), handler: async (ctx, args) => recordEvent(ctx, { ...(await signedInArgs(ctx, args)), via: "web" }),
});
export const getClientTimeline = query({
  args: signedIn(readTimelineArgs), handler: async (ctx, args) => readTimeline(ctx, await signedInArgs(ctx, args)),
});
export const setClientSettings = mutation({
  args: signedIn(setSettingsArgs), handler: async (ctx, args) => setSettings(ctx, await signedInArgs(ctx, args)),
});
export const listClientsForOwner = query({
  args: signedIn(listClientsArgs), handler: async (ctx, args) => listClients(ctx, await signedInArgs(ctx, args)),
});
