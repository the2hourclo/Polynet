import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { AuthSession } from "../auth";
import { getMemberWelcomePage, subscribeMemberForms, type MemberFormSummary, type MemberWelcomePage } from "../../../../shared/cloudCommunityFormRequestsGateway";
import { setCloudOwnResourceProgress } from "../../../../shared/cloudCommunityResourceProgressGateway";
import { renderMarkdown } from "../../../../shared/markdownUi";
import { legacyWelcomeLayout, welcomeLayoutWithForms, welcomeScreens, type WelcomeBlock, type WelcomeScreen, type WelcomeStep } from "../../../../shared/communityWelcomeLayout";
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
  /** The welcome lesson pages still to mark done. */
  lessonIds: string[];
  session: AuthSession;
  ensureSession: (session: AuthSession, source?: string) => Promise<AuthSession | null>;
  /** Reloads access, so the shell moves to the next step or opens the community. */
  onFinished: () => void;
  /** Called when the page closes after the member finished, so lists read while held load again. */
  onReleased: () => void;
};

/** One screen of the welcome page: where the member is, the headline on the
 * first screen, then the owner's blocks with the step (a form or a lesson) where
 * it was placed. The member page and the owner's preview both render this. */
export function WelcomeScreenView(props: {
  title: string; screens: WelcomeScreen[]; index: number;
  renderStep: (step: WelcomeStep) => ReactNode;
  /** A screen with no step moves on with this. */
  onNext: () => void;
  titleRef?: Ref<HTMLHeadingElement>; stepRef?: Ref<HTMLParagraphElement>;
  // Inside Settings the page sits under the "Preview" heading, so its title reads as a level below.
  headingLevel?: number;
}) {
  const screen = props.screens[props.index] ?? null;
  const total = props.screens.length;
  const rendered = useMemo(() => (screen?.blocks ?? []).map((block) =>
    block.type === "text" ? renderMarkdown(block.markdown, { embedStandaloneMedia: true }) : null), [screen]);
  return <>
    <div className="community-welcome-intro">
      {total > 1 ? <div className="community-welcome-progress">
        <p ref={props.stepRef} tabIndex={-1} className="community-welcome-step">Step {props.index + 1} of {total}</p>
        <span className="community-welcome-progress-track" aria-hidden="true"><span style={{ width: `${((props.index + 1) / total) * 100}%` }} /></span>
      </div> : null}
      <small>{props.index === 0 ? "Welcome" : props.title}</small>
      {props.index === 0 ? <h1 ref={props.titleRef} tabIndex={-1} aria-level={props.headingLevel}>{props.title}</h1> : null}
    </div>
    {screen?.blocks.map((block, index) => block.type === "text"
      ? <div key={index} className="community-welcome-message">{rendered[index]}</div>
      : block.type === "next" ? null : <Fragment key={index}>{props.renderStep(block)}</Fragment>)}
    {screen && !screen.step ? <footer className="community-welcome-next">
      <button type="button" className="platform-save-button" onClick={props.onNext}>Next</button>
    </footer> : null}
  </>;
}

/** The builder's video or image link, shown the way lessons show media. */
export function welcomeMediaMarkdown(url: string): string {
  return /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(url) ? `![](${url})` : `<${url}>`;
}

/** The page the member goes through: the saved blocks, or the words, media and steps saved before blocks existed. */
export function memberWelcomeLayout(page: { message?: string | null; media_url?: string | null; layout?: WelcomeBlock[] | null } | null,
  formKeys: string[], lessonIds: string[]): WelcomeBlock[] {
  const layout = page?.layout ?? legacyWelcomeLayout({
    message: page?.message ?? null, mediaUrl: page?.media_url ? welcomeMediaMarkdown(page.media_url) : null, formKeys, lessonIds,
  });
  return welcomeLayoutWithForms(layout, formKeys);
}

const seenKey = (communityId: string) => `polynet:welcome-seen:${communityId}`;
function readSeen(communityId: string): number[] {
  try { const value = JSON.parse(localStorage.getItem(seenKey(communityId)) ?? "[]"); return Array.isArray(value) ? value.filter(Number.isInteger) : []; }
  catch { return []; }
}

// The builder's welcome flow: the member sees only these screens, in the
// owner's order, until every step on them is done. The server enforces the hold; this page is how
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
  const lessonById = useMemo(() => new Map(lessons.map((row) => [row.id, row])), [lessons]);
  // Owed forms by key; rows without a key (older servers) take the next form screen.
  const owedKeys = useMemo(() => (rows ?? []).map((row) => row.form_key ?? `request:${row.id}`), [rows]);
  const screens = useMemo(() => welcomeScreens(memberWelcomeLayout(page, owedKeys, props.lessonIds)), [page, owedKeys, props.lessonIds]);
  const [seen, setSeen] = useState<number[]>(() => readSeen(props.communityId));
  const stepOwed = (step: WelcomeStep) => step.type === "form"
    ? (rows === null ? formsOwed : owedKeys.includes(step.formKey))
    : props.lessonIds.includes(step.resourceId) && lessonById.has(step.resourceId);
  const index = page ? screens.findIndex((screen, at) => (screen.step ? stepOwed(screen.step) : !seen.includes(at))) : -1;
  // Text screens before the next step are read once; past the last step the community opens.
  const lastOwed = screens.reduce((last, screen, at) => (screen.step && stepOwed(screen.step) ? at : last), -1);
  const current = index >= 0 && index <= lastOwed ? index : -1;
  const moveOn = () => {
    const next = [...seen, current];
    setSeen(next);
    try { localStorage.setItem(seenKey(props.communityId), JSON.stringify(next)); } catch { /* the page still moves on */ }
  };
  const lessonMissing = !formsOwed && props.lessonIds.length > 0 && props.lessonIds.every((id) => !lessonById.has(id)) && loaded?.key === lessonKey;
  // Moving to another screen replaces what had focus, so focus and read out where the member is now.
  const stepKey = current >= 0 ? `screen:${current}` : "";
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
  const lastStep = current >= 0 && current === lastOwed;
  const renderStep = (step: WelcomeStep) => {
    if (step.type === "lesson") {
      const lesson = lessonById.get(step.resourceId);
      if (!lesson) return null;
      return <div className="community-welcome-lesson">
        <WebCommunityResourceViewerContent resource={lesson} lessonActivity={lessonActivity} />
        <footer>
          <button type="button" className="platform-save-button" disabled={lessonBusy || !props.lessonIds.includes(lesson.id)} onClick={() => void finishLesson(lesson.id)}>
            {lessonBusy ? "Saving…" : lastStep ? "Mark done and open the community" : "Mark done and continue"}
          </button>
          {lessonError ? <p role="alert">{lessonError}</p> : null}
        </footer>
      </div>;
    }
    const row = rows?.find((r) => (r.form_key ?? `request:${r.id}`) === step.formKey);
    return <div className="member-form-dialog community-welcome-form">
      {row ? <MemberFormRunner key={`${row.id}:${runner}`} communityId={props.communityId} session={props.session} ensureSession={props.ensureSession}
        requestId={row.id} onClose={() => setRunner((n) => n + 1)} />
        : error ? <div role="alert"><p>Your welcome steps could not be loaded.</p><button type="button" onClick={() => { setRetry((n) => n + 1); onFinished.current(); }}>Retry</button></div>
        : <p role="status">{rows ? "Opening your next step…" : "Loading…"}</p>}
    </div>;
  };
  const title = page?.title || `Welcome to ${props.communityName}`;
  const status = preparing ? "Getting your first steps ready…"
    : pageError ? null : page && (!formsOwed || rows) ? "Opening the community…" : "Loading…";
  const failed = (error && !formsOwed) || lessonMissing || (pageError && !preparing);
  return <section className="community-welcome" aria-label={`Welcome to ${props.communityName}`}>
    {current >= 0 && !preparing ? <WelcomeScreenView title={title} screens={screens} index={current} renderStep={renderStep} onNext={moveOn}
      titleRef={titleRef} stepRef={stepRef} />
      : <>
        <div className="community-welcome-intro"><small>Welcome</small><h1 ref={titleRef} tabIndex={-1}>{title}</h1></div>
        {failed ? <div role="alert"><p>Your welcome steps could not be loaded.</p><button type="button" onClick={() => { setRetry((n) => n + 1); onFinished.current(); }}>Retry</button></div>
          : <p role="status">{status}</p>}
      </>}
  </section>;
}
