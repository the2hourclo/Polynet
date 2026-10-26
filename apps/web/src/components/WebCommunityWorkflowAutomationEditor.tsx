import { X } from "lucide-react";
import { useId, useState } from "react";
import type { CloudCommunityChannel } from "../../../../shared/cloudCommunityChannelsGateway";
import { COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH, WORKFLOW_AGENT_SEES_MAX, workflowRuleIsNudge, type CommunityMemberWorkflowAutomation, type CommunityMemberWorkflowCondition } from "../../../../shared/communityMemberWorkflow";
import { workflowActionPhrase, workflowDurationLabel } from "./workflowStepSentences";
import { WorkflowChannelPicker } from "./WorkflowChannelPicker";
import { applyWorkflowTriggerType, replaceWorkflowDraftAction, type WorkflowTriggerType, workflowAutomationIssue, workflowTriggerIssue, workflowChannelLabel, type WorkflowAutomationDraft } from "./workflowMilestoneDraft";

/** Lessons, courses and client properties a rule can name, loaded with the board. */
type WorkflowCatalogProperty = { key: string; name: string; type: string; options: string[] };
export type WorkflowCatalog = {
  lessons: Array<{ id: string; title: string; course: string; courseId: string }> | null;
  properties: WorkflowCatalogProperty[] | null;
  /** Roadmap tracks; missing until loaded. */
  tracks?: Array<{ key: string; title: string }> | null;
};

type PropertyValue = string | number | boolean | string[] | null;

// The value a "Set client property" rule writes, edited the way the property holds it.
function PropertyValueField(props: { id: string; property: WorkflowCatalogProperty;
  value: PropertyValue; disabled: boolean; onChange: (value: PropertyValue) => void }) {
  const { property, value } = props;
  const label = `Value for ${property.name}`;
  if (property.type === "multi_select") {
    const picked = Array.isArray(value) ? value : [];
    return <fieldset className="workflow-automation-field workflow-property-values"><legend>Set {property.name} to</legend>
      {property.options.map((option) => <label key={option}><input type="checkbox" disabled={props.disabled} checked={picked.includes(option)}
        onChange={(event) => { const next = event.target.checked ? [...picked, option] : picked.filter((item) => item !== option); props.onChange(next.length ? next : null); }} /> {option}</label>)}
      <small className="workflow-field-hint">Pick none to clear it.</small>
    </fieldset>;
  }
  if (property.type === "select" || property.type === "checkbox") {
    const options = property.type === "checkbox" ? [["true", "Yes"], ["false", "No"]] : property.options.map((option) => [option, option]);
    return <label>Set {property.name} to<select aria-label={label} disabled={props.disabled} value={value === null ? "" : String(value)}
      onChange={(event) => props.onChange(event.target.value === "" ? null : property.type === "checkbox" ? event.target.value === "true" : event.target.value)}>
      <option value="">Clear it</option>{options.map(([raw, text]) => <option key={raw} value={raw}>{text}</option>)}</select></label>;
  }
  const inputType = property.type === "number" ? "number" : property.type === "date" ? "date" : property.type === "url" ? "url" : "text";
  return <label>Set {property.name} to<input id={props.id} type={inputType} aria-label={label} disabled={props.disabled}
    value={value === null ? "" : String(value)} placeholder="Leave empty to clear it"
    onChange={(event) => props.onChange(event.target.value === "" ? null : property.type === "number" ? event.target.valueAsNumber : event.target.value)} /></label>;
}

// "Only if": the step runs when the member's client property matches, else it's skipped.
function ConditionField(props: { id: string; condition: CommunityMemberWorkflowCondition | undefined;
  properties: WorkflowCatalogProperty[] | null | undefined; disabled: boolean;
  onChange: (condition: CommunityMemberWorkflowCondition | undefined) => void }) {
  const { condition } = props;
  const properties = props.properties ?? [];
  if (!condition) {
    return <div className="workflow-automation-field workflow-step-extra">
      <button type="button" className="workflow-step-extra-add" disabled={props.disabled || !properties.length}
        onClick={() => properties[0] && props.onChange({ propertyKey: properties[0].key, op: "is_set" })}>+ Only if…</button>
      <small className="workflow-field-hint">{properties.length ? "Run this step only for some members, by a client property." : "Add a client property under Clients to run steps only for some members."}</small>
    </div>;
  }
  const property = properties.find((item) => item.key === condition.propertyKey);
  const needsValue = condition.op === "is" || condition.op === "is_not";
  const options = property?.type === "checkbox" ? [["true", "Yes"], ["false", "No"]]
    : property && (property.type === "select" || property.type === "multi_select") ? property.options.map((option) => [option, option]) : null;
  const setValue = (raw: string) => props.onChange({ ...condition, value: property?.type === "checkbox" ? raw === "true" : property?.type === "number" && raw !== "" ? Number(raw) : raw });
  return <fieldset className="workflow-agent-inputs">
    <legend className="workflow-agent-inputs-title">Only if</legend>
    <div className="workflow-action-choice-row">
      <select aria-label="Client property" value={condition.propertyKey} disabled={props.disabled}
        onChange={(event) => props.onChange({ propertyKey: event.target.value, op: condition.op === "is_empty" ? "is_empty" : "is_set" })}>
        {!property ? <option value={condition.propertyKey}>{condition.propertyKey} (archived)</option> : null}
        {properties.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
      </select>
      <select aria-label="Comparison" value={condition.op} disabled={props.disabled} onChange={(event) => {
        const op = event.target.value as CommunityMemberWorkflowCondition["op"];
        props.onChange(op === "is" || op === "is_not" ? { propertyKey: condition.propertyKey, op, value: condition.value ?? (options?.[0] ? (property?.type === "checkbox" ? true : options[0][0]) : "") } : { propertyKey: condition.propertyKey, op });
      }}>
        <option value="is">is</option><option value="is_not">isn't</option><option value="is_set">is filled in</option><option value="is_empty">is empty</option>
      </select>
      {needsValue ? options
        ? <select aria-label="Value" value={String(condition.value ?? "")} disabled={props.disabled} onChange={(event) => setValue(event.target.value)}>
            {options.map(([raw, text]) => <option key={raw} value={raw}>{text}</option>)}</select>
        : <input id={`${props.id}-condition-value`} aria-label="Value" type={property?.type === "number" ? "number" : "text"} value={String(condition.value ?? "")}
            disabled={props.disabled} onChange={(event) => setValue(event.target.value)} /> : null}
    </div>
    <small className="workflow-field-hint">Members who don't match skip this step and every step after it.</small>
    <button type="button" className="workflow-agent-inputs-reset" disabled={props.disabled} onClick={() => props.onChange(undefined)}>Run for everyone</button>
  </fieldset>;
}

// "What the agent sees" on an Ask-the-agent step. Unset keeps today's bundle;
// once the owner picks, only the ticked inputs reach the agent.
function AgentInputsField(props: { id: string; sees: string[] | undefined; catalog?: WorkflowCatalog;
  forms?: Array<{ key: string; name: string }>; disabled: boolean; onChange: (sees: string[] | undefined) => void }) {
  const { sees } = props;
  if (!sees) {
    return <div className="workflow-agent-inputs">
      <span className="workflow-agent-inputs-title">What the agent sees</span>
      <p className="workflow-field-hint">Facts about the member and the form that started this step.</p>
      <button type="button" className="secondary" disabled={props.disabled} onClick={() => props.onChange(["facts"])}>Choose what it sees</button>
    </div>;
  }
  const full = sees.length >= WORKFLOW_AGENT_SEES_MAX;
  const toggle = (entry: string, on: boolean) => props.onChange(on ? [...sees, entry] : sees.filter((item) => item !== entry));
  const box = (entry: string, label: string, hint?: string) => {
    const checked = sees.includes(entry);
    return <label key={entry} className="workflow-agent-input">
      <input type="checkbox" checked={checked} disabled={props.disabled || (full && !checked)} onChange={(event) => toggle(entry, event.target.checked)} />
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
    </label>;
  };
  const lessons = props.catalog?.lessons ?? [];
  const pickedLessons = sees.filter((entry) => entry.startsWith("lesson:")).map((entry) => entry.slice(7));
  return <fieldset className="workflow-agent-inputs" aria-describedby={`${props.id}-inputs-help`}>
    <legend className="workflow-agent-inputs-title">What the agent sees</legend>
    <div className="workflow-agent-input-group">
      <span>About the member</span>
      {box("facts", "Facts about them", "What they shared that the community keeps")}
      {box("progress", "Course progress", "Lessons done and what comes next")}
      {box("guide_channel", "Guide channel", "The last 20 messages")}
    </div>
    {props.forms?.length ? <div className="workflow-agent-input-group"><span>Form answers</span>
      {props.forms.map((form) => box(`form:${form.key}`, form.name))}</div> : null}
    {props.catalog?.properties?.length ? <div className="workflow-agent-input-group"><span>Client properties</span>
      {props.catalog.properties.map((property) => box(`property:${property.key}`, property.name))}</div> : null}
    <div className="workflow-agent-input-group"><span>Your content</span>
      {pickedLessons.map((lessonId) => box(`lesson:${lessonId}`, lessons.find((lesson) => lesson.id === lessonId)?.title ?? "Unavailable lesson"))}
      <select aria-label="Add a lesson the agent reads" value="" disabled={props.disabled || full || !lessons.length}
        onChange={(event) => event.target.value && toggle(`lesson:${event.target.value}`, true)}>
        <option value="">{lessons.length ? "Add a lesson it reads…" : "No published lessons yet"}</option>
        {lessons.filter((lesson) => !pickedLessons.includes(lesson.id)).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.course} · {lesson.title}</option>)}
      </select>
    </div>
    <p className="workflow-field-hint" id={`${props.id}-inputs-help`}>
      The form that started this step is always included. The member can see anything the agent repeats, so only tick what you're happy for them to read.{full ? ` Up to ${WORKFLOW_AGENT_SEES_MAX} inputs.` : ""}
    </p>
    <button type="button" className="workflow-agent-inputs-reset" disabled={props.disabled} onClick={() => props.onChange(undefined)}>Use the default</button>
  </fieldset>;
}

type Props = {
  canAddJoin?: boolean;
  catalog?: WorkflowCatalog;
  /** The steps above this one; a step can follow any of them except a nudge. */
  earlierSteps?: CommunityMemberWorkflowAutomation[];
  forms?: Array<{ key: string; name: string }>;
  automation: WorkflowAutomationDraft;
  index: number;
  expanded: boolean;
  channels: CloudCommunityChannel[];
  channelsUnavailable: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (automation: WorkflowAutomationDraft) => void;
  onRemove: () => void;
  hideHeading?: boolean;
  /** The Automations panel picks trigger and action from its own lists. */
  hideTypeSelects?: boolean;
  creation?: {
    triggerSelected: boolean;
    actionSelected: boolean;
    onTriggerSelected: () => void;
    onActionSelected: () => void;
  };
};

export function WebCommunityWorkflowAutomationEditor(props: Props) {
  const id = useId();
  const { automation } = props;
  const isSequence = automation.trigger.type === "previous_action_completed";
  const earlierSteps = (props.earlierSteps ?? []).filter((step) => !workflowRuleIsNudge(step) && step.action.key !== automation.action.key);
  const stepNames = { forms: props.forms, channels: props.channels, catalog: props.catalog };
  const stepLabel = (step: CommunityMemberWorkflowAutomation) => { const text = workflowActionPhrase(step, stepNames); return text.charAt(0).toUpperCase() + text.slice(1); };
  const predecessorKey = automation.trigger.type === "previous_action_completed" ? automation.trigger.predecessorActionKey : "";
  const waitMinutes = automation.trigger.type === "previous_action_completed" ? automation.trigger.delayMinutes ?? 0 : 0;
  const [waitUnit, setWaitUnit] = useState(waitMinutes && waitMinutes % 1440 === 0 ? 1440 : waitMinutes && waitMinutes % 60 === 0 ? 60 : waitMinutes ? 1 : 1440);
  const setSequence = (key: string, delay: number) => props.onChange({ ...automation,
    trigger: { type: "previous_action_completed", predecessorActionKey: key, ...(delay > 0 ? { delayMinutes: delay } : {}) } });
  const isTimed = automation.trigger.type === "milestone_elapsed";
  const nudge = automation.trigger.type === "milestone_elapsed" && automation.trigger.nudge === true;
  const nudgeFlag = nudge ? { nudge: true } : {};
  const isForm = automation.trigger.type === "form_submitted";
  const isJoin = automation.trigger.type === "member_joined";
  const isLesson = automation.trigger.type === "lesson_completed";
  const isCourse = automation.trigger.type === "course_completed";
  const isTrack = automation.trigger.type === "track_completed";
  const tracks = props.catalog?.tracks ?? [];
  const trackKey = automation.trigger.type === "track_completed" ? automation.trigger.trackKey : undefined;
  const trackName = trackKey ? tracks.find((track) => track.key === trackKey)?.title ?? (props.catalog?.tracks ? "Unavailable track" : "A track") : "Any track";
  const lessons = props.catalog?.lessons ?? [];
  const courses = [...new Map(lessons.map((lesson) => [lesson.courseId, lesson.course])).entries()];
  const lessonId = automation.trigger.type === "lesson_completed" ? automation.trigger.resourceId : undefined;
  const courseId = automation.trigger.type === "course_completed" ? automation.trigger.moduleId : undefined;
  const lessonName = lessonId ? lessons.find((lesson) => lesson.id === lessonId)?.title ?? (props.catalog?.lessons ? "Unavailable lesson" : "A lesson") : "Any lesson";
  const courseName = courseId ? courses.find(([id]) => id === courseId)?.[1] ?? (props.catalog?.lessons ? "Unavailable course" : "A course") : "Any course";
  const propertyKey = automation.action.type === "set_client_property" ? automation.action.propertyKey : "";
  const property = props.catalog?.properties?.find((item) => item.key === propertyKey);
  const delayMinutes = automation.trigger.type === "milestone_elapsed" ? automation.trigger.delayMinutes : 1440;
  const [timeUnit, setTimeUnit] = useState(delayMinutes % 1440 === 0 ? 1440 : delayMinutes % 60 === 0 ? 60 : 1);
  const channelId = automation.trigger.type === "member_contributed" ? automation.trigger.channelId : undefined;
  const durationLabel = `${delayMinutes / timeUnit} ${timeUnit === 1440 ? "day" : timeUnit === 60 ? "hour" : "minute"}${delayMinutes === timeUnit ? "" : "s"}`;
  const isPrompt = automation.action.type === "prompt_agent";
  const issue = workflowAutomationIssue(automation, props.channels, props.channelsUnavailable);
  const isPrivate = props.channels.some((channel) => channel.id === channelId && channel.access_mode === "restricted");
  const triggerSelected = !props.creation || props.creation.triggerSelected;
  const actionSelected = !props.creation || props.creation.actionSelected;
  const triggerIssue = triggerSelected ? workflowTriggerIssue(automation, props.channels, props.channelsUnavailable) : null;
  const triggerReady = triggerSelected && !triggerIssue;
  const triggerLabel = isSequence ? `${waitMinutes ? `${workflowDurationLabel(waitMinutes)} after` : "After"} ${(() => { const step = earlierSteps.find((item) => item.action.key === predecessorKey); return step ? `“${stepLabel(step).slice(0, 60)}”` : "an earlier step"; })()}` : isJoin ? "Member joins for the first time"
    : isLesson ? `Lesson done · ${lessonName}` : isCourse ? `Course finished · ${courseName}` : isTrack ? `Track finished · ${trackName}` : automation.trigger.type === "form_submitted" ? `Form submitted · ${props.forms?.find(form => form.key === (automation.trigger.type === "form_submitted" ? automation.trigger.formKey : ""))?.name ?? "Choose a form"}` : isTimed ? nudge ? `Still here after ${durationLabel} · nudge` : `After ${durationLabel} in this milestone` : `Posts or replies · ${workflowChannelLabel(channelId, props.channels, props.channelsUnavailable)}`;
  const actionLabel = automation.action.type === "set_client_property" ? `Set ${property?.name ?? (propertyKey || "a client property")}`
    : automation.action.type === "create_service_channel" ? "Create private channel" : isPrompt ? "Ask community agent" : automation.action.type === "request_form" ? "Request form" : triggerLabel;

  return (
    <div className="workflow-milestone-automation-row" data-automation-key={automation.key}>
      {!props.hideHeading ? <div className="workflow-automation-heading">
        <button type="button" className="workflow-automation-summary" data-workflow-rule-start aria-expanded={props.expanded}
          aria-controls={props.expanded ? `${id}-fields` : undefined} disabled={props.disabled} onClick={props.onToggle}>
          <span>
            <strong>{triggerLabel}</strong>
            <small>→ {actionLabel}</small>
            {issue ? <small className="workflow-automation-issue">{issue}</small> : null}
          </span>
        </button>
        <button type="button" className="workflow-milestone-remove-automation" aria-label={`Remove action ${props.index + 1}`}
          disabled={props.disabled} onClick={props.onRemove}><X size={16} aria-hidden="true" /></button>
      </div> : null}

      {props.expanded ? (
        <div className="workflow-milestone-automation-fields" id={`${id}-fields`}>
          {!props.hideTypeSelects ? <label>When
            <select value={triggerSelected ? automation.trigger.type : ""} disabled={props.disabled} onChange={event => {
              const next = applyWorkflowTriggerType(automation, event.target.value as WorkflowTriggerType, earlierSteps);
              if (!next) return;
              if (next.trigger.type === "milestone_elapsed") setTimeUnit(1440);
              props.onChange(next);
              props.creation?.onTriggerSelected();
            }}>
              <option value="" disabled>Choose a trigger</option>
              <option value="previous_action_completed" disabled={!earlierSteps.length && !isSequence}>After an earlier step</option>
              <option value="member_contributed">Member posts or replies</option>
              <option value="milestone_elapsed">Time in milestone</option>
              {(props.canAddJoin || isJoin) ? <option value="member_joined">Member joins</option> : null}
              <option value="form_submitted">Form submitted</option>
              <option value="lesson_completed">Lesson done</option>
              <option value="course_completed">Course finished</option>
              <option value="track_completed">Roadmap track finished</option>
            </select>
          </label> : null}
          {triggerSelected ? <>
          {isSequence ? <>
            <label>After this step
              <select value={earlierSteps.some((step) => step.action.key === predecessorKey) ? predecessorKey : ""} disabled={props.disabled}
                onChange={(event) => setSequence(event.target.value, waitMinutes)}>
                <option value="" disabled>{earlierSteps.length ? "Choose an earlier step" : "Add a step above this one first"}</option>
                {earlierSteps.map((step) => <option key={step.action.key} value={step.action.key}>{stepLabel(step)}</option>)}
              </select>
              <small>Starts once that step has finished.</small>
            </label>
            <div className="workflow-automation-field">
              <label htmlFor={`${id}-wait`}>Wait first</label>
              <div className="workflow-action-choice-row">
                <input id={`${id}-wait`} type="number" min={0} max={Math.floor(525600 / waitUnit)} step={1} value={waitMinutes / waitUnit} disabled={props.disabled}
                  onChange={(event) => setSequence(predecessorKey, Math.max(0, Math.round((Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0) * waitUnit)))} />
                <select aria-label="Wait unit" value={waitUnit} disabled={props.disabled} onChange={(event) => {
                  const unit = Number(event.target.value);
                  setWaitUnit(unit);
                  setSequence(predecessorKey, waitMinutes / waitUnit * unit);
                }}><option value={1}>minutes</option><option value={60}>hours</option><option value={1440}>days</option></select>
              </div>
              <small className="workflow-field-hint">{waitMinutes ? `Runs ${workflowDurationLabel(waitMinutes)} after that step finishes.` : "0 starts it straight away."}</small>
            </div>
          </> : isJoin ? null
            : isLesson ? <label>Lesson<select value={lessonId ?? ""} disabled={props.disabled} onChange={e => props.onChange({ ...automation, trigger: { type: "lesson_completed", ...(e.target.value ? { resourceId: e.target.value } : {}) } })}>
                <option value="">Any lesson</option>
                {lessonId && !lessons.some((lesson) => lesson.id === lessonId) ? <option value={lessonId}>{lessonName}</option> : null}
                {courses.map(([id, name]) => <optgroup key={id} label={name || "Lessons"}>{lessons.filter((lesson) => lesson.courseId === id).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</optgroup>)}
              </select><small>Runs once when the member marks this lesson done{lessonId ? "" : " (any published lesson)"}.</small></label>
            : isCourse ? <label>Course<select value={courseId ?? ""} disabled={props.disabled} onChange={e => props.onChange({ ...automation, trigger: { type: "course_completed", ...(e.target.value ? { moduleId: e.target.value } : {}) } })}>
                <option value="">Any course</option>
                {courseId && !courses.some(([id]) => id === courseId) ? <option value={courseId}>{courseName}</option> : null}
                {courses.map(([id, name]) => <option key={id} value={id}>{name || "Untitled course"}</option>)}
              </select><small>Runs once when the member has every lesson in the course done.</small></label>
            : isTrack ? <label>Track<select value={trackKey ?? ""} disabled={props.disabled} onChange={e => props.onChange({ ...automation, trigger: { type: "track_completed", ...(e.target.value ? { trackKey: e.target.value } : {}) } })}>
                <option value="">Any track</option>
                {trackKey && !tracks.some((track) => track.key === trackKey) ? <option value={trackKey}>{trackName}</option> : null}
                {tracks.map((track) => <option key={track.key} value={track.key}>{track.title}</option>)}
              </select><small>Runs once when the member has every step of this Roadmap track done.</small></label>
            : automation.trigger.type === "form_submitted" ? <label>Form<select value={automation.trigger.formKey} disabled={props.disabled} onChange={e => props.onChange({ ...automation, trigger: { type: "form_submitted", formKey: e.target.value } })}><option value="">Choose a published form</option>{props.forms?.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select></label> : isTimed ? <div className="workflow-automation-field">
            <label htmlFor={`${id}-duration`}>After</label>
            <div className="workflow-action-choice-row">
              <input id={`${id}-duration`} type="number" min={1} max={Math.floor(525600 / timeUnit)} step={1}
                value={Number.isFinite(delayMinutes) ? delayMinutes / timeUnit : ""} disabled={props.disabled}
                onChange={event => props.onChange({ ...automation, trigger: { type: "milestone_elapsed", delayMinutes: event.target.valueAsNumber * timeUnit, ...nudgeFlag } })} />
              <select aria-label="Duration unit" value={timeUnit} disabled={props.disabled} onChange={event => {
                const unit = Number(event.target.value);
                setTimeUnit(unit);
                props.onChange({ ...automation, trigger: { type: "milestone_elapsed", delayMinutes: delayMinutes / timeUnit * unit, ...nudgeFlag } });
              }}><option value={1}>minutes</option><option value={60}>hours</option><option value={1440}>days</option></select>
            </div>
            <label className="workflow-nudge-toggle">
              <input type="checkbox" checked={nudge} disabled={props.disabled || !isPrompt}
                onChange={event => props.onChange({ ...automation, trigger: { type: "milestone_elapsed", delayMinutes, ...(event.target.checked ? { nudge: true } : {}) } })} />
              <span>Only a nudge<small>Runs only if they're still in this stage then, and doesn't hold them here: they can move on before it fires.{isPrompt ? "" : " Needs Ask community agent."}</small></span>
            </label>
            <small className="workflow-field-hint">Applies to future milestone entries. Runs once, at or after the due time. Activity does not reset the timer. Duration edits update pending timers.</small>
          </div> : (
          <div className="workflow-automation-field">
            <span>When a member posts or replies in</span>
            <WorkflowChannelPicker channels={props.channels} channelId={channelId}
              unavailable={props.channelsUnavailable} disabled={props.disabled} label={`Channel for automation ${props.index + 1}`}
              onChange={(channelId) => props.onChange({ ...automation, trigger: { type: "member_contributed", ...(channelId ? { channelId } : {}) } })} />
            {channelId !== undefined && issue && issue !== "Add agent instructions" ? <small className="workflow-field-hint" role="status">{issue}. This rule will not be saved as Any channel.</small> : null}
          </div>
          )}

          </> : null}
          {triggerReady && !props.hideTypeSelects ? <label>Then
            <select value={actionSelected ? automation.action.type : ""} disabled={props.disabled} onChange={event => {
              const type = event.target.value;
              if (type !== "create_service_channel" && type !== "prompt_agent" && type !== "request_form" && type !== "set_client_property") return;
              props.onChange(replaceWorkflowDraftAction(automation, type));
              props.creation?.onActionSelected();
            }}>
              <option value="" disabled>Choose an action</option>
              {isJoin ? <option value="create_service_channel">Create private channel</option> : <option value="prompt_agent">Ask community agent</option>}
              {!isForm ? <option value="request_form">Request form</option> : null}
              {!isJoin ? <option value="set_client_property">Set client property</option> : null}
            </select>
          </label> : null}

          {triggerReady && actionSelected ? <>
          {isJoin ? <p className="workflow-field-hint">Applies only to future first-time members. Each join action runs independently; no automatic message or milestone movement.</p> : null}
          {automation.action.type === "set_client_property" ? <>
            <label>Client property<select value={propertyKey} disabled={props.disabled || !props.catalog?.properties}
              onChange={e => props.onChange({ ...automation, action: { key: automation.action.key, type: "set_client_property", propertyKey: e.target.value, value: null } })}>
              <option value="">{props.catalog?.properties ? (props.catalog.properties.length ? "Choose a property" : "No client properties yet") : "Loading properties…"}</option>
              {propertyKey && !property && props.catalog?.properties ? <option value={propertyKey}>{propertyKey} (archived)</option> : null}
              {(props.catalog?.properties ?? []).map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select></label>
            {property && automation.action.type === "set_client_property" ? <PropertyValueField id={`${id}-property-value`} property={property} value={automation.action.value}
              disabled={props.disabled} onChange={(value) => props.onChange({ ...automation, action: { key: automation.action.key, type: "set_client_property", propertyKey, value } })} /> : null}
            <p className="workflow-field-hint">Writes this value on the member's client record. You'll see it in the client's timeline as set by Workflow.</p>
          </> : automation.action.type === "create_service_channel" ? <p className="workflow-field-hint">Creates a private service channel for the member, community managers, and community agent.</p> : automation.action.type === "request_form" ? <label>Form<select value={automation.action.formKey} disabled={props.disabled} onChange={e => props.onChange({ ...automation, action: { key: automation.action.key, type: "request_form", formKey: e.target.value } })}><option value="">Choose a published form</option>{props.forms?.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select><small>Shown privately in the member’s community sidebar. No channel is required. One request per rule and milestone visit.</small></label> : automation.action.type === "prompt_agent" ? (
            <>
              <label>
                <span id={`${id}-prompt-label`}>Agent instructions</span>
                <textarea rows={4} maxLength={COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH} value={automation.action.prompt}
                  disabled={props.disabled} aria-labelledby={`${id}-prompt-label`} aria-describedby={`${id}-prompt-help`}
                  placeholder="What should the community agent do for this member?"
                  onChange={(event) => props.onChange({ ...automation, action: { ...(automation.action as Extract<typeof automation.action, { type: "prompt_agent" }>), prompt: event.target.value } })} />
              </label>
              <p className="workflow-field-hint" id={`${id}-prompt-help`}>
                {automation.action.prompt.trim() ? "" : "Add instructions to save. "}
                {isForm ? "Uses the submitted answers and responds once in the member’s assigned private service channel. Only the member and community managers may have access. Submission stays saved if delivery is unavailable."
                  : isSequence ? "Starts after the preceding action completes and responds in the member’s assigned private service channel. The next action waits until this response is delivered. No additional tool actions."
                  : isLesson || isCourse ? "Starts once when they finish it and replies in the member’s private guide channel."
                  : isTimed ? "Delivered once to the member’s assigned service channel. Uses these instructions and community context, without private dossier data or additional tool actions. No delivery if the channel is unavailable."
                  : "The community agent uses this member’s community context and replies in the triggering thread."}
                {!isSequence && !isTimed && !isForm && !isLesson && !isCourse && (isPrivate || channelId === undefined) ? " In private channels, the agent must be invited." : ""}
              </p>
              <AgentInputsField id={id} sees={automation.action.sees} catalog={props.catalog} forms={props.forms} disabled={props.disabled}
                onChange={(sees) => {
                  const { sees: _previous, ...rest } = automation.action as Extract<typeof automation.action, { type: "prompt_agent" }>;
                  props.onChange({ ...automation, action: sees ? { ...rest, sees } : rest });
                }} />
            </>
          ) : null}
          <ConditionField id={id} condition={automation.condition} properties={props.catalog?.properties} disabled={props.disabled}
            onChange={(condition) => { const { condition: _previous, ...rest } = automation; props.onChange(condition ? { ...rest, condition } : rest); }} />
          </> : null}
          {props.hideHeading && (triggerIssue || (actionSelected && issue)) ? <p role="status" className="workflow-automation-issue">{triggerIssue || issue}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
