import { ExternalLink, FastForward, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { AuthSession } from "../auth";
import {
  endCloudCommunityTestMember,
  listCloudCommunityTestMembers,
  runCloudTestMemberTimedStepsNow,
  startCloudCommunityTestMember,
  subscribeCloudCommunityClientTimeline,
  subscribeCloudTestRunSequence,
  type CloudCommunityClientTimelineEntry,
  type CloudCommunityTestMember,
  type CloudTestRunSequence,
  type CloudTestRunStep,
} from "../../../../shared/cloudCommunityTestMembersGateway";
import { buildTestMemberRunUrl } from "../../../../shared/testMemberRun";
import "./WebCommunityTestRun.css";

export type WebCommunityTestRunContext = {
  communityId: string;
  communitySlug: string;
  session: AuthSession;
  ensureSession: (session?: AuthSession | null, source?: string) => Promise<AuthSession | null>;
};

type Stage = { key: string; name: string };

type Props = WebCommunityTestRunContext & {
  /** The Workflow's stages, in order; a run can start in any of them. */
  stages: Stage[];
  /** Opens the member panel in Workflows (stage, forms, Run again). */
  onOpenRecord: (membershipId: string) => void;
};

export function testRunErrorMessage(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  if (message.includes("test_member_limit_reached")) return "You have 5 test runs going. End one to start another.";
  if (message.includes("test_member_stage_not_found")) return "That stage no longer exists. Reload Workflows and try again.";
  if (message.includes("community_forbidden")) return "Only the community's owner and admins can run tests.";
  return "Something went wrong. Nothing was changed.";
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Opens the community as the test member, in a tab of its own. */
function openTestTab(tab: Window | null, slug: string, member: { auth_subject: string; label: string }) {
  const url = buildTestMemberRunUrl(slug, { authSubject: member.auth_subject, label: member.label });
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, "_blank");
}

/**
 * Starts a test member (at a stage, or joining at the first) and opens the
 * community as it. Call it straight from a click: the tab opens before the
 * server answers, so the browser doesn't block it.
 */
export async function startTestRunInNewTab(context: WebCommunityTestRunContext, milestoneKey?: string | null, replacingId?: string) {
  const tab = window.open("about:blank", "_blank");
  try {
    const ready = await context.ensureSession(context.session, "community_test_run_start");
    if (!ready) throw new Error("session_unavailable");
    if (replacingId) await endCloudCommunityTestMember(ready, context.communityId, replacingId);
    const started = await startCloudCommunityTestMember(ready, context.communityId, milestoneKey);
    openTestTab(tab, context.communitySlug, started);
    return started;
  } catch (caught) { tab?.close(); throw caught; }
}

// Workflows → Test run: the owner goes through their own community as a brand
// new member (or from any stage), reviews each step of the sequence as it
// fires, skips timed waits, then ends the run.
export function WebCommunityTestRun(props: Props) {
  const stageFieldId = useId();
  const [members, setMembers] = useState<CloudCommunityTestMember[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [startStage, setStartStage] = useState("");
  const [reload, setReload] = useState(0);
  const { communityId, session, ensureSession } = props;

  useEffect(() => {
    let alive = true; setLoadError(false);
    void (async () => {
      try {
        const ready = await ensureSession(session, "community_test_run_list");
        if (!ready) throw new Error("session_unavailable");
        const result = await listCloudCommunityTestMembers(ready, communityId);
        if (!alive) return;
        setMembers(result.test_members);
        setSelected((current) => result.test_members.some((row) => row.id === current && row.mine) ? current
          : result.test_members.find((row) => row.mine)?.id ?? null);
      } catch { if (alive) setLoadError(true); }
    })();
    return () => { alive = false; };
  }, [communityId, session, ensureSession, reload]);

  const run = useCallback(async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await work(); setReload((n) => n + 1); }
    catch (caught) { setError(testRunErrorMessage(caught)); }
    finally { setBusy(null); }
  }, []);

  const start = (milestoneKey: string, replacing?: CloudCommunityTestMember) => {
    const pending = startTestRunInNewTab(props, milestoneKey || null, replacing?.id);
    void run(replacing ? `restart:${replacing.id}` : "start", async () => { setSelected((await pending).id); });
  };
  const end = (member: CloudCommunityTestMember) => {
    if (!window.confirm(`End ${member.label}? Their answers, progress and record are deleted.`)) return;
    void run(`end:${member.id}`, async () => {
      const ready = await ensureSession(session, "community_test_run_end");
      if (!ready) throw new Error("session_unavailable");
      await endCloudCommunityTestMember(ready, communityId, member.id);
    });
  };

  const stageName = (key: string | null) => props.stages.find((stage) => stage.key === key)?.name ?? null;
  const mine = (members ?? []).filter((row) => row.mine);
  const others = (members ?? []).filter((row) => !row.mine);
  const current = mine.find((row) => row.id === selected) ?? null;
  return <div className="test-run">
    <header className="test-run-header">
      <h1>Test run</h1>
      <p>Go through your community as a brand-new member and review your welcome sequence step by step. A test member joins like
        anyone else: your Member joins rules run, the welcome page holds them, their form answers fill their client record and
        their lessons count. Below, you see every rule of the Workflow fire in order, and you can skip timed waits.</p>
      <p>The community opens in a new tab. Your other tabs stay signed in as you. A test member is tagged Test on Clients and
        can't pay, message anyone or chat with the agent. Agent messages a Workflow sends do run and use your agent credits.
        Ending a run deletes everything it did.</p>
    </header>
    <div className="test-run-actions">
      {props.stages.length > 1 ? <div className="test-run-field">
        <label htmlFor={stageFieldId}>Start</label>
        <select id={stageFieldId} value={startStage} onChange={(event) => setStartStage(event.target.value)} disabled={busy !== null}>
          <option value="">As a new member (welcome sequence)</option>
          {props.stages.slice(1).map((stage, index) => <option key={stage.key} value={stage.key}>In stage {index + 2}: {stage.name}</option>)}
        </select>
      </div> : null}
      <button type="button" className="platform-save-button" disabled={busy !== null || members === null} onClick={() => start(startStage)}>
        {busy === "start" ? "Starting…" : "Start a test run"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
    {loadError ? <div role="alert" className="test-run-empty"><p>Your test runs could not be loaded.</p>
      <button type="button" onClick={() => setReload((n) => n + 1)}>Retry</button></div>
      : members === null ? <p role="status" className="test-run-empty">Loading…</p>
      : !mine.length ? <p className="test-run-empty">No test runs yet. Start one to see your welcome page and first steps as a new member would.</p>
      : <section className="test-run-members" aria-label="Your test runs">
        <ul>
          {mine.map((member) => <li key={member.id} className={member.id === selected ? "is-selected" : undefined}>
            <button type="button" className="test-run-member-name" aria-pressed={member.id === selected} onClick={() => setSelected(member.id)}>
              <strong>{member.label}</strong>
              <small>Started {new Date(member.created_at).toLocaleString()}{stageName(member.start_milestone_key) ? ` in ${stageName(member.start_milestone_key)}` : ""}</small>
            </button>
            <div className="test-run-member-actions">
              <button type="button" disabled={busy !== null || !member.auth_subject}
                onClick={() => member.auth_subject && openTestTab(null, props.communitySlug, { auth_subject: member.auth_subject, label: member.label })}>
                <ExternalLink size={14} aria-hidden="true" /> Open as {member.label}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => start(member.start_milestone_key ?? "", member)}>
                <RefreshCw size={14} aria-hidden="true" /> {busy === `restart:${member.id}` ? "Starting over…" : "Start over"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => end(member)}>
                {busy === `end:${member.id}` ? "Ending…" : "End"}
              </button>
            </div>
          </li>)}
        </ul>
      </section>}
    {others.length ? <p className="test-run-help">{others.length === 1 ? "1 test run belongs" : `${others.length} test runs belong`} to another admin.</p> : null}
    {current ? <TestRunSequence key={`sequence:${current.id}`} {...props} member={current} /> : null}
    {current?.membership_id ? <TestRunTimeline key={`timeline:${current.id}`} {...props} member={current} membershipId={current.membership_id} /> : null}
  </div>;
}

const STATUS_LABEL: Record<CloudTestRunStep["status"], string> = {
  done: "Done", failed: "Failed", running: "Running", scheduled: "Timed", waiting: "Waiting", skipped: "Didn't run", not_reached: "Not reached",
};

function TestRunSequence(props: Props & { member: CloudCommunityTestMember }) {
  const [sequence, setSequence] = useState<CloudTestRunSequence | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFailed(false);
    return subscribeCloudTestRunSequence({
      session: props.session, ensureSession: props.ensureSession, communityId: props.communityId, testMemberId: props.member.id,
      update: (next) => { setSequence(next); setFailed(false); }, error: () => setFailed(true),
    });
  }, [props.session, props.ensureSession, props.communityId, props.member.id, retry]);
  const skip = async (automationKey?: string) => {
    setBusy(automationKey ?? "all"); setError(null);
    try {
      const ready = await props.ensureSession(props.session, "community_test_run_skip_wait");
      if (!ready) throw new Error("session_unavailable");
      await runCloudTestMemberTimedStepsNow(ready, props.communityId, props.member.id, automationKey);
    } catch (caught) { setError(testRunErrorMessage(caught)); }
    finally { setBusy(null); }
  };
  const timed = sequence?.stages.find((stage) => stage.is_current)?.steps.filter((step) => step.status === "scheduled") ?? [];
  return <section className="test-run-sequence" aria-labelledby="test-run-sequence-title">
    <div className="test-run-timeline-head">
      <h2 id="test-run-sequence-title">{props.member.label}'s sequence</h2>
      {timed.length > 1 ? <button type="button" className="test-run-link" disabled={busy !== null} onClick={() => void skip()}>
        {busy === "all" ? "Running…" : `Skip all ${timed.length} waits`}</button> : null}
    </div>
    <p className="test-run-help">Each stage's rules in order. Updates live as the test member moves through the other tab.</p>
    {error ? <p role="alert" className="test-run-error">{error}</p> : null}
    {failed ? <div role="alert"><p>The sequence could not be loaded.</p><button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
      : sequence === null ? <p role="status">Loading…</p>
      : !sequence.stages.length ? <p className="test-run-help">This community has no Workflow stages yet.</p>
      : <ol className="test-run-stages" aria-live="polite">
        {sequence.stages.map((stage, index) => <li key={stage.key} className={stage.is_current ? "is-current" : stage.reached ? "is-reached" : undefined}>
          <h3><span>{index + 1}</span>{stage.name}{stage.is_current ? <em>Here now{stage.entered_at ? ` since ${timeOf(stage.entered_at)}` : ""}</em> : null}</h3>
          {stage.steps.length ? <ol className="test-run-steps">
            {stage.steps.map((step) => <li key={step.key} data-status={step.status}>
              <span className="test-run-step-status">{STATUS_LABEL[step.status]}</span>
              <span className="test-run-step-text">
                <strong>{step.does}</strong>
                <small>{step.when}
                  {step.status === "done" || step.status === "failed" ? ` · ${timeOf(step.at)}` : ""}
                  {step.status === "scheduled" ? ` · due ${timeOf(step.due_at)}` : ""}
                  {step.error ? ` · ${step.error}` : ""}</small>
              </span>
              {step.status === "scheduled" ? <button type="button" disabled={busy !== null} onClick={() => void skip(step.key)}>
                <FastForward size={14} aria-hidden="true" /> {busy === step.key ? "Running…" : "Run now"}
              </button> : null}
            </li>)}
          </ol> : <p className="test-run-help">No rules in this stage.</p>}
        </li>)}
        {sequence.completed_at ? <li className="is-reached"><h3>Finished the Workflow · {timeOf(sequence.completed_at)}</h3></li> : null}
      </ol>}
  </section>;
}

function TestRunTimeline(props: Props & { member: CloudCommunityTestMember; membershipId: string }) {
  const [entries, setEntries] = useState<CloudCommunityClientTimelineEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setFailed(false);
    return subscribeCloudCommunityClientTimeline({
      session: props.session, ensureSession: props.ensureSession, communityId: props.communityId, membershipId: props.membershipId,
      update: (rows) => { setEntries(rows); setFailed(false); }, error: () => setFailed(true),
    });
  }, [props.session, props.ensureSession, props.communityId, props.membershipId, retry]);
  return <section className="test-run-timeline" aria-labelledby="test-run-timeline-title">
    <div className="test-run-timeline-head">
      <h2 id="test-run-timeline-title">Everything on {props.member.label}'s record</h2>
      <button type="button" className="test-run-link" onClick={() => props.onOpenRecord(props.membershipId)}>Open their member panel</button>
    </div>
    <p className="test-run-help">Newest first: joining, forms, lessons, client fields and every Workflow action.</p>
    {failed ? <div role="alert"><p>This record could not be loaded.</p><button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
      : entries === null ? <p role="status">Loading…</p>
      : <ol className="test-run-entries">
        {entries.map((entry, index) => <li key={`${entry.at}:${entry.type}:${index}`} data-type={entry.type}>
          <time dateTime={entry.at}>{timeOf(entry.at)}</time><span>{entry.summary}</span>
        </li>)}
      </ol>}
  </section>;
}
