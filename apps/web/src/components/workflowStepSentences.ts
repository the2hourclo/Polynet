import type {
  CommunityMemberWorkflowAutomation,
  CommunityMemberWorkflowCondition,
} from "../../../../shared/communityMemberWorkflow";
import type { CloudCommunityChannel } from "../../../../shared/cloudCommunityChannelsGateway";
import type { WorkflowCatalog } from "./WebCommunityWorkflowAutomationEditor";

// Each stage rule read as one plain sentence, arranged as the order it runs in:
// rules that start on their own come first, and a rule that waits for an earlier
// step sits under it ("Then…" / "2 days later…").

export type WorkflowStepNames = {
  forms?: Array<{ key: string; name: string }>;
  channels?: CloudCommunityChannel[];
  catalog?: WorkflowCatalog;
};

export type WorkflowStepLine = {
  automation: CommunityMemberWorkflowAutomation;
  /** "When someone joins" / "Then" / "2 days later". */
  lead: string;
  /** Everything after the lead: ", if Plan is Pro, send the Welcome form." */
  rest: string;
  depth: number;
};

export function workflowDurationLabel(minutes: number): string {
  const [size, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${size} ${unit}${size === 1 ? "" : "s"}`;
}

function quote(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return `“${flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat}”`;
}

function formName(key: string, names: WorkflowStepNames): string {
  return names.forms?.find((form) => form.key === key)?.name ?? "a form";
}

function propertyName(key: string, names: WorkflowStepNames): string {
  return names.catalog?.properties?.find((property) => property.key === key)?.name ?? key;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value === null || value === undefined || value === "" ? "empty" : String(value);
}

export function workflowConditionPhrase(condition: CommunityMemberWorkflowCondition | undefined, names: WorkflowStepNames): string {
  if (!condition) return "";
  const name = propertyName(condition.propertyKey, names);
  if (condition.op === "is_set") return `if ${name} is filled in`;
  if (condition.op === "is_empty") return `if ${name} is empty`;
  return `if ${name} ${condition.op === "is_not" ? "isn't" : "is"} ${formatValue(condition.value)}`;
}

export function workflowTriggerPhrase(automation: CommunityMemberWorkflowAutomation, names: WorkflowStepNames): string {
  const trigger = automation.trigger;
  switch (trigger.type) {
    case "member_joined": return "When someone joins";
    case "form_submitted": return `When they submit ${formName(trigger.formKey, names)}`;
    case "lesson_completed": {
      const lesson = trigger.resourceId ? names.catalog?.lessons?.find((item) => item.id === trigger.resourceId)?.title : null;
      return trigger.resourceId ? `When they finish ${lesson ? quote(lesson, 50) : "a lesson"}` : "When they finish any lesson";
    }
    case "course_completed": {
      const course = trigger.moduleId ? names.catalog?.lessons?.find((item) => item.courseId === trigger.moduleId)?.course : null;
      return trigger.moduleId ? `When they finish ${course ? `the ${quote(course, 50)} course` : "a course"}` : "When they finish any course";
    }
    case "member_contributed": {
      const channel = trigger.channelId ? names.channels?.find((item) => item.id === trigger.channelId)?.name : null;
      return trigger.channelId ? `When they post in #${channel ?? "a channel"}` : "When they post anywhere";
    }
    case "milestone_elapsed":
      return trigger.nudge ? `If they're still here after ${workflowDurationLabel(trigger.delayMinutes)}` : `${workflowDurationLabel(trigger.delayMinutes)} after they reach this stage`;
    case "previous_action_completed":
      return trigger.delayMinutes ? `${workflowDurationLabel(trigger.delayMinutes)} later` : "Then";
  }
}

export function workflowActionPhrase(automation: CommunityMemberWorkflowAutomation, names: WorkflowStepNames): string {
  const action = automation.action;
  switch (action.type) {
    case "create_service_channel": return "open a private guide channel";
    case "request_form": return `send the ${formName(action.formKey, names)} form`;
    case "prompt_agent": return action.prompt.trim() ? `ask the agent: ${quote(action.prompt)}` : "ask the agent (no instructions yet)";
    case "set_client_property": return `set ${propertyName(action.propertyKey, names)} to ${formatValue(action.value)}`;
  }
}

/** The rules in the order they run, each followed by the steps that wait for it. */
export function workflowStepLines(automations: CommunityMemberWorkflowAutomation[], names: WorkflowStepNames): WorkflowStepLine[] {
  const actionKeys = new Set(automations.map((automation) => automation.action.key));
  const children = new Map<string, CommunityMemberWorkflowAutomation[]>();
  const roots: CommunityMemberWorkflowAutomation[] = [];
  for (const automation of automations) {
    const parent = automation.trigger.type === "previous_action_completed" ? automation.trigger.predecessorActionKey : null;
    if (parent && actionKeys.has(parent) && parent !== automation.action.key) {
      children.set(parent, [...(children.get(parent) ?? []), automation]);
    } else roots.push(automation);
  }
  const lines: WorkflowStepLine[] = [];
  const seen = new Set<string>();
  const visit = (automation: CommunityMemberWorkflowAutomation, depth: number) => {
    if (seen.has(automation.key || automation.action.key)) return;
    seen.add(automation.key || automation.action.key);
    const lead = workflowTriggerPhrase(automation, names);
    const condition = workflowConditionPhrase(automation.condition, names);
    const action = workflowActionPhrase(automation, names);
    // "Then send…" reads straight on; every other lead takes a comma.
    const rest = `${condition ? `, ${condition},` : lead === "Then" ? "" : ","} ${action}${action.endsWith("”") ? "" : "."}`;
    lines.push({ automation, depth, lead, rest });
    for (const child of children.get(automation.action.key) ?? []) visit(child, depth + 1);
  };
  roots.forEach((automation) => visit(automation, 0));
  return lines;
}
