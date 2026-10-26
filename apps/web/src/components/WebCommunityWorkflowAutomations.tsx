import {
  BookOpen, Bot, CalendarDays, ChevronDown, Clock, CreditCard, DoorOpen, FileText, GitBranch, Hourglass, Lock, Mail,
  MessageSquare, MoreHorizontal, PenLine, Play, Plus, Repeat, Route, ShoppingBag, Trash2, Trophy, UserCog, Webhook, X, type LucideIcon,
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
  type WorkflowActionType, type WorkflowAutomationDraft, type WorkflowTriggerType, workflowStageDrafts,
} from "./workflowMilestoneDraft";
import { workflowActionPhrase, workflowConditionPhrase, workflowDurationLabel, workflowTriggerPhrase, type WorkflowStepNames } from "./workflowStepSentences";

// Workflows → Automations, laid out like Airtable Automations: the list of
// automations on the left (one section per stage), the selected automation as
// a When card and numbered Then cards in the middle, and the selected card's
// settings on the right. An automation is a rule plus the rules that wait for
// it, so this is a view over the stage rules the engine already runs.

type Option = { icon: LucideIcon; label: string; hint?: string; type?: string };

// Trigger kinds are told apart by icon and group, never by colour: the
// community's accent marks only what's selected (polynet-ui/airtable-study).
const TRIGGERS: Array<{ name: string; options: Option[] }> = [
  { name: "Members", options: [
    { icon: DoorOpen, label: "Someone joins", hint: "Only the first stage starts here", type: "member_joined" },
    { icon: ShoppingBag, label: "Buys a package" },
    { icon: CreditCard, label: "Payment fails or they cancel" },
    { icon: UserCog, label: "Member record changes", hint: "e.g. Plan becomes Pro", type: "client_property_changed" },
  ] },
  { name: "Learning", options: [
    { icon: BookOpen, label: "Finishes a lesson", type: "lesson_completed" },
    { icon: Trophy, label: "Finishes a course", type: "course_completed" },
    { icon: Route, label: "Finishes a track", type: "track_completed" },
    { icon: MessageSquare, label: "Posts in a channel", type: "member_contributed" },
  ] },
  { name: "Forms", options: [
    { icon: FileText, label: "Sends back a form", hint: "Runs once per member per form", type: "form_submitted" },
  ] },
  { name: "Time", options: [
    { icon: Clock, label: "After some time in this stage", type: "milestone_elapsed" },
    { icon: CalendarDays, label: "At a scheduled time", hint: "Every day, every week, or one date" },
    { icon: Repeat, label: "On a date in their record", hint: "e.g. 3 days before renewal" },
  ] },
  { name: "Outside", options: [
    { icon: Webhook, label: "A webhook is received", hint: "From Zapier, Make, or your own app" },
  ] },
];

const ACTIONS: Record<WorkflowActionType, Option & { group: string }> = {
  prompt_agent: { group: "Talk to them", icon: Bot, label: "Agent sends a message", hint: "In their private room" },
  send_email: { group: "Talk to them", icon: Mail, label: "Send an email", hint: "From Polynet, to their inbox" },
  request_form: { group: "Talk to them", icon: FileText, label: "Send a form" },
  set_client_property: { group: "Change things", icon: PenLine, label: "Update member record", hint: "Writes to the Members database" },
  create_service_channel: { group: "Change things", icon: Lock, label: "Open a private room", hint: "Just them, you and the agent" },
};

function triggerOption(type: WorkflowTriggerType): Option {
  for (const group of TRIGGERS) for (const option of group.options) if (option.type === type) return option;
  return { icon: GitBranch, label: "After an earlier step" };
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
  // The panel shows the trigger or action list in place of the settings while choosing.
  const [picking, setPicking] = useState(false);

  const rulesOf = (milestone: CommunityMemberWorkflowMilestone): WorkflowAutomationDraft[] =>
    drafts[milestone.key] ?? workflowStageDrafts(milestone);
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
    setPicking(true);
  };
  const addAction = (kind: "action" | "wait" | "condition") => {
    if (!stage || !chain) return;
    const last = [...chain.steps].reverse().find((rule) => !workflowRuleIsNudge(rule)) ?? chain.root;
    const rule = toWorkflowAutomationDraft({ key: newRuleKey("rule"),
      trigger: { type: "previous_action_completed", predecessorActionKey: last.action.key, ...(kind === "wait" ? { delayMinutes: 1440 } : {}) },
      action: { key: newRuleKey("action"), type: "prompt_agent", prompt: "" } });
    setRules(stage.key, [...rules, rule]);
    setSelection({ stageKey: stage.key, ruleKey: rule.key, part: kind === "action" ? "action" : kind });
    setPicking(kind === "action");
  };
  // The Otherwise path of a chained Only if: a sibling step after the same step,
  // with the same clauses, that runs for the members the Only if leaves out.
  const otherwiseOf = (rule: WorkflowAutomationDraft) => rule.trigger.type !== "previous_action_completed" || !rule.condition || rule.condition.otherwise ? null
    : rules.find((item) => item.key !== rule.key && item.condition?.otherwise && item.trigger.type === "previous_action_completed"
      && item.trigger.predecessorActionKey === (rule.trigger as { predecessorActionKey: string }).predecessorActionKey) ?? null;
  const addOtherwise = (rule: WorkflowAutomationDraft) => {
    if (!stage || rule.trigger.type !== "previous_action_completed" || !rule.condition) return;
    const otherwise = toWorkflowAutomationDraft({ key: newRuleKey("rule"),
      trigger: { type: "previous_action_completed", predecessorActionKey: rule.trigger.predecessorActionKey, ...(rule.trigger.delayMinutes ? { delayMinutes: rule.trigger.delayMinutes } : {}) },
      condition: { ...rule.condition, otherwise: true },
      action: { key: newRuleKey("action"), type: "prompt_agent", prompt: "" } });
    setRules(stage.key, [...rules, otherwise]);
    setSelection({ stageKey: stage.key, ruleKey: otherwise.key, part: "action" });
    setPicking(true);
  };
  // Off or on for the whole automation: its trigger and every step after it.
  const chainIsOff = !!chain?.root.paused;
  const setChainOff = (off: boolean) => {
    if (!stage || !chain) return;
    const keys = new Set(chain.steps.map((rule) => rule.key));
    setRules(stage.key, rules.map((rule) => keys.has(rule.key) ? (off ? { ...rule, paused: true } : (({ paused: _paused, ...rest }) => rest)(rule)) : rule));
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

  const card = (rule: WorkflowAutomationDraft, part: Selection["part"], option: Option, kind: string, value: string, detail?: string) => {
    const Icon = option.icon;
    const pressed = selection?.ruleKey === rule.key && selection.part === part;
    return <button type="button" className="pn-au-step" aria-pressed={pressed}
      onClick={() => { setPicking(false); if (stage) setSelection({ stageKey: stage.key, ruleKey: rule.key, part }); }}>
      <span className="pn-au-icon"><Icon size={16} strokeWidth={2} aria-hidden="true" /></span>
      <span className="pn-au-step-text"><small>{kind}</small><strong>{value}</strong>{detail ? <span>{detail}</span> : null}</span>
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
    if (wait) out.push(card(rule, "wait", { icon: Hourglass, label: "Wait" }, `${++number} · Wait`, workflowDurationLabel(wait)));
    if (rule.condition) out.push(rule.condition.otherwise
      ? card(rule, "condition", { icon: GitBranch, label: "Otherwise" }, `${++number} · Otherwise`, capitalize(workflowConditionPhrase(rule.condition, names).replace(/^if /, "")), "For members who don't match the Only if")
      : card(rule, "condition", { icon: GitBranch, label: "Only if" }, `${++number} · Only if`, capitalize(workflowConditionPhrase(rule.condition, names).replace(/^if /, "")),
        otherwiseOf(rule) ? "Members who don't match take the Otherwise path" : "Otherwise the steps after it are skipped"));
    const option = ACTIONS[rule.action.type];
    out.push(card(rule, "action", option, `${++number} · Then`, option.label, actionDetail(rule)));
    return out.map((element, inner) => <li key={`${rule.key}-${inner}-${index}`}>{element}</li>);
  }) : [];
  const stepNumber = (() => {
    if (!chain || !selected) return 0;
    let n = 0;
    for (const rule of chain.steps) {
      if (rule.trigger.type === "previous_action_completed" && rule.trigger.delayMinutes) n++;
      if (rule.condition) n++;
      n++;
      if (rule.key === selected.key) return n;
    }
    return 0;
  })();

  const earlierFor = (rule: WorkflowAutomationDraft) => rules.slice(0, Math.max(0, rules.indexOf(rule)));
  const newTarget = stage ?? stages[0] ?? null;
  const selectedTrigger = selected ? triggerOption(selected.trigger.type) : null;
  const selectedAction = selected ? ACTIONS[selected.action.type] : null;
  const typePick = (option: Option) => {
    const Icon = option.icon;
    return <button type="button" className="pn-au-typepick" aria-expanded={picking} onClick={() => setPicking((open) => !open)}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      <span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span>
      <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
    </button>;
  };

  return <div className="pn-au">
    <nav className="pn-au-list" aria-label="Automations">
      <div className="pn-au-listhead">
        <h2>Automations</h2>
        <button type="button" className="pn-au-ghost" disabled={props.isSaving || !newTarget}
          onClick={() => newTarget && addAutomation(newTarget)} aria-label="New automation">
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> New</button>
      </div>
      {stages.map((milestone, index) => {
        const chains = chainsByStage.get(milestone.key) ?? [];
        const count = props.memberCounts.get(milestone.key) ?? 0;
        return <section key={milestone.key} className={`pn-au-section${milestone.color ? ` pn-stage-color-${milestone.color}` : ""}`}>
          <header>
            {milestone.color ? <span className="pn-au-stagedot" aria-hidden="true" /> : null}
            <span className="pn-au-group">While in {milestone.name || `stage ${index + 1}`}{drafts[milestone.key] ? " · unsaved" : ""}</span>
            <span className="pn-au-count" title={count === 1 ? "1 member here" : `${count} members here`}>{count}</span>
            <button type="button" className="pn-au-iconbtn" onClick={() => props.onEditStage(milestone.key)}
              aria-label={`Stage settings for ${milestone.name}`} title="Rename, colour, goal, delete">
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" /></button>
          </header>
          {chains.map((item) => {
            const option = triggerOption(item.root.trigger.type);
            const Icon = option.icon;
            const first = ACTIONS[item.root.action.type].label;
            const more = item.steps.length - 1;
            return <button key={item.root.key} type="button" className={`pn-au-item${item.root.paused ? " is-off" : ""}`}
              aria-current={chain?.root.key === item.root.key}
              onClick={() => { setPicking(false); setSelection({ stageKey: milestone.key, ruleKey: item.root.key, part: "trigger" }); }}>
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              <span className="pn-au-item-text"><span>{capitalize(workflowTriggerPhrase(item.root, names).replace(/^When /, ""))}</span>
                <small>{item.root.paused ? "Off · " : ""}{first}{more ? ` + ${more} more` : ""}</small></span>
            </button>;
          })}
          {!chains.length ? <p className="pn-au-none">No automations in this stage.</p> : null}
        </section>;
      })}
      <button type="button" className="pn-au-ghost is-stage" disabled={props.isSaving} onClick={props.onAddStage}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" /> Add stage</button>
    </nav>

    <main className="pn-au-main" aria-label="Selected automation">
      {chain && stage ? <header className="pn-au-head">
        <div><h2>{capitalize(workflowTriggerPhrase(chain.root, names))}</h2>
          <p className={stage.color ? `pn-stage-color-${stage.color}` : undefined}>{stage.color ? <span className="pn-au-stagedot" aria-hidden="true" /> : null}While in {stage.name} · {chain.steps.length === 1 ? "1 step" : `${chain.steps.length} steps`}</p></div>
        <button type="button" role="switch" aria-checked={!chainIsOff} className={`pn-au-switch${chainIsOff ? "" : " is-on"}`} disabled={props.isSaving}
          title={chainIsOff ? "Off: it won't run for anyone" : "On: it runs for members in this stage"} onClick={() => setChainOff(!chainIsOff)}>
          <span className="pn-au-switch-track" aria-hidden="true"><span className="pn-au-switch-thumb" /></span>{chainIsOff ? "Off" : "On"}</button>
        {props.onTestStage ? <button type="button" className="pn-au-btn" onClick={() => props.onTestStage?.(stage.key, stageIndex)}>
          <Play size={14} strokeWidth={2} aria-hidden="true" /> Test</button> : null}
      </header> : null}
      {dirtyStages.length || saveIssue || props.error ? <div className="pn-au-savebar" role="status">
        <span>{saveIssue ?? props.error ?? "You changed this automation. Members keep the live version until you update."}</span>
        <button type="button" className="pn-au-ghost" disabled={props.isSaving} onClick={() => { setDrafts({}); setSaveIssue(null); }}>Discard changes</button>
        <button type="button" className="pn-wf-primary is-small" disabled={props.isSaving || !dirtyStages.length} onClick={() => void saveAll()}>{props.isSaving ? "Updating…" : "Update"}</button>
      </div> : null}
      <div className="pn-au-flow">
        {chain && stage ? <>
          {(() => { const option = triggerOption(chain.root.trigger.type); return card(chain.root, "trigger", option, "When", option.label, triggerDetail(chain.root)); })()}
          <ol className="pn-au-then">{thenCards}</ol>
          <div className="pn-au-add">
            <button type="button" className="pn-au-btn" onClick={() => addAction("action")}><Plus size={14} aria-hidden="true" /> Add action</button>
            <button type="button" className="pn-au-btn" onClick={() => addAction("wait")}><Hourglass size={14} aria-hidden="true" /> Wait</button>
            <button type="button" className="pn-au-btn" onClick={() => addAction("condition")}><GitBranch size={14} aria-hidden="true" /> Only if</button>
          </div>
        </> : <div className="pn-au-empty"><strong>No automation open</strong><p>Pick one on the left, or press New.</p></div>}
      </div>
    </main>

    <aside className="pn-au-panel" aria-label="Settings for the selected step">
      {selected && stage && selection ? picking && (selection.part === "trigger" || selection.part === "action") ? <>
        <div className="pn-au-panelhead"><span className="pn-au-group">{selection.part === "trigger" ? "Choose a trigger" : "Choose an action"}</span>
          <button type="button" className="pn-au-iconbtn" onClick={() => setPicking(false)} aria-label="Close"><X size={16} aria-hidden="true" /></button></div>
        {selection.part === "trigger" ? TRIGGERS.map((group) => <div key={group.name} className="pn-au-family">
          <span className="pn-au-group">{group.name}</span>
          {group.options.map((option) => {
            const Icon = option.icon;
            const allowed = option.type && (option.type !== "member_joined" || stageIndex === 0);
            return <button key={option.label} type="button" className="pn-au-option" disabled={!allowed}
              aria-pressed={option.type === selected.trigger.type}
              title={option.type === "member_joined" && stageIndex !== 0 ? "Only the first stage can start when someone joins" : undefined}
              onClick={() => { const next = option.type ? applyWorkflowTriggerType(selected, option.type as WorkflowTriggerType, earlierFor(selected), props.catalog?.properties?.[0]?.key) : null; if (next) { updateRule(next); setPicking(false); } }}>
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              <span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span>{!option.type ? <em>Soon</em> : null}
            </button>;
          })}
        </div>) : (() => {
          const choices = workflowActionChoices(selected.trigger.type);
          const groups = ["Talk to them", "Change things"].filter((group) => choices.some((type) => ACTIONS[type].group === group));
          return groups.map((group) => <div key={group} className="pn-au-family">
            <span className="pn-au-group">{group}</span>
            {choices.filter((type) => ACTIONS[type].group === group).map((type) => {
              const option = ACTIONS[type];
              const Icon = option.icon;
              return <button key={type} type="button" className="pn-au-option" aria-pressed={selected.action.type === type}
                onClick={() => { updateRule(replaceWorkflowDraftAction(selected, type)); setPicking(false); }}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" /><span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span>
              </button>;
            })}
          </div>);
        })()}
      </> : <>
        <span className="pn-au-group">{selection.part === "trigger" ? "Trigger" : selection.part === "wait" ? `Step ${stepNumber} · Wait`
          : selection.part === "condition" ? (selected.condition?.otherwise ? "Otherwise" : "Only if") : `Step ${stepNumber} · Action`}</span>
        {selection.part === "trigger" && selectedTrigger ? typePick(selectedTrigger) : null}
        {selection.part === "action" && selectedAction ? typePick(selectedAction) : null}
        <WebCommunityWorkflowAutomationEditor key={`${selected.key}:${selected.trigger.type}:${selected.action.type}`}
          automation={selected} index={rules.indexOf(selected)} earlierSteps={earlierFor(selected)}
          canAddJoin={stageIndex === 0} catalog={props.catalog} forms={props.forms} expanded hideHeading hideTypeSelects
          channels={props.channels} channelsUnavailable={props.channelsUnavailable} disabled={props.isSaving}
          onToggle={() => {}} onRemove={removeSelected} onChange={updateRule} />
        {selection.part === "condition" && selected.condition && !selected.condition.otherwise && selected.trigger.type === "previous_action_completed" && !otherwiseOf(selected)
          ? <button type="button" className="pn-au-btn" disabled={props.isSaving} onClick={() => addOtherwise(selected)}>
            <GitBranch size={14} aria-hidden="true" /> Add an Otherwise path</button> : null}
        <button type="button" className="pn-au-delete" disabled={props.isSaving} onClick={removeSelected}>
          <Trash2 size={14} aria-hidden="true" /> {selected.key === chain?.root.key ? "Delete this automation" : "Delete this step"}</button>
      </> : <p className="pn-wf-muted">Pick a step to change it.</p>}
    </aside>
  </div>;
}
