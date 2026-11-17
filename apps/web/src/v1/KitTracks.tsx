// Knowledge as tracks, ported to design v1 from the fork's old build (Rashid,
// Nov 17: "port what we had in knowledge in our old polynet"). The Roadmap
// home: a Start here card for the track you're in, your tracks as cards, and
// the courses that sit on no track as the Library. A track's page: Today's
// step beside what you're building (one part per module, filling in), then
// the modules as cards or as a board. Progress is worked out here, from the
// member's own lesson progress (shared/communityLessonTracks.ts).
// Fork only: not sent to Neil.
import type { ReactNode } from "react";
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

function TrackArt({ track, hero }: { track: CommunityTrackView; hero?: boolean }) {
  if (track.cover_url) return <span className={cx("tart", "img")} style={{ backgroundImage: `url(${JSON.stringify(track.cover_url)})` }} />;
  // No picture: a cover made of words in Neil's accent. The hero names the
  // module you're on (its own body already names the track).
  if (hero) {
    const at = track.next ? track.stages.findIndex((stage) => stage.name === track.next?.stage) : -1;
    return (
      <span className={cx("tart", "tgen", "is-hero")}>
        <span className={cx("tgen-kicker")}>{at >= 0 ? `Module ${at + 1} of ${track.stages.length}` : track.key === COMMUNITY_MAIN_TRACK_KEY ? "Core track" : "Skill track"}</span>
        <b className={cx("tgen-title")}>{at >= 0 ? track.stages[at].name : track.title}</b>
      </span>
    );
  }
  return (
    <span className={cx("tart", "tgen")}>
      <span className={cx("tgen-kicker")}>{track.key === COMMUNITY_MAIN_TRACK_KEY ? "Core track" : "Skill track"}</span>
      <b className={cx("tgen-title")}>{track.title}</b>
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
        <h3><Icon name="route" />Your tracks</h3>
        {yours.length > 1 ? <span>{yours.length} open · start any of them</span> : null}
      </div>
      <div className={cx("tgrid")}>
        {yours.map((track) => {
          const done = track.step_count ? Math.round((track.done_count / track.step_count) * 100) : 0;
          return (
            <button key={track.key} type="button" className={cx("tcard")} onClick={() => props.onOpenTrack(track.key)}>
              <span className={cx("tcard-art")}>
                <TrackArt track={track} />
                {track.cover_url && track.key === COMMUNITY_MAIN_TRACK_KEY ? <span className={cx("tbadge")}>Core track</span> : null}
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
          <div className={cx("thead")}><h3><Icon name="lock" />Unlock next</h3><span>Each one opens as you go</span></div>
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
            <h3><Icon name="book" />Library</h3><span>Courses that sit outside the tracks</span>
            <span className={cx("thead-tools")}>{props.tools}<button type="button" className={cx("btn sm txt")} onClick={props.onBrowseAll}>See everything<Icon name="arrow" /></button></span>
          </div>
          {props.library.length ? <div className={cx("tgrid")}>
            {props.library.map((course) => (
              <button key={course.id} type="button" className={cx("tcard", "tmod")} onClick={course.onOpen}>
                <span className={cx("tcard-art")}>
                  {course.cover ? <span className={cx("tart", "img")} style={{ backgroundImage: `url(${JSON.stringify(course.cover)})` }} /> : <span className={cx("tart", "tgen", "is-course")}><span className={cx("tgen-kicker")}>Course</span><b className={cx("tgen-title")}>{course.title}</b></span>}
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
  const started = track.done_count > 0 || track.status === "in_progress";
  return (
    <div className={cx("thome")}>
      <button type="button" className={cx("kback", "tback")} onClick={props.onAllTracks}><Icon name="back" />All tracks</button>
      <TodayCard track={track} modules={props.modules} started={started} minutesOf={props.minutesOf} onContinue={props.onContinue} />
      <div className={cx("thead")}>
        <h3><Icon name="layers" />Modules</h3><span>{trackFacts(track)}</span>
      </div>
      <div className={cx("tgrid")}>
        {props.modules.map(({ stage, onOpen }, index) => {
          const done = stage.step_count > 0 && stage.done_count >= stage.step_count;
          const firstLocked = stage.locked && props.modules.find((item) => item.stage.locked)?.stage === stage;
          const blocker = firstLocked && stage.blocked_by ? track.stages.findIndex((candidate) => candidate.steps.some((step) => step.ref === stage.blocked_by)) : -1;
          // One status line per card: what's done, or what opens it.
          const status = stage.locked
            ? (blocker >= 0 ? `Opens after Module ${blocker + 1}` : "Locked")
            : done ? `All ${plural(stage.step_count, "lesson")} done`
            : stage.done_count ? `${stage.done_count} of ${plural(stage.step_count, "lesson")} done`
            : plural(stage.step_count, "lesson");
          return (
            <button key={stage.name} type="button" className={cx("tcard", "tmod", stage.locked && "tlocked")} onClick={onOpen} disabled={stage.locked}>
              <span className={cx("tcard-art")}>
                <ModuleArt stage={stage} index={index} />
              </span>
              <span className={cx("tcard-body")}>
                <span className={cx("tmod-eyebrow")}>Module {index + 1}</span>
                <b className={cx("tmod-title")}>{stage.name}</b>
                <span className={cx("tmod-status", done && "is-done")}>
                  <Icon name={stage.locked ? "lock" : done ? "check" : "book"} />{status}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodayCard(props: { track: CommunityTrackView; modules: readonly TrackModule[]; started: boolean; minutesOf: (id: string) => number | null; onContinue: () => void }) {
  const { track } = props;
  const next = track.next;
  if (!next) {
    return (
      <section className={cx("card ttoday")} aria-label="Today's step">
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
  const at = stage ? stage.steps.findIndex((step) => step.resource_id === next.resource_id) : -1;
  const upcoming = stage && at >= 0 ? stage.steps.slice(at + 1).filter((step) => !step.done).slice(0, 3) : [];
  return (
    <section className={cx("card ttoday")} aria-label="Today's step">
      <span className={cx("teyebrow")}>{props.started ? "Today's step" : "Start here"}{minutes ? ` · about ${formatTrackMinutes(minutes)}` : ""}</span>
      <h2>{next.title}</h2>
      <span className={cx("ttoday-note")}>{index >= 0 ? `Module ${index + 1} · ${next.stage}` : next.stage} · {track.title}</span>
      {stage ? (
        <ol className={cx("tpath")} aria-label={`${stage.done_count} of ${stage.step_count} lessons done in this module`}>
          {stage.steps.map((step) => <li key={step.ref} data-state={step.done ? "done" : step.resource_id === next.resource_id ? "here" : "todo"} title={step.title} />)}
        </ol>
      ) : null}
      {upcoming.length ? (
        <ol className={cx("tthen")}>
          <li className={cx("tthen-label")}>Then</li>
          {upcoming.map((step) => {
            const mins = props.minutesOf(step.resource_id);
            return <li key={step.ref}><Icon name="play" />{step.title}{mins ? <em>{formatTrackMinutes(mins)}</em> : null}</li>;
          })}
        </ol>
      ) : null}
      <span className={cx("ttoday-foot")}>
        <button type="button" className={cx("btn go tgo")} onClick={props.onContinue}>{props.started ? "Continue" : "Start"}<Icon name="arrow" /></button>
        <em>{stage ? (left <= 1 ? "Last lesson in this module" : `${left} lessons left in this module`) : ""}</em>
      </span>
    </section>
  );
}


