import {
  BookOpen, Bot, CalendarDays, Clock, CreditCard, DoorOpen, FileText, FlaskConical, GitBranch, Hourglass, Lock,
  MessageSquare, PenLine, Plus, Repeat, Route, ShoppingBag, Trash2, Trophy, UserCog, Webhook, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  workflowRuleIsNudge,
  workflowSequenceIssue,
  type CommunityMemberWorkflowAutomation,
  type CommunityMemberWorkflowMilestone,
} from "../../../../shared/communityMemberWorkflow";
import type { CloudCommunityChannel } from "../../../../shared/cloudCommunityChannelsGateway";
import { WebCommunityWorkflowAutomationEditor, type WorkflowCatalog } from "./WebCommunityWorkflowAutomationEditor";
import {
  applyWorkflowTriggerType, replaceWorkflowDraftAction, toWorkflowAutomationDraft, workflowActionChoices,
  workflowAutomationIssue, workflowDraftAutomations,
  type WorkflowActionType, type WorkflowAutomationDraft, type WorkflowTriggerType,
} from "./workflowMilestoneDraft";
import { workflowActionPhrase, workflowConditionPhrase, workflowDurationLabel, workflowTriggerPhrase, type WorkflowStepNames } from "./workflowStepSentences";

// Workflows → Automations, laid out like Airtable Automations: the list of
// automations on the left (one section per stage), the selected automation as
// a When card and numbered Then cards in the middle, and the selected card's
// settings on the right. An automation is a rule plus the rules that wait for
// it, so this is a view over the stage rules the engine already runs.

type Family = "people" | "learn" | "forms" | "time" | "outside" | "agent" | "send" | "change" | "logic";
type Option = { family: Family; icon: LucideIcon; label: string; type?: string };

const TRIGGERS: Array<{ family: Family; name: string; options: Option[] }> = [
  { family: "people", name: "People", options: [
    { family: "people", icon: DoorOpen, label: "Someone joins", type: "member_joined" },
    { family: "people", icon: ShoppingBag, label: "Someone buys a package" },
    { family: "people", icon: CreditCard, label: "A payment fails or they cancel" },
    { family: "people", icon: UserCog, label: "A member record changes" },
  ] },
  { family: "learn", name: "Learning", options: [
    { family: "learn", icon: BookOpen, label: "Finishes a lesson", type: "lesson_completed" },
    { family: "learn", icon: Trophy, label: "Finishes a course", type: "course_completed" },
    { family: "learn", icon: Route, label: "Finishes a track", type: "track_completed" },
  ] },
  { family: "forms", name: "Forms and posts", options: [
    { family: "forms", icon: FileText, label: "Sends back a form", type: "form_submitted" },
    { family: "forms", icon: MessageSquare, label: "Posts in a channel", type: "member_contributed" },
  ] },
  { family: "time", name: "Time", options: [
    { family: "time", icon: Clock, label: "Time in this stage", type: "milestone_elapsed" },
    { family: "time", icon: CalendarDays, label: "On a date" },
    { family: "time", icon: Repeat, label: "Every day or week" },
  ] },
  { family: "outside", name: "Another app", options: [
    { family: "outside", icon: Webhook, label: "A booking, payment or Zap" },
  ] },
];

const ACTIONS: Record<WorkflowActionType, Option> = {
  prompt_agent: { family: "agent", icon: Bot, label: "Agent sends a message" },
  request_form: { family: "send", icon: FileText, label: "Send a form" },
  create_service_channel: { family: "send", icon: Lock, label: "Open a private room" },
  set_client_property: { family: "change", icon: PenLine, label: "Update member record" },
};

function triggerOption(type: WorkflowTriggerType): Option {
  for (const group of TRIGGERS) for (const option of group.options) if (option.type === type) return option;
  return { family: "logic", icon: GitBranch, label: "After an earlier step" };
}

type Chain = { root: WorkflowAutomationDraft; steps: WorkflowAutomationDraft[] };

/** Each rule that starts on its own, followed by every rule that waits for it (in run order). */
export function automationChains(automations: WorkflowAutomationDraft[]): Chain[] {
  const actionKeys = new Set(automations.map((automation) => automation.action.key));
  const children = new Map<string, WorkflowAutomationDraft[]>();
  const roots: WorkflowAutomationDraft[] = [];
  for (const automation of automations) {
    const parent = automation.trigger.type === "previous_action_completed" ? automation.trigger.predecessorActionKey : null;
    if (parent && actionKeys.has(parent) && parent !== automation.action.key) children.set(parent, [...(children.get(parent) ?? []), automation]);
    else roots.push(automation);
  }
  return roots.map((root) => {
    const steps: WorkflowAutomationDraft[] = [];
    const visit = (rule: WorkflowAutomationDraft) => { steps.push(rule); (children.get(rule.action.key) ?? []).forEach(visit); };
    visit(root);
    return { root, steps };
  });
}

function capitalize(text: string): string { return text.charAt(0).toUpperCase() + text.slice(1); }

function newRuleKey(prefix: string): string { return `draft-${prefix}-${crypto.randomUUID()}`; }

type Selection = { stageKey: string; ruleKey: string; part: "trigger" | "action" | "wait" | "condition" };

type Props = {
  milestones: CommunityMemberWorkflowMilestone[];
  memberCounts: Map<string, number>;
  forms: Array<{ key: string; name: string }>;
  channels: CloudCommunityChannel[];
  channelsUnavailable: boolean;
  catalog: WorkflowCatalog;
  isSaving: boolean;
  error: string | null;
  onSaveStage: (milestone: CommunityMemberWorkflowMilestone, automations: CommunityMemberWorkflowAutomation[]) => Promise<boolean>;
  onEditStage: (milestoneKey: string) => void;
  onAddStage: () => void;
  onTestStage?: (milestoneKey: string, index: number) => void;
};

export function WebCommunityWorkflowAutomations(props: Props) {
  const names: WorkflowStepNames = { forms: props.forms, channels: props.channels, catalog: props.catalog };
  // Unsaved edits, per stage. A stage without edits shows what's live.
  const [drafts, setDrafts] = useState<Record<string, WorkflowAutomationDraft[]>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saveIssue, setSaveIssue] = useState<string | null>(null);

  const rulesOf = (milestone: CommunityMemberWorkflowMilestone): WorkflowAutomationDraft[] =>
    drafts[milestone.key] ?? milestone.automations.map(toWorkflowAutomationDraft);
  const stages = props.milestones.filter((milestone) => milestone.key);
  const chainsByStage = useMemo(() => new Map(stages.map((stage) => [stage.key, automationChains(rulesOf(stage))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.milestones, drafts]);

  // Open the first automation, and recover when the selected one is gone.
  useEffect(() => {
    const current = selection && chainsByStage.get(selection.stageKey)?.some((chain) => chain.steps.some((rule) => rule.key === selection.ruleKey));
    if (current) return;
    for (const stage of stages) {
      const first = chainsByStage.get(stage.key)?.[0];
      if (first) { setSelection({ stageKey: stage.key, ruleKey: first.root.key, part: "trigger" }); return; }
    }
    setSelection(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainsByStage]);

  const stage = stages.find((item) => item.key === selection?.stageKey) ?? null;
  const stageIndex = stage ? props.milestones.indexOf(stage) : -1;
  const rules = stage ? rulesOf(stage) : [];
  const chain = stage ? chainsByStage.get(stage.key)?.find((item) => item.steps.some((rule) => rule.key === selection?.ruleKey)) ?? null : null;
  const selected = rules.find((rule) => rule.key === selection?.ruleKey) ?? null;
  const dirtyStages = Object.keys(drafts);

  const setRules = (stageKey: string, next: WorkflowAutomationDraft[]) => {
    setSaveIssue(null);
    setDrafts((current) => ({ ...current, [stageKey]: next }));
  };
  const updateRule = (rule: WorkflowAutomationDraft) => {
    if (!stage) return;
    setRules(stage.key, rules.map((item) => item.key === rule.key ? rule : item));
  };

  const addAutomation = (milestone: CommunityMemberWorkflowMilestone) => {
    const rule = toWorkflowAutomationDraft({ key: newRuleKey("rule"), trigger: { type: "milestone_elapsed", delayMinutes: 1440 },
      action: { key: newRuleKey("action"), type: "prompt_agent", prompt: "" } });
    setRules(milestone.key, [...rulesOf(milestone), rule]);
    setSelection({ stageKey: milestone.key, ruleKey: rule.key, part: "trigger" });
  };
  const addAction = (kind: "action" | "wait" | "condition") => {
    if (!stage || !chain) return;
    const last = [...chain.steps].reverse().find((rule) => !workflowRuleIsNudge(rule)) ?? chain.root;
    const rule = toWorkflowAutomationDraft({ key: newRuleKey("rule"),
      trigger: { type: "previous_action_completed", predecessorActionKey: last.action.key, ...(kind === "wait" ? { delayMinutes: 1440 } : {}) },
      action: { key: newRuleKey("action"), type: "prompt_agent", prompt: "" } });
    setRules(stage.key, [...rules, rule]);
    setSelection({ stageKey: stage.key, ruleKey: rule.key, part: kind === "action" ? "action" : kind });
  };
  const removeSelected = () => {
    if (!stage || !selected) return;
    // A step takes the steps that wait for it with it, so nothing is left pointing at nothing.
    const gone = new Set<string>();
    const drop = (rule: WorkflowAutomationDraft) => {
      gone.add(rule.key);
      rules.filter((item) => item.trigger.type === "previous_action_completed" && item.trigger.predecessorActionKey === rule.action.key).forEach(drop);
    };
    drop(selected);
    setRules(stage.key, rules.filter((rule) => !gone.has(rule.key)));
    setSelection(chain && !gone.has(chain.root.key) ? { stageKey: stage.key, ruleKey: chain.root.key, part: "trigger" } : null);
  };

  const issueFor = (list: WorkflowAutomationDraft[]): string | null => {
    const sequence = workflowSequenceIssue(list);
    if (sequence) return sequence;
    for (const rule of list) {
      const issue = workflowAutomationIssue(rule, props.channels, props.channelsUnavailable);
      if (issue) return `${capitalize(workflowActionPhrase(rule, names))}: ${issue}`;
      if (rule.action.type === "prompt_agent" && !rule.action.prompt.trim()) return "An agent step needs instructions";
    }
    const joins = list.filter((rule) => rule.trigger.type === "member_joined").map((rule) => rule.action.type === "request_form" ? `form:${rule.action.formKey}` : rule.action.type);
    if (new Set(joins).size !== joins.length) return "Use one private room and one request per form when someone joins";
    return null;
  };
  const saveAll = async () => {
    for (const key of dirtyStages) {
      const milestone = stages.find((item) => item.key === key);
      if (!milestone) continue;
      const issue = issueFor(drafts[key]);
      if (issue) { setSaveIssue(`${milestone.name}: ${issue}`); setSelection((current) => current?.stageKey === key ? current : null); return; }
    }
    for (const key of dirtyStages) {
      const milestone = stages.find((item) => item.key === key);
      if (!milestone) continue;
      const saved = await props.onSaveStage(milestone, workflowDraftAutomations(drafts[key]).map((rule) => ({
        ...rule, key: rule.key.startsWith("draft-") ? "" : rule.key })) as CommunityMemberWorkflowAutomation[]);
      if (!saved) return;
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
    }
  };

  const card = (rule: WorkflowAutomationDraft, part: Selection["part"], option: Option, kind: string, value: string, number?: number) => {
    const Icon = option.icon;
    const pressed = selection?.ruleKey === rule.key && selection.part === part;
    return <button type="button" className={`pn-au-step is-${option.family}`} aria-pressed={pressed}
      onClick={() => stage && setSelection({ stageKey: stage.key, ruleKey: rule.key, part })}>
      {number ? <span className="pn-au-num">{number}</span> : null}
      <span className="pn-au-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
      <span className="pn-au-step-text"><small>{kind}</small><span>{value}</span></span>
    </button>;
  };

  const actionDetail = (rule: WorkflowAutomationDraft): string => {
    const action = rule.action;
    if (action.type === "prompt_agent") { const text = action.prompt.replace(/\s+/g, " ").trim(); return text ? `“${text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text}”` : "Add instructions"; }
    if (action.type === "request_form") return props.forms.find((form) => form.key === action.formKey)?.name ?? "Choose a form";
    if (action.type === "create_service_channel") return "Just them, you and the agent";
    return capitalize(workflowActionPhrase(rule, names).replace(/^set /, ""));
  };
  const triggerDetail = (rule: WorkflowAutomationDraft): string => {
    const trigger = rule.trigger;
    if (trigger.type === "member_joined") return "Anyone new to the community";
    if (trigger.type === "form_submitted") return props.forms.find((form) => form.key === trigger.formKey)?.name ?? "Choose a form";
    if (trigger.type === "milestone_elapsed") return trigger.nudge ? `Still here after ${workflowDurationLabel(trigger.delayMinutes)}` : `${workflowDurationLabel(trigger.delayMinutes)} after they arrive`;
    return capitalize(workflowTriggerPhrase(rule, names).replace(/^When (someone |they )?/, ""));
  };
  let number = 0;
  const thenCards = chain ? chain.steps.flatMap((rule, index) => {
    const out = [];
    const wait = rule.trigger.type === "previous_action_completed" ? rule.trigger.delayMinutes ?? 0 : 0;
    if (wait) out.push(card(rule, "wait", { family: "logic", icon: Hourglass, label: "Wait" }, "Wait", `${workflowDurationLabel(wait)}`, ++number));
    if (rule.condition) out.push(card(rule, "condition", { family: "logic", icon: GitBranch, label: "Only if" }, "Only if", capitalize(workflowConditionPhrase(rule.condition, names).replace(/^if /, "")), ++number));
    const option = ACTIONS[rule.action.type];
    out.push(card(rule, "action", option, option.label, actionDetail(rule), ++number));
    return out.map((element, inner) => <li key={`${rule.key}-${inner}-${index}`}>{element}</li>);
  }) : [];

  const earlierFor = (rule: WorkflowAutomationDraft) => rules.slice(0, Math.max(0, rules.indexOf(rule)));

  return <div className="pn-au">
    <nav className="pn-au-list" aria-label="Automations">
      {stages.map((milestone, index) => {
        const chains = chainsByStage.get(milestone.key) ?? [];
        const count = props.memberCounts.get(milestone.key) ?? 0;
        return <section key={milestone.key} className="pn-au-section">
          <header>
            <span><small>Stage {props.milestones.indexOf(milestone) + 1}{drafts[milestone.key] ? " · unsaved" : ""}</small>{milestone.name || `Stage ${index + 1}`}</span>
            <button type="button" className="pn-wf-link" onClick={() => props.onEditStage(milestone.key)} aria-label={`Edit the ${milestone.name} stage`}>Edit</button>
          </header>
          <p className="pn-au-section-meta">{count === 1 ? "1 member here" : `${count} members here`}</p>
          {chains.map((item) => {
            const option = triggerOption(item.root.trigger.type);
            const Icon = option.icon;
            const first = ACTIONS[item.root.action.type].label;
            const more = item.steps.length - 1;
            return <button key={item.root.key} type="button" className={`pn-au-item is-${option.family}`}
              aria-current={chain?.root.key === item.root.key}
              onClick={() => setSelection({ stageKey: milestone.key, ruleKey: item.root.key, part: "trigger" })}>
              <span className="pn-au-icon is-small"><Icon size={14} strokeWidth={2} aria-hidden="true" /></span>
              <span className="pn-au-item-text"><span>{capitalize(workflowTriggerPhrase(item.root, names).replace(/^When /, ""))}</span>
                <small>{first}{more ? ` + ${more} more` : ""}</small></span>
            </button>;
          })}
          <button type="button" className="pn-au-new" disabled={props.isSaving} onClick={() => addAutomation(milestone)}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" /> New automation</button>
        </section>;
      })}
      <button type="button" className="pn-au-new is-stage" disabled={props.isSaving} onClick={props.onAddStage}>
        <Plus size={14} strokeWidth={2} aria-hidden="true" /> Add a stage</button>
    </nav>

    <main className="pn-au-flow" aria-label="Selected automation">
      {chain && stage ? <>
        <header className="pn-au-flow-head">
          <div><h2>{capitalize(workflowTriggerPhrase(chain.root, names))}</h2>
            <p>Runs while a member is in {stage.name}.</p></div>
          {props.onTestStage ? <button type="button" className="workflow-secondary-button" onClick={() => props.onTestStage?.(stage.key, stageIndex)}>
            <FlaskConical size={15} strokeWidth={2} aria-hidden="true" /> Test with a test member</button> : null}
        </header>
        <p className="pn-au-label">When</p>
        {(() => { const option = triggerOption(chain.root.trigger.type); return card(chain.root, "trigger", option, option.label,
          triggerDetail(chain.root)); })()}
        <span className="pn-au-line" aria-hidden="true" />
        <p className="pn-au-label">Then</p>
        <ol className="pn-au-then">{thenCards}</ol>
        <div className="pn-au-add">
          <button type="button" onClick={() => addAction("action")}><Plus size={14} aria-hidden="true" /> Add action</button>
          <button type="button" onClick={() => addAction("wait")}><Hourglass size={14} aria-hidden="true" /> Wait, then act</button>
          <button type="button" onClick={() => addAction("condition")}><GitBranch size={14} aria-hidden="true" /> Only if…</button>
        </div>
      </> : <div className="pn-au-empty"><strong>No automations yet</strong><p>Pick a stage on the left and add one.</p></div>}
      {dirtyStages.length || saveIssue || props.error ? <div className="pn-au-savebar" role="status">
        <span>{saveIssue ?? props.error ?? "You have unsaved changes."}</span>
        <button type="button" className="workflow-secondary-button" disabled={props.isSaving} onClick={() => { setDrafts({}); setSaveIssue(null); }}>Discard</button>
        <button type="button" className="pn-wf-primary" disabled={props.isSaving || !dirtyStages.length} onClick={() => void saveAll()}>{props.isSaving ? "Saving…" : "Save changes"}</button>
      </div> : null}
    </main>

    <aside className="pn-au-panel" aria-label="Settings for the selected card">
      {selected && stage && selection ? <>
        {selection.part === "trigger" ? <>
          <p className="pn-au-label">Trigger</p>
          {TRIGGERS.map((group) => <div key={group.name} className={`pn-au-family is-${group.family}`}>
            <h4>{group.name}</h4>
            {group.options.map((option) => {
              const Icon = option.icon;
              const allowed = option.type && (option.type !== "member_joined" || stageIndex === 0);
              return <button key={option.label} type="button" className="pn-au-option" disabled={!allowed}
                aria-pressed={option.type === selected.trigger.type}
                title={option.type === "member_joined" && stageIndex !== 0 ? "Only the first stage can start when someone joins" : undefined}
                onClick={() => { const next = option.type ? applyWorkflowTriggerType(selected, option.type as WorkflowTriggerType, earlierFor(selected)) : null; if (next) updateRule(next); }}>
                <span className="pn-au-icon is-small"><Icon size={14} strokeWidth={2} aria-hidden="true" /></span>
                <span>{option.label}</span>{!option.type ? <em>Soon</em> : null}
              </button>;
            })}
          </div>)}
        </> : selection.part === "action" ? <>
          <p className="pn-au-label">Action</p>
          <div className="pn-au-family">
            {workflowActionChoices(selected.trigger.type).map((type) => {
              const option = ACTIONS[type];
              const Icon = option.icon;
              return <button key={type} type="button" className={`pn-au-option is-${option.family}`} aria-pressed={selected.action.type === type}
                onClick={() => updateRule(replaceWorkflowDraftAction(selected, type))}>
                <span className="pn-au-icon is-small"><Icon size={14} strokeWidth={2} aria-hidden="true" /></span><span>{option.label}</span>
              </button>;
            })}
          </div>
        </> : null}
        <p className="pn-au-label">Settings</p>
        <WebCommunityWorkflowAutomationEditor key={`${selected.key}:${selected.trigger.type}:${selected.action.type}`}
          automation={selected} index={rules.indexOf(selected)} earlierSteps={earlierFor(selected)}
          canAddJoin={stageIndex === 0} catalog={props.catalog} forms={props.forms} expanded hideHeading hideTypeSelects
          channels={props.channels} channelsUnavailable={props.channelsUnavailable} disabled={props.isSaving}
          onToggle={() => {}} onRemove={removeSelected} onChange={updateRule} />
        <button type="button" className="pn-au-delete" disabled={props.isSaving} onClick={removeSelected}>
          <Trash2 size={14} aria-hidden="true" /> {selected.key === chain?.root.key ? "Delete this automation" : "Delete this step"}</button>
      </> : <p className="pn-wf-muted">Pick a card to change it.</p>}
    </aside>
  </div>;
}
