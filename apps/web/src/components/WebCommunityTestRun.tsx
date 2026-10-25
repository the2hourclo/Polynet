import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "../auth";
import {
  endCloudCommunityTestMember,
  listCloudCommunityTestMembers,
  startCloudCommunityTestMember,
  subscribeCloudCommunityClientTimeline,
  type CloudCommunityClientTimelineEntry,
  type CloudCommunityTestMember,
} from "../../../../shared/cloudCommunityTestMembersGateway";
import { buildTestMemberRunUrl } from "../../../../shared/testMemberRun";
import "./WebCommunityTestRun.css";

export type WebCommunityTestRunContext = {
  communityId: string;
  communitySlug: string;
  session: AuthSession;
  ensureSession: (session?: AuthSession | null, source?: string) => Promise<AuthSession | null>;
};

type Props = WebCommunityTestRunContext & {
  /** Opens the member panel in Workflows (stage, forms, Run again). */
  onOpenRecord: (membershipId: string) => void;
};

function testRunErrorMessage(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  if (message.includes("test_member_limit_reached")) return "You have 5 test runs going. End one to start another.";
  if (message.includes("community_forbidden")) return "Only the community's owner and admins can run tests.";
  return "Something went wrong. Nothing was changed.";
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** Opens the community as the test member, in a tab of its own. */
function openTestTab(tab: Window | null, slug: string, member: { auth_subject: string; label: string }) {
  const url = buildTestMemberRunUrl(slug, { authSubject: member.auth_subject, label: member.label });
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, "_blank");
}

// Workflows → Test run: the owner goes through their own community as a brand
// new member, sees what happens on that member's record, then ends the run.
export function WebCommunityTestRun(props: Props) {
  const [members, setMembers] = useState<CloudCommunityTestMember[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
        setSelected((current) => result.test_members.some((row) => row.id === current) ? current
          : result.test_members.find((row) => row.mine)?.id ?? null);
      } catch { if (alive) setLoadError(true); }
    })();
    return () => { alive = false; };
  }, [communityId, session, ensureSession, reload]);

  const run = useCallback(async (key: string, work: (ready: AuthSession) => Promise<void>) => {
    setBusy(key); setError(null);
    try {
      const ready = await ensureSession(session, "community_test_run");
      if (!ready) throw new Error("session_unavailable");
      await work(ready);
      setReload((n) => n + 1);
    } catch (caught) { setError(testRunErrorMessage(caught)); }
    finally { setBusy(null); }
  }, [ensureSession, session]);

  const start = (replacing?: CloudCommunityTestMember) => {
    // Opened now, while the click still counts, so the browser doesn't block it.
    const tab = window.open("about:blank", "_blank");
    void run(replacing ? `restart:${replacing.id}` : "start", async (ready) => {
      try {
        if (replacing) await endCloudCommunityTestMember(ready, communityId, replacing.id);
        const started = await startCloudCommunityTestMember(ready, communityId);
        setSelected(started.id);
        openTestTab(tab, props.communitySlug, started);
      } catch (caught) { tab?.close(); throw caught; }
    });
  };
  const end = (member: CloudCommunityTestMember) => {
    if (!window.confirm(`End ${member.label}? Their answers, progress and record are deleted.`)) return;
    void run(`end:${member.id}`, (ready) => endCloudCommunityTestMember(ready, communityId, member.id));
  };

  const mine = (members ?? []).filter((row) => row.mine);
  const others = (members ?? []).filter((row) => !row.mine);
  const current = mine.find((row) => row.id === selected) ?? null;
  return <div className="test-run">
    <header className="test-run-header">
      <h1>Test run</h1>
      <p>Go through your community as a brand-new member. A test member joins like anyone else: your Member joins rules run,
        the welcome page holds them, their form answers fill their client record and their lessons count. You watch it all happen here.</p>
      <p>It opens in a new tab. Your other tabs stay signed in as you. A test member is tagged Test on Clients, can't pay,
        message anyone or use agents, and ending it deletes everything it did.</p>
    </header>
    <div className="test-run-actions">
      <button type="button" className="platform-save-button" disabled={busy !== null || members === null} onClick={() => start()}>
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
              <strong>{member.label}</strong><small>Started {new Date(member.created_at).toLocaleString()}</small>
            </button>
            <div className="test-run-member-actions">
              <button type="button" disabled={busy !== null || !member.auth_subject}
                onClick={() => member.auth_subject && openTestTab(null, props.communitySlug, { auth_subject: member.auth_subject, label: member.label })}>
                <ExternalLink size={14} aria-hidden="true" /> Open as {member.label}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => start(member)}>
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
    {current?.membership_id ? <TestRunTimeline key={current.id} {...props} member={current} membershipId={current.membership_id} /> : null}
  </div>;
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
      <h2 id="test-run-timeline-title">What happened for {props.member.label}</h2>
      <button type="button" className="test-run-link" onClick={() => props.onOpenRecord(props.membershipId)}>Open their member panel</button>
    </div>
    <p className="test-run-help">Updates live as you click through the other tab: joining, forms, lessons and every Workflow action.</p>
    {failed ? <div role="alert"><p>This record could not be loaded.</p><button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
      : entries === null ? <p role="status">Loading…</p>
      : <ol className="test-run-entries" aria-live="polite">
        {entries.map((entry, index) => <li key={`${entry.at}:${entry.type}:${index}`} data-type={entry.type}>
          <time dateTime={entry.at}>{timeOf(entry.at)}</time><span>{entry.summary}</span>
        </li>)}
      </ol>}
  </section>;
}
