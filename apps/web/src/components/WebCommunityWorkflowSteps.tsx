import { Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { CommunityMemberWorkflowMilestone } from "../../../../shared/communityMemberWorkflow";
import { workflowStepLines, type WorkflowStepNames } from "./workflowStepSentences";

type Props = {
  milestones: CommunityMemberWorkflowMilestone[];
  memberCounts: Map<string, number>;
  names: WorkflowStepNames;
  disabled: boolean;
  onEditStage: (milestoneKey: string) => void;
  onEditStep: (milestoneKey: string, automationKey: string) => void;
  onAddStep: (milestoneKey: string) => void;
  /** Absent when Test run isn't available here. */
  onTestStage?: (milestoneKey: string, index: number) => void;
};

function advanceSentence(milestone: CommunityMemberWorkflowMilestone, next: CommunityMemberWorkflowMilestone | undefined): string {
  if (!milestone.automations.length) return milestone.requireHumanApproval ? "They move on when you approve them." : "Add a step so members can move on.";
  const where = next?.name.trim() ? `to ${next.name.trim()}` : next ? "to the next stage" : "out of the workflow";
  if (milestone.requireHumanApproval) return `When every step is done, you approve them and they move ${where}.`;
  return milestone.goal?.trim()
    ? `When every step is done and the agent agrees the goal is met, they move ${where}.`
    : `When every step is done, they move ${where}.`;
}

// Workflows → Steps: every stage top to bottom, each rule as one plain sentence.
export function WebCommunityWorkflowSteps(props: Props) {
  return <ol className="pn-wf-steps" aria-label="Workflow steps">
    {props.milestones.map((milestone, index) => {
      const lines = workflowStepLines(milestone.automations, props.names);
      const count = props.memberCounts.get(milestone.key) ?? 0;
      const name = milestone.name.trim() || `Stage ${index + 1}`;
      return <li key={milestone.key || `stage-${index}`} className="pn-wf-stage">
        <header className="pn-wf-stage-head">
          <div className="pn-wf-stage-title">
            <span className="pn-wf-stage-eyebrow">Stage {index + 1}<span aria-hidden="true"> · </span>{count === 1 ? "1 member here" : `${count} members here`}</span>
            <h2>{name}</h2>
            {milestone.goal?.trim() ? <p>Goal: {milestone.goal.trim()}</p> : null}
          </div>
          <div className="pn-wf-stage-actions">
            {props.onTestStage && milestone.key ? <button type="button" className="pn-wf-link" disabled={props.disabled}
              onClick={() => props.onTestStage?.(milestone.key, index)} aria-label={`Test the ${name} stage as a test member`}>Test this stage</button> : null}
            <button type="button" className="pn-wf-link" disabled={props.disabled}
              onClick={() => props.onEditStage(milestone.key)} aria-label={`Edit the ${name} stage`}>Edit</button>
          </div>
        </header>
        {lines.length ? <ol className="pn-wf-step-list">
          {lines.map((line) => <li key={line.automation.key || line.automation.action.key} style={{ "--pn-wf-depth": line.depth } as CSSProperties}
            className={line.depth ? "pn-wf-step is-after" : "pn-wf-step"}>
            <button type="button" disabled={props.disabled || !milestone.key}
              onClick={() => props.onEditStep(milestone.key, line.automation.key)}>
              <span className="pn-wf-step-lead">{line.lead}</span>
              {line.rest}
            </button>
          </li>)}
        </ol> : <p className="pn-wf-stage-empty">No steps yet.</p>}
        {milestone.key ? <button type="button" className="pn-wf-add-step" disabled={props.disabled}
          onClick={() => props.onAddStep(milestone.key)}><Plus size={14} strokeWidth={2} aria-hidden="true" /> Add a step</button> : null}
        <p className="pn-wf-stage-advance">{advanceSentence(milestone, props.milestones[index + 1])}</p>
      </li>;
    })}
  </ol>;
}
