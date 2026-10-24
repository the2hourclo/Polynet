import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthSession } from "../auth";
import { getMemberWelcomePage, subscribeMemberForms, type MemberFormSummary, type MemberWelcomePage } from "../../../../shared/cloudCommunityFormRequestsGateway";
import { setCloudOwnResourceProgress } from "../../../../shared/cloudCommunityResourceProgressGateway";
import { renderMarkdown } from "../../../../shared/markdownUi";
import { useWebCommunityLessonProgress } from "../controllers/useWebCommunityLessonProgress";
import { MemberFormRunner } from "./WebCommunityNextStep";
import { WebCommunityResourceViewerContent, type WebLessonActivity } from "./WebCommunityResourceViewerContent";
import type { CommunityResource } from "./communityResourcesContracts";
import "./WebCommunityNextStep.css";

type Props = {
  communityId: string;
  communityName: string;
  /** The welcome forms the server says this member still owes. */
  requestIds: string[];
  /** The welcome lesson pages still to mark done, after the forms. */
  lessonIds: string[];
  session: AuthSession;
  ensureSession: (session: AuthSession, source?: string) => Promise<AuthSession | null>;
  /** Reloads access, so the shell moves to the next step or opens the community. */
  onFinished: () => void;
  /** Called when the page closes after the member finished, so lists read while held load again. */
  onReleased: () => void;
};

/** The builder's video or image link, shown the way lessons show media. */
export function welcomeMediaMarkdown(url: string): string {
  return /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(url) ? `![](${url})` : `<${url}>`;
}

// The builder's welcome flow: the member sees only these steps (forms, then
// lessons) until they are done. The server enforces the hold; this page is how
// the member gets through it.
export function WebCommunityWelcome(props: Props) {
  const [rows, setRows] = useState<MemberFormSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [runner, setRunner] = useState(0);
  // The page is kept with the lesson ids it was read for, so a change the owner
  // makes while the member is here (a new or replaced lesson) reads it again.
  const [loaded, setLoaded] = useState<{ key: string; page: MemberWelcomePage<CommunityResource> } | null>(null);
  const [pageError, setPageError] = useState(false);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  // No steps yet: the member just joined and the join rule is still creating their forms.
  const preparing = props.requestIds.length === 0 && props.lessonIds.length === 0;
  const formsOwed = props.requestIds.length > 0;
  const formsTotal = useRef(props.requestIds.length);
  if (props.requestIds.length > formsTotal.current) formsTotal.current = props.requestIds.length;
  // The forms list can briefly read empty while its subscription settles, so
  // every change to "nothing left" reloads access, not just the first.
  const wasEmpty = useRef(false);
  const released = useRef(false);
  const onReleased = useRef(props.onReleased);
  onReleased.current = props.onReleased;
  const onFinished = useRef(props.onFinished);
  onFinished.current = props.onFinished;
  useEffect(() => () => {
    if (!released.current) return;
    onReleased.current();
    // The community replaces this page: put focus at its start, not on the page body.
    requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>("main.workspace");
      if (!main) return;
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    });
  }, []);
  const lessonKey = props.lessonIds.join(",");
  useEffect(() => {
    let alive = true; setPageError(false);
    void (async () => {
      try {
        const ready = await props.ensureSession(props.session, "community_welcome");
        if (!ready) throw new Error("session_unavailable");
        const next = await getMemberWelcomePage<AuthSession, CommunityResource>(ready, props.communityId);
        if (alive) setLoaded({ key: lessonKey, page: next });
      } catch { if (alive) setPageError(true); }
    })();
    return () => { alive = false; };
  }, [props.session, props.communityId, props.ensureSession, lessonKey, retry]);
  const page = loaded?.page ?? null;
  useEffect(() => {
    let alive = true; setError(false); setRows(null);
    if (!formsOwed && !preparing) return;
    const stop = subscribeMemberForms(props.session, props.communityId, props.ensureSession,
      (r) => { if (alive) setRows(preparing ? r : r.filter((row) => props.requestIds.includes(row.id))); },
      () => { if (alive) setError(true); });
    return () => { alive = false; stop(); };
  }, [props.session, props.communityId, props.ensureSession, props.requestIds, formsOwed, preparing, retry]);
  // Keep asking for access while held: quickly while the join rule makes the
  // forms, and now and then after, so turning the flow off releases the member.
  useEffect(() => {
    const timer = setInterval(() => onFinished.current(), preparing ? 2_000 : 15_000);
    return () => clearInterval(timer);
  }, [preparing]);
  useEffect(() => { if (preparing && rows?.length) onFinished.current(); }, [preparing, rows]);
  useEffect(() => {
    if (!formsOwed) return;
    const empty = rows?.length === 0;
    if (empty && !wasEmpty.current) onFinished.current();
    wasEmpty.current = empty;
  }, [rows, formsOwed]);
  // Released once nothing is owed: the shell drops this page on the next access read.
  released.current = rows?.length === 0 || (!formsOwed && !preparing);

  const progress = useWebCommunityLessonProgress({ communityId: props.lessonIds.length ? props.communityId : null, session: props.session });
  const lessonActivity = useMemo<WebLessonActivity>(() => ({
    progress, signedIn: true, onRequireSignIn: () => {}, forms: null,
  }), [progress]);
  const lessons = page?.lessons ?? [];
  const lesson = !formsOwed ? lessons.find((row) => row.id === props.lessonIds[0]) ?? null : null;
  const lessonsTotal = Math.max(lessons.length, props.lessonIds.length);
  const total = formsTotal.current + lessonsTotal;
  const done = formsTotal.current - (formsOwed ? rows?.length ?? formsTotal.current : 0) + (lessonsTotal - props.lessonIds.length);
  const next = formsOwed ? rows?.[0] : undefined;
  // Read for the current lessons, and still missing the next one: unpublished in between.
  const lessonMissing = !formsOwed && props.lessonIds.length > 0 && !lesson && loaded?.key === lessonKey;
  // Moving to another step replaces what had focus, so focus and read out where the member is now.
  const stepKey = lesson ? `lesson:${lesson.id}` : next ? `form:${next.id}` : "";
  const shownStep = useRef("");
  const stepRef = useRef<HTMLParagraphElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!stepKey || shownStep.current === stepKey) return;
    const first = !shownStep.current;
    shownStep.current = stepKey;
    if (!first) (stepRef.current ?? titleRef.current)?.focus();
  }, [stepKey]);
  const finishLesson = async (resourceId: string) => {
    setLessonBusy(true); setLessonError(null);
    try {
      const ready = await props.ensureSession(props.session, "community_welcome_lesson");
      if (!ready) throw new Error("session_unavailable");
      const result = await setCloudOwnResourceProgress({ session: ready, communityId: props.communityId, resourceId, status: "done" });
      if (!result.ok) { setLessonError(result.message); return; }
      onFinished.current();
    } catch { setLessonError("Could not save. Check your connection and try again."); }
    finally { setLessonBusy(false); }
  };
  const title = page?.title || `Welcome to ${props.communityName}`;
  const message = page?.message ?? null;
  const mediaUrl = page?.media_url ?? null;
  const intro = useMemo(() => ({
    message: message ? renderMarkdown(message) : null,
    media: mediaUrl ? renderMarkdown(welcomeMediaMarkdown(mediaUrl), { embedStandaloneMedia: true }) : null,
  }), [message, mediaUrl]);
  const status = preparing ? "Getting your first steps ready…"
    : formsOwed ? (rows ? "Opening your next step…" : "Loading…")
    : pageError ? null : page ? "Opening the community…" : "Loading…";
  return <section className="community-welcome" aria-label={`Welcome to ${props.communityName}`}>
    <div className="community-welcome-intro">
      <small>Welcome</small>
      <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
      {intro.message ? <div className="community-welcome-message">{intro.message}</div>
        : <p>Finish {total > 1 ? "these steps" : "this step"} to open the community.</p>}
      {intro.media ? <div className="community-welcome-media">{intro.media}</div> : null}
      {total > 1 && (next || lesson) ? <p ref={stepRef} tabIndex={-1} className="community-welcome-step">
        Step {Math.min(done + 1, total)} of {total}{lesson ? `: ${lesson.title}` : ""}</p> : null}
    </div>
    {lesson ? <div className="community-welcome-lesson">
      <WebCommunityResourceViewerContent resource={lesson} lessonActivity={lessonActivity} />
      <footer>
        <button type="button" className="platform-save-button" disabled={lessonBusy} onClick={() => void finishLesson(lesson.id)}>
          {lessonBusy ? "Saving…" : props.lessonIds.length > 1 ? "Mark done and continue" : "Mark done and open the community"}
        </button>
        {lessonError ? <p role="alert">{lessonError}</p> : null}
      </footer>
    </div> : <div className="member-form-dialog community-welcome-form">
      {next ? <MemberFormRunner key={`${next.id}:${runner}`} communityId={props.communityId} session={props.session} ensureSession={props.ensureSession}
        requestId={next.id} onClose={() => setRunner((n) => n + 1)} />
        : error || lessonMissing || (pageError && !formsOwed && !preparing) ? <div role="alert"><p>Your welcome steps could not be loaded.</p><button type="button" onClick={() => { setRetry((n) => n + 1); onFinished.current(); }}>Retry</button></div>
        : <p role="status">{status}</p>}
    </div>}
  </section>;
}
