import { useEffect, useRef, useState } from "react";
import type { AuthSession } from "../auth";
import { getCloudMyTestRun, subscribeCloudMyTestRun, type CloudMyTestRunAutoplay } from "../../../../shared/cloudCommunityTestMembersGateway";
import { clearTestMemberRun, readTestMemberRun } from "../../../../shared/testMemberRun";
import "./WebCommunityTestRun.css";

const ENDED_EVENT = "polynet:test-run-ended";
const AUTOPLAY_EVENT = "polynet:test-run-autoplay";
const HIGHLIGHT_MS = 2400;
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

/** While Autoplay plays, this tab follows it: the bar says each step as it happens. */
export function useTestMemberAutoplayFollow(session: AuthSession | null, ensureSession: (session?: AuthSession | null, source?: string) => Promise<AuthSession | null>) {
  const active = Boolean(readTestMemberRun());
  const ensureRef = useRef(ensureSession);
  ensureRef.current = ensureSession;
  useEffect(() => {
    if (!active || !session) return;
    return subscribeCloudMyTestRun({
      session, ensureSession: (current, source) => ensureRef.current(current, source),
      update: (run) => window.dispatchEvent(new CustomEvent(AUTOPLAY_EVENT, { detail: run?.autoplay ?? null })),
      error: () => {},
    });
  }, [active, session]);
}

/** Goes where Autoplay acted, in this tab, without a reload. */
function followTo(path: string | null) {
  if (!path || window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Outlines what Autoplay pressed, found by its words, once the page has drawn it. */
function highlightTarget(target: string | null) {
  const words = String(target ?? "").trim().toLowerCase();
  if (!words) return () => {};
  let outlined: HTMLElement | null = null;
  const find = () => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a, h1, h2, h3, label, [role='button']"))
      .filter((node) => !node.closest(".test-run-bar") && node.offsetParent !== null);
    return candidates.find((node) => node.innerText.trim().toLowerCase() === words)
      ?? candidates.find((node) => node.innerText.trim().toLowerCase().includes(words)) ?? null;
  };
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    const node = find();
    if (!node && tries < 10) return;
    window.clearInterval(timer);
    if (!node) return;
    outlined = node;
    node.classList.add("test-run-highlight");
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => node.classList.remove("test-run-highlight"), HIGHLIGHT_MS);
  }, 150);
  return () => { window.clearInterval(timer); outlined?.classList.remove("test-run-highlight"); };
}

// Shown on every page of a test-run tab, whatever the app is doing, so the
// owner always knows this tab is not them and can leave it.
export function WebTestRunBar() {
  const [run] = useState(readTestMemberRun);
  const [ended, setEnded] = useState(false);
  const [beat, setBeat] = useState<CloudMyTestRunAutoplay | null>(null);
  useEffect(() => {
    const onEnded = () => setEnded(true);
    const onAutoplay = (event: Event) => setBeat((event as CustomEvent<CloudMyTestRunAutoplay | null>).detail);
    window.addEventListener(ENDED_EVENT, onEnded);
    window.addEventListener(AUTOPLAY_EVENT, onAutoplay);
    return () => { window.removeEventListener(ENDED_EVENT, onEnded); window.removeEventListener(AUTOPLAY_EVENT, onAutoplay); };
  }, []);
  useEffect(() => {
    if (!beat) return;
    followTo(beat.path);
    return highlightTarget(beat.target);
  }, [beat?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run) return null;
  return <div className={`test-run-bar${ended ? " is-ended" : ""}`} role="region" aria-label="Test run">
    <span>{ended ? <>This test run has ended.</>
      : beat ? <><strong>Autoplay:</strong> {beat.text}</>
      : <>Testing as <strong>{run.label}</strong>. Nothing here is a real member.</>}</span>
    <button type="button" onClick={exitTestRun}>Exit test</button>
  </div>;
}
