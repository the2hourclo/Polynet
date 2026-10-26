import type {
  CommunityMemberWorkflowAutomation,
  CommunityMemberWorkflowMilestone,
} from "../../../../shared/communityMemberWorkflow";
import type { CloudCommunityChannel } from "../../../../shared/cloudCommunityChannelsGateway";
import { normalizeWorkflowDelayMinutes } from "../../../../shared/communityMemberWorkflow";

export function workflowChannelLabel(channelId: string | undefined, channels: CloudCommunityChannel[], unavailable: boolean): string {
  if (channelId === undefined) return "Any channel";
  const channel = channels.find((item) => item.id === channelId);
  if (channel) return `#${channel.name}`;
  return unavailable ? "Channels unavailable" : "Unavailable channel";
}

export function workflowAutomationIssue(automation: CommunityMemberWorkflowAutomation, channels: CloudCommunityChannel[], unavailable: boolean): string | null {
  if ((automation.action.type === "create_service_channel" && automation.trigger.type !== "member_joined")
    || (automation.trigger.type === "member_joined" && automation.action.type !== "create_service_channel" && automation.action.type !== "request_form")) return "Member joins requires Create private channel or Request form";
  if ((automation.action.type === "request_form" && !automation.action.formKey) || (automation.trigger.type === "form_submitted" && !automation.trigger.formKey)) return "Choose a published form";
  if (automation.trigger.type === "form_submitted" && automation.action.type === "request_form") return "Choose Ask agent";
  if ((automation.trigger.type === "lesson_completed" || automation.trigger.type === "course_completed" || automation.trigger.type === "track_completed")
    && automation.action.type !== "request_form" && automation.action.type !== "set_client_property") return "Choose Request form or Set client property";
  if (automation.action.type === "set_client_property" && !automation.action.propertyKey) return "Choose a client property";
  const triggerIssue = workflowTriggerIssue(automation, channels, unavailable);
  if (triggerIssue) return triggerIssue;
  return automation.action.type === "prompt_agent" && !automation.action.prompt.trim() ? "Add agent instructions" : null;
}

export function workflowTriggerIssue(automation: CommunityMemberWorkflowAutomation, channels: CloudCommunityChannel[], unavailable: boolean): string | null {
  if (automation.trigger.type === "previous_action_completed" && !automation.trigger.predecessorActionKey) return "Choose a preceding action";
  if (automation.trigger.type === "form_submitted" && !automation.trigger.formKey) return "Choose a published form";
  if (automation.trigger.type === "milestone_elapsed") {
    try { normalizeWorkflowDelayMinutes(automation.trigger.delayMinutes); }
    catch { return "Choose a duration from 1 minute to 365 days"; }
    if (automation.trigger.nudge && automation.action.type !== "prompt_agent") return "A nudge can only ask the agent";
  }
  const channelId = automation.trigger.type === "member_contributed" ? automation.trigger.channelId : undefined;
  if (channelId !== undefined) {
    if (unavailable) return "Waiting for channels";
    if (!channels.some((channel) => channel.id === channelId)) return "Choose an available channel";
  }
  return null;
}

// Editor-only state. Hidden prompt drafts must never enter the saved contract.
export type WorkflowAutomationDraft = CommunityMemberWorkflowAutomation & { promptDraft: string };

export function toWorkflowAutomationDraft(automation: CommunityMemberWorkflowAutomation): WorkflowAutomationDraft {
  return {
    ...automation,
    promptDraft: automation.action.type === "prompt_agent" ? automation.action.prompt : "",
  };
}

export function replaceWorkflowDraftAction(
  automation: WorkflowAutomationDraft,
  type: "prompt_agent" | "request_form" | "create_service_channel" | "set_client_property",
): WorkflowAutomationDraft {
  if (automation.action.type === type) return automation;
  const promptDraft = automation.action.type === "prompt_agent" ? automation.action.prompt : automation.promptDraft;
  return {
    ...automation,
    promptDraft,
    action: type === "prompt_agent"
      ? { key: automation.action.key, type, prompt: promptDraft }
      : type === "request_form" ? { key: automation.action.key, type, formKey: "" }
      : type === "set_client_property" ? { key: automation.action.key, type, propertyKey: "", value: null }
      : { key: automation.action.key, type: "create_service_channel" },
  };
}

export function workflowDraftAutomations(automations: WorkflowAutomationDraft[]): CommunityMemberWorkflowAutomation[] {
  return automations.map(({ promptDraft: _promptDraft, ...automation }) => automation);
}

export function isWorkflowMilestoneDraftDirty(
  snapshot: CommunityMemberWorkflowMilestone | null,
  name: string,
  automations: WorkflowAutomationDraft[],
  instructions = snapshot?.instructions ?? "",
  goal = snapshot?.goal ?? "",
  requireHumanApproval = snapshot?.requireHumanApproval ?? false,
): boolean {
  return snapshot !== null && (
    name !== snapshot.name
    || instructions !== (snapshot.instructions ?? "")
    || goal !== (snapshot.goal ?? "")
    || requireHumanApproval !== (snapshot.requireHumanApproval ?? false)
    || JSON.stringify(workflowDraftAutomations(automations)) !== JSON.stringify(snapshot.automations)
  );
}
