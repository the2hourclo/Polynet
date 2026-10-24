import { useEffect, useRef, useState } from "react";
import type { AuthSession } from "../auth";
import { subscribeMemberForms, type MemberFormSummary } from "../../../../shared/cloudCommunityFormRequestsGateway";
import { MemberFormRunner } from "./WebCommunityNextStep";
import "./WebCommunityNextStep.css";

type Props = {
  communityId: string;
  communityName: string;
  /** The welcome forms the server says this member still owes. */
  requestIds: string[];
  session: AuthSession;
  ensureSession: (session: AuthSession, source?: string) => Promise<AuthSession | null>;
  /** Called once no welcome form is left, so the shell reloads access and opens the community. */
  onFinished: () => void;
  /** Called when the page closes after the member finished, so lists read while held load again. */
  onReleased: () => void;
};

// The builder's welcome flow: the member sees only these forms until they are
// submitted. The server enforces the hold; this page is how the member gets through it.
export function WebCommunityWelcome(props: Props) {
  const [rows, setRows] = useState<MemberFormSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [runner, setRunner] = useState(0);
  // No ids yet: the member just joined and the join rule is still creating their forms.
  const preparing = props.requestIds.length === 0;
  const total = useRef(props.requestIds.length);
  if (props.requestIds.length > total.current) total.current = props.requestIds.length;
  // The forms list can briefly read empty while its subscription settles, so
  // every change to "nothing left" reloads access, not just the first.
  const wasEmpty = useRef(false);
  const onReleased = useRef(props.onReleased);
  onReleased.current = props.onReleased;
  const onFinished = useRef(props.onFinished);
  onFinished.current = props.onFinished;
  useEffect(() => () => { if (wasEmpty.current) onReleased.current(); }, []);
  useEffect(() => {
    let alive = true; setError(false); setRows(null);
    const stop = subscribeMemberForms(props.session, props.communityId, props.ensureSession,
      (r) => { if (alive) setRows(preparing ? r : r.filter((row) => props.requestIds.includes(row.id))); },
      () => { if (alive) setError(true); });
    return () => { alive = false; stop(); };
  }, [props.session, props.communityId, props.ensureSession, props.requestIds, preparing, retry]);
  // While preparing, ask again for access as forms arrive, and every few seconds
  // in case the join rule never runs and the hold lapses.
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => onFinished.current(), 2_000);
    return () => clearInterval(timer);
  }, [preparing]);
  useEffect(() => { if (preparing && rows?.length) onFinished.current(); }, [preparing, rows]);
  const next = preparing ? undefined : rows?.[0];
  useEffect(() => {
    if (preparing) return;
    const empty = rows?.length === 0;
    if (empty && !wasEmpty.current) onFinished.current();
    wasEmpty.current = empty;
  }, [rows, preparing]);
  const step = total.current - (rows?.length ?? total.current) + 1;
  return <section className="community-welcome" aria-label={`Welcome to ${props.communityName}`}>
    <div className="community-welcome-intro">
      <small>Welcome</small>
      <h1>Welcome to {props.communityName}</h1>
      <p>Finish {total.current > 1 ? "these steps" : "this step"} to open the community.</p>
      {total.current > 1 && next ? <p className="community-welcome-step">Step {Math.min(step, total.current)} of {total.current}</p> : null}
    </div>
    <div className="member-form-dialog community-welcome-form">
      {next ? <MemberFormRunner key={`${next.id}:${runner}`} communityId={props.communityId} session={props.session} ensureSession={props.ensureSession}
        requestId={next.id} onClose={() => setRunner((n) => n + 1)} />
        : error ? <div role="alert"><p>Your welcome steps could not be loaded.</p><button onClick={() => setRetry((n) => n + 1)}>Retry</button></div>
        : <p role="status">{preparing ? "Getting your first steps ready…" : rows ? "Opening the community…" : "Loading…"}</p>}
    </div>
  </section>;
}
