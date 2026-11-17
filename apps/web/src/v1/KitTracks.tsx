// Knowledge as tracks, ported to design v1 from the fork's old build (Rashid,
// Nov 17: "port what we had in knowledge in our old polynet"). The Roadmap
// home: a Start here card for the track you're in, your tracks as cards, and
// the courses that sit on no track as the Library. A track's page: Today's
// step beside what you're building (one part per module, filling in), then
// the modules as cards or as a board. Progress is worked out here, from the
// member's own lesson progress (shared/communityLessonTracks.ts).
// Fork only: not sent to Neil.
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  COMMUNITY_MAIN_TRACK_KEY,
  type CommunityTrackStageView,
  type CommunityTrackView,
} from "../../../../shared/communityLessonTracks";
import { cx, Icon } from "./kit";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function formatTrackMinutes(total: number) {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function trackFacts(track: CommunityTrackView) {
  return [plural(track.stages.length, "module"), plural(track.step_count, "lesson"), track.minutes ? `about ${formatTrackMinutes(track.minutes)}` : null]
    .filter(Boolean).join(" · ");
}

/** The track a member most likely wants: the one they're in, else the first open one. */
export function continueTrack(tracks: readonly CommunityTrackView[]) {
  return tracks.find((track) => track.status === "in_progress" && track.next) ?? tracks.find((track) => track.open && track.next) ?? null;
}

const ACTION: Record<CommunityTrackView["status"], string> = { locked: "Locked", open: "Start", in_progress: "Continue", done: "Review" };

/**
 * The route: one dot per module along a dotted path, done ones filled, the one
 * you're on ringed, the finish a check.
 */
function TrackRoute({ track, width = 220, height = 96 }: { track: CommunityTrackView; width?: number; height?: number }) {
  const sections = track.stages.length ? track.stages : [{ done_count: 0, step_count: 1, locked: false }];
  const count = Math.min(sections.length, 9);
  const pick = (index: number) => sections[Math.round((index * (sections.length - 1)) / Math.max(count - 1, 1))];
  const pad = 14;
  const slots = Math.max(count, 2);
  const points = Array.from({ length: slots }, (_, index) => ({
    x: pad + ((width - pad * 2) * index) / (slots - 1),
    y: [height - pad - 4, height / 2, pad + 4, height / 2][index % 4],
  }));
  const path = points.reduce((d: string, point, index) => {
    if (index === 0) return `M${point.x} ${point.y}`;
    const before = points[index - 1];
    const mid = (point.x - before.x) / 2;
    return `${d} C${before.x + mid} ${before.y} ${point.x - mid} ${point.y} ${point.x} ${point.y}`;
  }, "");
  const currentAt = Array.from({ length: count }, (_, index) => pick(index)).findIndex((stage) => stage.done_count < stage.step_count && !stage.locked);
  return (
    <svg className={cx("troute")} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
      {points.slice(0, count).map((point, index) => {
        const stage = pick(index);
        const done = stage.step_count > 0 && stage.done_count >= stage.step_count;
        if (index === count - 1 && count > 1 && (track.status === "done" || done)) {
          return <g key={index}><circle cx={point.x} cy={point.y} r="10" fill="currentColor" /><path d={`M${point.x - 4.5} ${point.y}l3 3 6-6.5`} fill="none" stroke="var(--troute-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>;
        }
        if (done) return <circle key={index} cx={point.x} cy={point.y} r="7.5" fill="currentColor" />;
        if (index === currentAt) return <circle key={index} cx={point.x} cy={point.y} r="9" fill="var(--troute-ink)" stroke="currentColor" strokeWidth="3.5" />;
        return <circle key={index} cx={point.x} cy={point.y} r="6" fill="var(--troute-ink)" stroke="currentColor" strokeWidth="2" />;
      })}
    </svg>
  );
}

function TrackArt({ track, hero }: { track: CommunityTrackView; hero?: boolean }) {
  if (track.cover_url) return <span className={cx("tart", "img")} style={{ backgroundImage: `url(${JSON.stringify(track.cover_url)})` }} />;
  // No picture: a cover made of words in Neil's accent, like a book spine,
  // with the track's route drawn faintly in the corner.
  return (
    <span className={cx("tart", "tgen", hero && "is-hero")}>
      <TrackRoute track={track} width={hero ? 260 : 180} height={hero ? 104 : 72} />
      <span className={cx("tgen-kicker")}>{track.key === COMMUNITY_MAIN_TRACK_KEY ? "Core track" : "Skill track"}</span>
      <b className={cx("tgen-title")}>{track.title}</b>
      <span className={cx("tgen-meta")}>{plural(track.stages.length, "module")} · {plural(track.step_count, "lesson")}</span>
    </span>
  );
}

/** A module's cover: its number and one dot per lesson, filled when done. */
function ModuleArt({ stage, index }: { stage: CommunityTrackStageView; index: number }) {
  return (
    <span className={cx("tart", "tnum", stage.locked && "is-locked")}>
      <span className={cx("tnum-n")}>{String(index + 1).padStart(2, "0")}</span>
      <span className={cx("tdots")} aria-hidden="true">
        {stage.steps.map((step) => <i key={step.ref} className={cx(step.done && "on")} />)}
      </span>
    </span>
  );
}

export type TrackLibraryCourse = { id: string; title: string; cover: string | null; lessonCount: number; onOpen: () => void };

/** The Roadmap home: Start here, your tracks, and the Library. */
export function KitTrackHome(props: {
  tracks: readonly CommunityTrackView[];
  onOpenTrack: (key: string) => void;
  onContinue: (track: CommunityTrackView) => void;
  library: readonly TrackLibraryCourse[];
  onBrowseAll: () => void;
  tools?: ReactNode;
}) {
  const current = continueTrack(props.tracks);
  const yours = props.tracks.filter((track) => track.open);
  const coming = props.tracks.filter((track) => !track.open);
  const percent = current?.step_count ? Math.round((current.done_count / current.step_count) * 100) : 0;
  return (
    <div className={cx("thome")}>
      {current?.next ? (
        <button type="button" className={cx("card thero")} onClick={() => props.onContinue(current)}>
          <TrackArt track={current} hero />
          <span className={cx("thero-body")}>
            <span className={cx("teyebrow")}>{current.status === "in_progress" ? "Continue where you left off" : "Start here"}</span>
            <h2>{current.title}</h2>
            <span className={cx("thero-next")}>Next: <b>{current.next.title}</b> · {current.next.stage}</span>
            <span className={cx("thero-foot")}>
              <span className={cx("thero-prog")}>
                <span className={cx("bar")}><i style={{ width: `${percent}%` }} /></span>
                <em>{current.done_count} of {current.step_count} lessons{current.minutes ? ` · about ${formatTrackMinutes(current.minutes)} in all` : ""}</em>
              </span>
              <span className={cx("btn go tgo")}>{current.status === "in_progress" ? "Continue" : "Start"}<Icon name="arrow" /></span>
            </span>
          </span>
        </button>
      ) : null}

      <div className={cx("thead")}>
        <h3>Your tracks</h3>
        {yours.length > 1 ? <span>{yours.length} open · start any of them</span> : null}
      </div>
      <div className={cx("tgrid")}>
        {yours.map((track) => {
          const done = track.step_count ? Math.round((track.done_count / track.step_count) * 100) : 0;
          return (
            <button key={track.key} type="button" className={cx("tcard")} onClick={() => props.onOpenTrack(track.key)}>
              <span className={cx("tcard-art")}>
                <TrackArt track={track} />
                {track.key === COMMUNITY_MAIN_TRACK_KEY ? <span className={cx("tbadge")}>Core track</span> : null}
              </span>
              <span className={cx("tcard-body")}>
                <b>{track.title}</b>
                {track.summary ? <span className={cx("tcard-sum")}>{track.summary}</span> : null}
                <span className={cx("tcard-meta")}>{track.status === "in_progress" ? `${track.done_count} of ${track.step_count} lessons done` : trackFacts(track)}</span>
                {track.status === "in_progress" ? <span className={cx("bar")}><i style={{ width: `${done}%` }} /></span> : null}
                <span className={cx("tcard-go")}>{track.status === "done" ? <Icon name="check" /> : null}{ACTION[track.status]}<Icon name="arrow" /></span>
              </span>
            </button>
          );
        })}
      </div>

      {coming.length ? (
        <>
          <div className={cx("thead")}><h3>Unlock next</h3><span>Each one opens as you go</span></div>
          <div className={cx("tgrid")}>
            {coming.map((track) => (
              <button key={track.key} type="button" className={cx("tcard", "tlocked")} onClick={() => props.onOpenTrack(track.key)}>
                <span className={cx("tcard-art")}><span className={cx("tart", "lockart")}><Icon name="lock" /></span></span>
                <span className={cx("tcard-body")}>
                  <b>{track.title}</b>
                  <span className={cx("tcard-sum")}>{track.opens_reason}.</span>
                  {track.opens_progress ? <span className={cx("tcard-meta")}>{plural(track.opens_progress.total - track.opens_progress.done, "lesson")} to go</span> : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.library.length || props.tools ? (
        <>
          <div className={cx("thead")}>
            <h3>Library</h3><span>Courses that sit outside the tracks</span>
            <span className={cx("thead-tools")}>{props.tools}<button type="button" className={cx("btn sm txt")} onClick={props.onBrowseAll}>See everything<Icon name="arrow" /></button></span>
          </div>
          {props.library.length ? <div className={cx("tgrid")}>
            {props.library.map((course) => (
              <button key={course.id} type="button" className={cx("tcard", "tmod")} onClick={course.onOpen}>
                <span className={cx("tcard-art")}>
                  {course.cover ? <span className={cx("tart", "img")} style={{ backgroundImage: `url(${JSON.stringify(course.cover)})` }} /> : <span className={cx("tart", "tgen", "is-course")}><span className={cx("tgen-kicker")}>Course</span><b className={cx("tgen-title")}>{course.title}</b><span className={cx("tgen-meta")}>{plural(course.lessonCount, "lesson")}</span></span>}
                </span>
                <span className={cx("tcard-body")}>
                  <span className={cx("tmod-eyebrow")}>Course</span>
                  <b className={cx("tmod-title")}>{course.title}<span className={cx("tmod-arrow")}>↗</span></b>
                  <span className={cx("tcard-meta")}>{plural(course.lessonCount, "lesson")}</span>
                </span>
              </button>
            ))}
          </div> : null}
        </>
      ) : null}
    </div>
  );
}

/** One module of a track: its course's cover, and what opening it does. */
export type TrackModule = { stage: CommunityTrackStageView; cover: string | null; onOpen: () => void };

const SHAPE_KEY = "polynet.knowledge.trackShape";
function readShape(): "cards" | "board" {
  try { return window.localStorage.getItem(SHAPE_KEY) === "board" ? "board" : "cards"; } catch { return "cards"; }
}

const stageNo = (index: number) => String((index % 6) + 1);

/** A track's page: Today's step, what you're building, and the modules. */
export function KitTrackShelf(props: {
  track: CommunityTrackView;
  modules: readonly TrackModule[];
  onContinue: () => void;
  onAllTracks: () => void;
  onOpenStep: (resourceId: string) => void;
  minutesOf: (resourceId: string) => number | null;
}) {
  const { track } = props;
  const [shape, setShape] = useState<"cards" | "board">(() => readShape());
  const pickShape = (next: "cards" | "board") => {
    setShape(next);
    try { window.localStorage.setItem(SHAPE_KEY, next); } catch { /* not remembered, that's all */ }
  };
  const started = track.done_count > 0 || track.status === "in_progress";
  return (
    <div className={cx("thome")}>
      <button type="button" className={cx("kback", "tback")} onClick={props.onAllTracks}><Icon name="back" />All tracks</button>
      <div className={cx("ttoday-row")}>
        <TodayCard track={track} modules={props.modules} started={started} minutesOf={props.minutesOf} onContinue={props.onContinue} />
        <BuildPanel track={track} modules={props.modules} />
      </div>
      <div className={cx("thead")}>
        <h3>Modules</h3><span>{trackFacts(track)}</span>
        <span className={cx("thead-tools")}>
          <span className={cx("seg")} role="group" aria-label="Show modules as">
            <button type="button" className={cx(shape === "cards" && "on")} aria-pressed={shape === "cards"} onClick={() => pickShape("cards")}>Cards</button>
            <button type="button" className={cx(shape === "board" && "on")} aria-pressed={shape === "board"} onClick={() => pickShape("board")}>Board</button>
          </span>
        </span>
      </div>
      {shape === "board" ? <ModuleBoard modules={props.modules} onOpenStep={props.onOpenStep} /> : (
        <div className={cx("tgrid")}>
          {props.modules.map(({ stage, onOpen }, index) => {
            const done = stage.step_count > 0 && stage.done_count >= stage.step_count;
            const going = !done && stage.done_count > 0;
            const percent = stage.step_count ? Math.round((stage.done_count / stage.step_count) * 100) : 0;
            const firstLocked = stage.locked && props.modules.find((item) => item.stage.locked)?.stage === stage;
            const blocker = firstLocked && stage.blocked_by ? track.stages.findIndex((candidate) => candidate.steps.some((step) => step.ref === stage.blocked_by)) : -1;
            return (
              <button key={stage.name} type="button" className={cx("tcard", "tmod", stage.locked && "tlocked")} data-stage={stageNo(index)} onClick={onOpen} disabled={stage.locked}>
                <span className={cx("tcard-art")}>
                  <ModuleArt stage={stage} index={index} />
                </span>
                <span className={cx("tcard-body")}>
                  <span className={cx("tmod-eyebrow")}>Module {index + 1}</span>
                  <b className={cx("tmod-title")}>{stage.name}{stage.locked ? null : <span className={cx("tmod-arrow")}>↗</span>}</b>
                  <span className={cx("tmod-meta")}>
                    <span>{plural(stage.step_count, "lesson")}</span>
                    <span className={cx("tpill", done ? "is-done" : going ? "is-going" : stage.locked ? "is-locked" : "")}>
                      {stage.locked ? <Icon name="lock" /> : done ? <Icon name="check" /> : <i />}
                      {stage.locked ? (blocker >= 0 ? `Opens after Module ${blocker + 1}` : "Locked") : done ? "Completed" : going ? "In progress" : "Not started"}
                    </span>
                  </span>
                  {going ? <span className={cx("tmod-prog")}><span className={cx("bar")}><i style={{ width: `${percent}%` }} /></span><em>{percent}%</em></span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TodayCard(props: { track: CommunityTrackView; modules: readonly TrackModule[]; started: boolean; minutesOf: (id: string) => number | null; onContinue: () => void }) {
  const { track } = props;
  const next = track.next;
  if (!next) {
    return (
      <section className={cx("card ttoday")} data-stage="1" aria-label="Today's step">
        <span className={cx("teyebrow")}>{track.key === COMMUNITY_MAIN_TRACK_KEY ? "Core track" : "Skill track"} · {track.title}</span>
        <h2>Every lesson is done</h2>
        <span className={cx("ttoday-note")}>{track.done_count} of {track.step_count} lessons. Nice work.</span>
      </section>
    );
  }
  const index = props.modules.findIndex(({ stage }) => stage.steps.some((step) => step.resource_id === next.resource_id));
  const stage = index >= 0 ? props.modules[index].stage : null;
  const minutes = props.minutesOf(next.resource_id);
  const left = stage ? stage.step_count - stage.done_count : 0;
  return (
    <section className={cx("card ttoday")} data-stage={index >= 0 ? stageNo(index) : "1"} aria-label="Today's step">
      <span className={cx("teyebrow")}>{props.started ? "Today's step" : "Start here"}{minutes ? ` · about ${formatTrackMinutes(minutes)}` : ""}</span>
      <h2>{next.title}</h2>
      <span className={cx("ttoday-note")}>{index >= 0 ? `Module ${index + 1} · ${next.stage}` : next.stage} · {track.title}</span>
      {stage ? (
        <ol className={cx("tpath")} aria-label={`${stage.done_count} of ${stage.step_count} lessons done in this module`}>
          {stage.steps.map((step) => <li key={step.ref} data-state={step.done ? "done" : step.resource_id === next.resource_id ? "here" : "todo"} title={step.title} />)}
        </ol>
      ) : null}
      <span className={cx("ttoday-foot")}>
        <button type="button" className={cx("btn go tgo")} onClick={props.onContinue}>{props.started ? "Continue" : "Start"}<Icon name="arrow" /></button>
        <em>{stage ? (left <= 1 ? "Last lesson in this module" : `${left} lessons left in this module`) : ""}</em>
      </span>
    </section>
  );
}

function BuildPanel(props: { track: CommunityTrackView; modules: readonly TrackModule[] }) {
  const built = props.modules.filter(({ stage }) => stage.step_count > 0 && stage.done_count >= stage.step_count).length;
  const core = props.track.key === COMMUNITY_MAIN_TRACK_KEY;
  return (
    <section className={cx("card tbuild")} aria-label={core ? "Your AI Employee" : "What you're building"}>
      <span className={cx("teyebrow", "plain")}>{core ? "Your AI Employee" : "What you're building"}</span>
      <h2>{built} of {props.modules.length} parts built</h2>
      <ul className={cx("tparts")}>
        {props.modules.map(({ stage }, index) => {
          const done = stage.step_count > 0 && stage.done_count >= stage.step_count;
          const fill = stage.step_count ? Math.round((stage.done_count / stage.step_count) * 100) : 0;
          const state = done ? "done" : stage.done_count ? "building" : stage.locked ? "locked" : "todo";
          return (
            <li key={stage.name} data-stage={stageNo(index)} data-state={state} style={{ "--fill": `${fill}%` } as CSSProperties}>
              <span className={cx("tpart-mark")}>{done ? <Icon name="check" /> : stage.locked ? <Icon name="lock" /> : index + 1}</span>
              <span className={cx("tpart-text")}><b>{stage.name}</b><small>{done ? "Built" : stage.done_count ? `${fill}%` : stage.locked ? "Locked" : "Not yet"}</small></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ModuleBoard(props: { modules: readonly TrackModule[]; onOpenStep: (resourceId: string) => void }) {
  const here = props.modules.findIndex(({ stage }) => !stage.locked && stage.done_count < stage.step_count);
  return (
    <ol className={cx("tboard")} aria-label="Modules as a board">
      {props.modules.map(({ stage }, index) => {
        const done = stage.step_count > 0 && stage.done_count >= stage.step_count;
        const nextStep = index === here ? stage.steps.find((step) => !step.done && !step.locked) : undefined;
        return (
          <li key={stage.name} className={cx("tcol")} data-stage={stageNo(index)} data-state={done ? "done" : index === here ? "here" : stage.locked ? "locked" : "open"}>
            <div className={cx("tcol-head")}>
              <span className={cx("tcol-pill")}><i />{stage.name}</span>
              <span className={cx("tcol-state")}>{stage.locked ? "Locked" : done ? "Done" : index === here ? "You're here" : `${stage.done_count}/${stage.step_count}`}</span>
            </div>
            {stage.steps.map((step) => (
              <button key={step.ref} type="button" className={cx("tstep", step.done && "is-done", step === nextStep && "is-next")} disabled={step.locked || stage.locked} onClick={() => props.onOpenStep(step.resource_id)}>
                <span className={cx("tstep-tick")}>{step.done ? <Icon name="check" /> : step.locked || stage.locked ? <Icon name="lock" /> : null}</span>
                <span className={cx("tstep-text")}>
                  <b>{step.title}</b>
                  {step.checkpoint ? <em>Checkpoint</em> : step === nextStep ? <em className={cx("is-next")}>Up next</em> : null}
                </span>
              </button>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
