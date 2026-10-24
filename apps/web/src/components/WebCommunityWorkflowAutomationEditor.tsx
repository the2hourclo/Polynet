import { X } from "lucide-react";
import { useId, useState } from "react";
import type { CloudCommunityChannel } from "../../../../shared/cloudCommunityChannelsGateway";
import { COMMUNITY_MEMBER_WORKFLOW_PROMPT_MAX_LENGTH } from "../../../../shared/communityMemberWorkflow";
import { WorkflowChannelPicker } from "./WorkflowChannelPicker";
import { replaceWorkflowDraftAction, workflowAutomationIssue, workflowTriggerIssue, workflowChannelLabel, type WorkflowAutomationDraft } from "./workflowMilestoneDraft";

/** Lessons, courses and client properties a rule can name, loaded with the board. */
type WorkflowCatalogProperty = { key: string; name: string; type: string; options: string[] };
export type WorkflowCatalog = {
  lessons: Array<{ id: string; title: string; course: string; courseId: string }> | null;
  properties: WorkflowCatalogProperty[] | null;
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

type Props = {
  canAddJoin?: boolean;
  catalog?: WorkflowCatalog;
  previousAction?: WorkflowAutomationDraft;
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
  const previousLabel = props.previousAction?.action.type === "request_form"
    ? `Request ${props.forms?.find(f => props.previousAction?.action.type === "request_form" && f.key === props.previousAction.action.formKey)?.name ?? "form"}`
    : props.previousAction?.action.type === "prompt_agent" ? `Ask agent: ${props.previousAction.action.prompt.slice(0, 80)}` : "Create private channel";
  const isTimed = automation.trigger.type === "milestone_elapsed";
  const isForm = automation.trigger.type === "form_submitted";
  const isJoin = automation.trigger.type === "member_joined";
  const isLesson = automation.trigger.type === "lesson_completed";
  const isCourse = automation.trigger.type === "course_completed";
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
  const triggerLabel = isSequence ? "Previous action completed" : isJoin ? "Member joins for the first time"
    : isLesson ? `Lesson done · ${lessonName}` : isCourse ? `Course finished · ${courseName}` : automation.trigger.type === "form_submitted" ? `Form submitted · ${props.forms?.find(form => form.key === (automation.trigger.type === "form_submitted" ? automation.trigger.formKey : ""))?.name ?? "Choose a form"}` : isTimed ? `After ${durationLabel} in this milestone` : `Posts or replies · ${workflowChannelLabel(channelId, props.channels, props.channelsUnavailable)}`;
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
          <label>When
            <select value={triggerSelected ? automation.trigger.type : ""} disabled={props.disabled} onChange={event => {
              const type = event.target.value;
              if (type === "member_joined") {
                props.onChange({ ...replaceWorkflowDraftAction(automation, automation.action.type === "request_form" ? "request_form" : "create_service_channel"), trigger: { type } });
              } else if (type === "previous_action_completed" && props.previousAction) {
                props.onChange({ ...replaceWorkflowDraftAction(automation, automation.action.type === "request_form" ? "request_form" : "prompt_agent"), trigger: { type, predecessorActionKey: props.previousAction.action.key } });
              } else if (type === "form_submitted") {
                props.onChange({ ...replaceWorkflowDraftAction(automation, automation.action.type === "set_client_property" ? "set_client_property" : "prompt_agent"), trigger: { type, formKey: "" } });
              } else if (type === "lesson_completed" || type === "course_completed") {
                props.onChange({ ...replaceWorkflowDraftAction(automation, automation.action.type === "set_client_property" ? "set_client_property" : "request_form"), trigger: { type } });
              } else if (type === "member_contributed" || type === "milestone_elapsed") {
                setTimeUnit(1440);
                const action = automation.action.type === "request_form" ? "request_form" : "prompt_agent";
                props.onChange({ ...replaceWorkflowDraftAction(automation, action), trigger: type === "member_contributed" ? { type } : { type, delayMinutes: 1440 } });
              } else return;
              props.creation?.onTriggerSelected();
            }}>
              <option value="" disabled>Choose a trigger</option>
              <option value="previous_action_completed" disabled={!props.previousAction}>Previous action completed</option>
              <option value="member_contributed">Member posts or replies</option>
              <option value="milestone_elapsed">Time in milestone</option>
              {(props.canAddJoin || isJoin) ? <option value="member_joined">Member joins</option> : null}
              <option value="form_submitted">Form submitted</option>
              <option value="lesson_completed">Lesson done</option>
              <option value="course_completed">Course finished</option>
            </select>
          </label>
          {triggerSelected ? <>
          {isSequence ? <div className="workflow-field-hint">{props.previousAction && automation.trigger.type === "previous_action_completed" && automation.trigger.predecessorActionKey === props.previousAction.action.key
            ? `After: ${previousLabel}. Starts after verified completion.`
            : <>The preceding action changed. Choose a different trigger, then select Previous action completed again to reconnect.</>}</div> : isJoin ? null
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
            : automation.trigger.type === "form_submitted" ? <label>Form<select value={automation.trigger.formKey} disabled={props.disabled} onChange={e => props.onChange({ ...automation, trigger: { type: "form_submitted", formKey: e.target.value } })}><option value="">Choose a published form</option>{props.forms?.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select></label> : isTimed ? <div className="workflow-automation-field">
            <label htmlFor={`${id}-duration`}>After</label>
            <div className="workflow-action-choice-row">
              <input id={`${id}-duration`} type="number" min={1} max={Math.floor(525600 / timeUnit)} step={1}
                value={Number.isFinite(delayMinutes) ? delayMinutes / timeUnit : ""} disabled={props.disabled}
                onChange={event => props.onChange({ ...automation, trigger: { type: "milestone_elapsed", delayMinutes: event.target.valueAsNumber * timeUnit } })} />
              <select aria-label="Duration unit" value={timeUnit} disabled={props.disabled} onChange={event => {
                const unit = Number(event.target.value);
                setTimeUnit(unit);
                props.onChange({ ...automation, trigger: { type: "milestone_elapsed", delayMinutes: delayMinutes / timeUnit * unit } });
              }}><option value={1}>minutes</option><option value={60}>hours</option><option value={1440}>days</option></select>
            </div>
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
          {triggerReady ? <label>Then
            <select value={actionSelected ? automation.action.type : ""} disabled={props.disabled} onChange={event => {
              const type = event.target.value;
              if (type !== "create_service_channel" && type !== "prompt_agent" && type !== "request_form" && type !== "set_client_property") return;
              props.onChange(replaceWorkflowDraftAction(automation, type));
              props.creation?.onActionSelected();
            }}>
              <option value="" disabled>Choose an action</option>
              {isJoin ? <option value="create_service_channel">Create private channel</option> : !isLesson && !isCourse ? <option value="prompt_agent">Ask community agent</option> : null}
              {!isForm ? <option value="request_form">Request form</option> : null}
              {!isJoin && !isSequence ? <option value="set_client_property">Set client property</option> : null}
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
                  onChange={(event) => props.onChange({ ...automation, action: { key: automation.action.key, type: "prompt_agent", prompt: event.target.value } })} />
              </label>
              <p className="workflow-field-hint" id={`${id}-prompt-help`}>
                {automation.action.prompt.trim() ? "" : "Add instructions to save. "}
                {isForm ? "Uses the submitted answers and responds once in the member’s assigned private service channel. Only the member and community managers may have access. Submission stays saved if delivery is unavailable."
                  : isSequence ? "Starts after the preceding action completes and responds in the member’s assigned private service channel. The next action waits until this response is delivered. No additional tool actions."
                  : isTimed ? "Delivered once to the member’s assigned service channel. Uses these instructions and community context, without private dossier data or additional tool actions. No delivery if the channel is unavailable."
                  : "The community agent uses this member’s community context and replies in the triggering thread."}
                {!isSequence && !isTimed && !isForm && (isPrivate || channelId === undefined) ? " In private channels, the agent must be invited." : ""}
              </p>
            </>
          ) : null}
          </> : null}
          {props.hideHeading && (triggerIssue || (actionSelected && issue)) ? <p role="status" className="workflow-automation-issue">{triggerIssue || issue}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
