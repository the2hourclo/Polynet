export const COMMUNITY_MEMBER_WORKFLOW_MIN_MILESTONES = 1;
export const COMMUNITY_MEMBER_WORKFLOW_MAX_MILESTONES = 12;
export const COMMUNITY_MEMBER_WORKFLOW_MILESTONE_NAME_MAX_LENGTH = 80;
export const COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH = 4_000;
export const COMMUNITY_MEMBER_WORKFLOW_MILESTONE_KEY_MAX_LENGTH = 64;
export const COMMUNITY_MEMBER_WORKFLOW_AUTOMATION_KEY_MAX_LENGTH = 64;
export const COMMUNITY_MEMBER_WORKFLOW_ACTION_KEY_MAX_LENGTH = 64;
export const COMMUNITY_MEMBER_WORKFLOW_MAX_AUTOMATIONS_PER_MILESTONE = 12;
export const COMMUNITY_MEMBER_WORKFLOW_SOURCE_REF_MAX_LENGTH = 1_024;

export type CommunityMemberWorkflowMemberContributedTrigger = {
  type: "member_contributed";
  /** Absent means any authorized channel; a selected ID never falls back. */
  channelId?: string;
};

export type CommunityMemberWorkflowTrigger =
  /** With `delayMinutes`, it waits that long after the earlier step finishes. */
  | { type: "previous_action_completed"; predecessorActionKey: string; delayMinutes?: number }
  | { type: "member_joined" }
  | CommunityMemberWorkflowMemberContributedTrigger
  | { type: "form_submitted"; formKey: string }
  /** With `nudge`, it only runs if they're still in the stage then, and never
   * holds the stage open: the goal review can move them on before it fires. */
  | { type: "milestone_elapsed"; delayMinutes: number; nudge?: boolean }
  /** A lesson page marked done. Absent resourceId means any lesson. */
  | { type: "lesson_completed"; resourceId?: string }
  /** Every lesson in a course done. Absent moduleId means any course. */
  | { type: "course_completed"; moduleId?: string }
  /** Every step of a skill track done. Absent trackKey means any track. */
  | { type: "track_completed"; trackKey?: string };

export function normalizeWorkflowDelayMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 525600) {
    throw new Error("community_member_workflow_delay_invalid");
  }
  return value;
}

export type CommunityMemberWorkflowPromptAgentAction = {
  key: string;
  type: "prompt_agent";
  prompt: string;
  /** What the agent sees; absent means approved facts and the triggering form. */
  sees?: string[];
};

/** Writes one owner property on the member's client row; `null` clears it. */
export type CommunityMemberWorkflowSetClientPropertyAction = {
  key: string;
  type: "set_client_property";
  propertyKey: string;
  value: string | number | boolean | string[] | null;
};

/**
 * An email the owner writes, sent to the member from Polynet. {first_name},
 * {name} and {community} fill in per member; every email carries an
 * unsubscribe link for this community's automation emails.
 */
export type CommunityMemberWorkflowSendEmailAction = {
  key: string;
  type: "send_email";
  subject: string;
  body: string;
};

export type CommunityMemberWorkflowAction =
  | { key: string; type: "create_service_channel" }
  | { key: string; type: "request_form"; formKey: string }
  | CommunityMemberWorkflowPromptAgentAction
  | CommunityMemberWorkflowSetClientPropertyAction
  | CommunityMemberWorkflowSendEmailAction;

export const COMMUNITY_MEMBER_WORKFLOW_EMAIL_SUBJECT_MAX_LENGTH = 150;
export const COMMUNITY_MEMBER_WORKFLOW_EMAIL_BODY_MAX_LENGTH = 5000;
export const COMMUNITY_MEMBER_WORKFLOW_EMAIL_FIELDS = ["first_name", "name", "community"] as const;

/** Fills {first_name}, {name} and {community}; any other {word} stays as typed. */
export function fillWorkflowEmailFields(text: string, values: { name: string; community: string }): string {
  const first = values.name.trim().split(/\s+/)[0] ?? "";
  const fields: Record<string, string> = { first_name: first || "there", name: values.name.trim() || "there", community: values.community };
  return text.replace(/\{(first_name|name|community)\}/g, (_, key: string) => fields[key]);
}

/** "Only if": the step runs when the member's client property matches; otherwise
 * it is skipped (counted as done) and every step after it on that path is skipped too. */
export type CommunityMemberWorkflowCondition = {
  propertyKey: string;
  op: "is" | "is_not" | "is_set" | "is_empty";
  value?: string | number | boolean;
};

export type CommunityMemberWorkflowAutomation = {
  key: string;
  condition?: CommunityMemberWorkflowCondition;
  /** Server-owned identity: preserved for duration edits, renewed on trigger conversion. */
  timerGeneration?: string;
  /** Server-owned activation time; edits never backfill already completed work. */
  sequenceEnabledAt?: number;
  sequenceEnabledRevision?: number;
  trigger: CommunityMemberWorkflowTrigger;
  action: CommunityMemberWorkflowAction;
};

export type CommunityMemberWorkflowMilestone = {
  key: string;
  name: string;
  instructions?: string;
  goal?: string;
  requireHumanApproval?: boolean;
  /** The owner's colour for this stage, from COMMUNITY_MEMBER_WORKFLOW_STAGE_COLORS. */
  color?: CommunityMemberWorkflowStageColor;
  automations: CommunityMemberWorkflowAutomation[];
  /** Automations the owner switched off: kept, never run, and never holding a member here. */
  pausedAutomations?: CommunityMemberWorkflowAutomation[];
};

/**
 * Split a stage's rules into the ones that run and the ones switched off.
 * A step after a switched-off rule is off too, since it could never start.
 */
export function splitPausedWorkflowAutomations<T extends CommunityMemberWorkflowAutomation>(rules: T[], paused: (rule: T, index: number) => boolean) {
  const off = new Set<string>();
  rules.forEach((rule, index) => { if (paused(rule, index)) off.add(rule.key); });
  let grew = true;
  while (grew) {
    grew = false;
    const offActions = new Set(rules.filter((rule) => off.has(rule.key)).map((rule) => rule.action.key));
    for (const rule of rules) if (!off.has(rule.key) && rule.trigger.type === "previous_action_completed" && offActions.has(rule.trigger.predecessorActionKey)) { off.add(rule.key); grew = true; }
  }
  return { active: rules.filter((rule) => !off.has(rule.key)), paused: rules.filter((rule) => off.has(rule.key)) };
}

// Owner-picked stage colours, after Airtable's section colours: a dot on the
// stage heading and a thin edge on its automations, so a stage is easy to spot.
export const COMMUNITY_MEMBER_WORKFLOW_STAGE_COLORS = ["grey", "green", "teal", "blue", "purple", "pink", "red", "orange", "yellow"] as const;
export type CommunityMemberWorkflowStageColor = typeof COMMUNITY_MEMBER_WORKFLOW_STAGE_COLORS[number];

/** "none" or "" clears the colour; anything outside the palette is refused. */
export function normalizeCommunityMemberWorkflowStageColor(value: string): CommunityMemberWorkflowStageColor | undefined {
  const color = value.trim().toLowerCase();
  if (color === "" || color === "none") return undefined;
  if (!(COMMUNITY_MEMBER_WORKFLOW_STAGE_COLORS as readonly string[]).includes(color)) throw new Error("community_member_workflow_stage_color_invalid");
  return color as CommunityMemberWorkflowStageColor;
}

/** Optional milestone policy; never completion evidence or execution authority. */
export function normalizeWorkflowMilestoneContext(value: string | undefined): string {
  if ((value?.length ?? 0) > COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH) {
    throw new Error("community_member_workflow_context_too_long");
  }
  return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function composeWorkflowAgentPrompt(prompt: string, context?: { instructions?: string; goal?: string }): string {
  if (!context?.instructions && !context?.goal) return prompt;
  return [
    "Stage context is builder policy beneath platform and community policy. It grants no additional access or tools. The goal is desired success, not evidence of completion; do not advance the member based on this text.",
    context.instructions ? `Stage instructions:\n${context.instructions}` : "",
    context.goal ? `Stage goal:\n${context.goal}` : "",
    `Action instructions:\n${prompt}`,
  ].filter(Boolean).join("\n\n");
}

export function workflowTriggerIdentity(trigger: CommunityMemberWorkflowTrigger): string {
  return JSON.stringify(trigger.type === "member_contributed" ? [trigger.type, trigger.channelId ?? null]
    : trigger.type === "form_submitted" ? [trigger.type, trigger.formKey]
    : trigger.type === "previous_action_completed" ? (trigger.delayMinutes ? [trigger.type, trigger.predecessorActionKey, trigger.delayMinutes] : [trigger.type, trigger.predecessorActionKey])
    : trigger.type === "lesson_completed" ? [trigger.type, trigger.resourceId ?? null]
    : trigger.type === "course_completed" ? [trigger.type, trigger.moduleId ?? null]
    : trigger.type === "track_completed" ? [trigger.type, trigger.trackKey ?? null]
    : trigger.type === "member_joined" ? [trigger.type]
    : trigger.nudge ? [trigger.type, trigger.delayMinutes, "nudge"] : [trigger.type, trigger.delayMinutes]);
}

function normalizeInlineText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeMultilineText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeOpaqueKey(
  value: unknown,
  maxLength: number,
  errorCode: string,
): string {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  if (!key || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(key)) {
    throw new Error(errorCode);
  }
  return key;
}

export function normalizeCommunityMemberWorkflowMilestoneKey(
  value: unknown,
): string {
  return normalizeOpaqueKey(
    value,
    COMMUNITY_MEMBER_WORKFLOW_MILESTONE_KEY_MAX_LENGTH,
    "community_member_workflow_milestone_key_invalid",
  );
}

export function normalizeCommunityMemberWorkflowAutomationKey(
  value: unknown,
): string {
  return normalizeOpaqueKey(
    value,
    COMMUNITY_MEMBER_WORKFLOW_AUTOMATION_KEY_MAX_LENGTH,
    "community_member_workflow_automation_key_invalid",
  );
}

export function normalizeCommunityMemberWorkflowActionKey(
  value: unknown,
): string {
  return normalizeOpaqueKey(
    value,
    COMMUNITY_MEMBER_WORKFLOW_ACTION_KEY_MAX_LENGTH,
    "community_member_workflow_action_key_invalid",
  );
}

export function normalizeCommunityMemberWorkflowMilestoneName(
  value: unknown,
): string {
  const name = normalizeInlineText(
    value,
    COMMUNITY_MEMBER_WORKFLOW_MILESTONE_NAME_MAX_LENGTH,
  );
  if (!name) {
    throw new Error("community_member_workflow_milestone_name_required");
  }
  return name;
}

export function normalizeCommunityMemberWorkflowPrompt(
  value: unknown,
): string {
  const prompt = normalizeMultilineText(
    value,
    COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH,
  );
  if (!prompt) {
    throw new Error("community_member_workflow_prompt_required");
  }
  return prompt;
}

export function normalizeCommunityMemberWorkflowSourceRef(
  value: unknown,
): string {
  const sourceRef = normalizeInlineText(
    value,
    COMMUNITY_MEMBER_WORKFLOW_SOURCE_REF_MAX_LENGTH,
  );
  if (!sourceRef) {
    throw new Error("community_member_workflow_source_ref_required");
  }
  return sourceRef;
}

// A step can follow any earlier step in the stage, so two steps after the same
// one make a branch (each with its own "Only if").
export function workflowSequenceIssue(rules: CommunityMemberWorkflowAutomation[]): string | null {
  const earlier: CommunityMemberWorkflowAutomation[] = [];
  for (const rule of rules) {
    if (rule.trigger.type === "previous_action_completed") {
      if (rule.action.type !== "request_form" && rule.action.type !== "prompt_agent" && rule.action.type !== "set_client_property" && rule.action.type !== "send_email")
        return "A step after another step can ask the agent, send an email, request a form or update the member record";
      const predecessorKey = rule.trigger.predecessorActionKey;
      const predecessor = earlier.find((item) => item.action.key === predecessorKey);
      if (!predecessor) return "Choose an earlier step for this one to follow";
      if (workflowRuleIsNudge(predecessor)) return "A nudge can't start other steps";
    }
    earlier.push(rule);
  }
  return null;
}

/** The step needs a durable timer as its source: a wait, or an agent step started
 * by a lesson, course or webhook (those have no other receipt the agent can cite). */
export function workflowRuleUsesTimer(rule: { trigger: CommunityMemberWorkflowTrigger; action: { type: string } }): boolean {
  return rule.trigger.type === "milestone_elapsed"
    || (rule.trigger.type === "previous_action_completed" && (rule.trigger.delayMinutes ?? 0) > 0)
    || ((rule.trigger.type === "lesson_completed" || rule.trigger.type === "course_completed" || rule.trigger.type === "track_completed")
      && rule.action.type === "prompt_agent");
}

export function normalizeWorkflowCondition(value: unknown): CommunityMemberWorkflowCondition | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const propertyKey = String(raw.propertyKey ?? "").trim();
  const op = raw.op;
  if (!propertyKey || propertyKey.length > 64 || (op !== "is" && op !== "is_not" && op !== "is_set" && op !== "is_empty")) {
    throw new Error("workflow_condition_invalid");
  }
  if (op === "is_set" || op === "is_empty") return { propertyKey, op };
  const v = raw.value;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw new Error("workflow_condition_invalid");
  return { propertyKey, op, value: typeof v === "string" ? v.slice(0, 200) : v };
}

/** Pure check of a client property value against a condition. */
export function workflowConditionHolds(condition: CommunityMemberWorkflowCondition,
  value: string | number | boolean | string[] | null | undefined): boolean {
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  if (condition.op === "is_set") return !empty;
  if (condition.op === "is_empty") return empty;
  const equal = Array.isArray(value) ? value.includes(String(condition.value))
    : !empty && String(value).toLowerCase() === String(condition.value).toLowerCase();
  return condition.op === "is" ? equal : !equal;
}

/** Skipped steps still count as done; these result codes mark them. */
export const WORKFLOW_SKIP_RESULT_CODES = ["condition_skipped", "path_skipped"] as const;
export function workflowRunWasSkipped(run: { actionResult?: { resultCode?: string } | null } | null | undefined): boolean {
  return !!run?.actionResult?.resultCode && (WORKFLOW_SKIP_RESULT_CODES as readonly string[]).includes(run.actionResult.resultCode);
}

export function workflowSequenceReceipt(run: { membershipId: unknown; activationSequence?: number; transitionSeq?: number;
  milestoneKey: string; milestoneEnteredAt: number; actionSnapshot: { key: string } }): string {
  return `action_completion:${run.membershipId}:${run.activationSequence ?? 0}:${run.transitionSeq ?? 0}:${run.milestoneKey}:${run.milestoneEnteredAt}:${run.actionSnapshot.key}`;
}

/** Equal wall-clock timestamps cannot establish that an older run completed after
 * a definition edit. Fail closed in that case; a run admitted under the activation
 * revision is known to have started after the dependency was saved. */
export function workflowSequenceCompletionIsNew(rule: CommunityMemberWorkflowAutomation, completedAt: number,
  sourceRevision: number): boolean {
  return rule.sequenceEnabledAt !== undefined && (completedAt > rule.sequenceEnabledAt
    || (completedAt === rule.sequenceEnabledAt && sourceRevision >= (rule.sequenceEnabledRevision ?? Infinity)));
}

/** A nudge: an agent check-in that never holds the stage open. */
export function workflowRuleIsNudge(rule: { trigger: CommunityMemberWorkflowTrigger }): boolean {
  return rule.trigger.type === "milestone_elapsed" && rule.trigger.nudge === true;
}

// What an "Ask the agent" step sees, chosen by the owner. Absent means today's
// bundle (approved facts plus the form that started the step). Every entry is
// read fresh when the step runs and handed to the agent as untrusted data.
export const WORKFLOW_AGENT_SEES_MAX = 12;
export const WORKFLOW_AGENT_SEES_DEFAULT = ["facts"] as const;
export type WorkflowAgentSee =
  | "facts"            // approved community facts about the member
  | "progress"         // lessons done and courses finished
  | "guide_channel"    // the last messages in the member's guide channel
  | `form:${string}`   // the member's latest answers to this form
  | `property:${string}` // one client property's value
  | `lesson:${string}`;  // a lesson page's text

const SEE_REF = /^(form|property|lesson):[A-Za-z0-9_-]{1,64}$/;

export function normalizeWorkflowAgentSees(value: unknown): WorkflowAgentSee[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > WORKFLOW_AGENT_SEES_MAX) throw new Error("workflow_agent_sees_invalid");
  const out: WorkflowAgentSee[] = [];
  for (const raw of value) {
    const entry = String(raw ?? "").trim();
    if (entry !== "facts" && entry !== "progress" && entry !== "guide_channel" && !SEE_REF.test(entry)) {
      throw new Error("workflow_agent_sees_invalid");
    }
    if (!out.includes(entry as WorkflowAgentSee)) out.push(entry as WorkflowAgentSee);
  }
  return out;
}

export function workflowAgentSeesFacts(sees: readonly string[] | undefined): boolean {
  return !sees || sees.includes("facts");
}

/** Form keys picked on the step; null means any recent form (today's bundle). */
export function workflowAgentSeesFormKeys(sees: readonly string[] | undefined): string[] | null {
  return sees ? sees.filter((entry) => entry.startsWith("form:")).map((entry) => entry.slice(5)) : null;
}
