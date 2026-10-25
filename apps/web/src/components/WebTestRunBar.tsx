import { useEffect, useRef, useState } from "react";
import type { AuthSession } from "../auth";
import { getCloudMyTestRun } from "../../../../shared/cloudCommunityTestMembersGateway";
import { clearTestMemberRun, readTestMemberRun } from "../../../../shared/testMemberRun";
import "./WebCommunityTestRun.css";

const ENDED_EVENT = "polynet:test-run-ended";
const CHECK_EVERY_MS = 30_000;

function exitTestRun() {
  clearTestMemberRun();
  // A tab the Test run page opened just closes; any other goes back to being the owner's.
  window.close();
  window.location.reload();
}

/** Asks the server who this test-run tab is acting as; tells the bar when the run is over. */
export function useTestMemberRunCheck(session: AuthSession | null, ensureSession: (session?: AuthSession | null, source?: string) => Promise<AuthSession | null>) {
  const active = Boolean(readTestMemberRun());
  const ensureRef = useRef(ensureSession);
  ensureRef.current = ensureSession;
  useEffect(() => {
    if (!active || !session) return;
    let alive = true;
    const check = async () => {
      try {
        const ready = await ensureRef.current(session, "test_run_check");
        if (!ready) return;
        const run = await getCloudMyTestRun(ready);
        if (alive && !run) window.dispatchEvent(new Event(ENDED_EVENT));
      } catch {
        if (alive) window.dispatchEvent(new Event(ENDED_EVENT));
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [active, session]);
}

// Shown on every page of a test-run tab, whatever the app is doing, so the
// owner always knows this tab is not them and can leave it.
export function WebTestRunBar() {
  const [run] = useState(readTestMemberRun);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const onEnded = () => setEnded(true);
    window.addEventListener(ENDED_EVENT, onEnded);
    return () => window.removeEventListener(ENDED_EVENT, onEnded);
  }, []);
  if (!run) return null;
  return <div className={`test-run-bar${ended ? " is-ended" : ""}`} role="region" aria-label="Test run">
    <span>{ended ? <>This test run has ended.</> : <>Testing as <strong>{run.label}</strong>. Nothing here is a real member.</>}</span>
    <button type="button" onClick={exitTestRun}>Exit test</button>
  </div>;
}
