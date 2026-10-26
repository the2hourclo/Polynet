import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowDown, ArrowUp, Check, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  COMMUNITY_MAIN_TRACK_KEY,
  type CommunityTrackRule,
  type CommunityTrackStageDefinition,
  type CommunityTrackView,
} from "../../../../shared/communityLessonTracks";
import {
  fetchCloudCommunityLessonTracks,
  saveCloudCommunityLessonTrack,
  setCloudCommunityLessonTrackArchived,
  type CommunityBuilderTrack,
  type CommunityBuilderTracks,
} from "../../../../shared/cloudCommunityLessonTracksGateway";
import type { CommunityResource } from "./communityResourcesContracts";
import "./WebCommunityTracks.css";

// Knowledge → Roadmap with skill tracks (Rashid, 2026-10-26). One track shows
// the Roadmap board as before; several get a calm home: a Continue card, the
// member's tracks, and "Coming up" for tracks a checkpoint will open. The
// board itself is the Roadmap's own (WebCommunityLessonBoard), handed one
// track's lessons at a time.

/** One track's lessons in the lesson fields the board groups by. */
export function communityTrackResources(resources: readonly CommunityResource[], track: CommunityTrackView): CommunityResource[] {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return track.stages.flatMap((stage) => stage.steps.flatMap((step, index) => {
    const resource = byId.get(step.resource_id);
    if (!resource) return [];
    return [{
      ...resource,
      lesson: { ...(resource.lesson ?? {}), stage: stage.name, stage_order: stage.position, order: index + 1, gate: step.checkpoint || undefined },
    }];
  }));
}

/**
 * A track's stages after a Roadmap board save (rename, move or add), for every
 * track but the main one: each update puts its lesson in that stage at that
 * order; stages keep their order, with new ones placed by stageOrder.
 */
export function communityTrackStagesAfterBoardSave(
  stages: readonly CommunityTrackStageDefinition[],
  updates: ReadonlyArray<{ resourceId: string; stage: string; stageOrder?: number; order?: number }>,
): CommunityTrackStageDefinition[] {
  const moved = new Map(updates.map((update) => [update.resourceId, update]));
  const checkpoint = new Map(stages.flatMap((stage) => stage.steps).map((step) => [step.resource_id, step.checkpoint]));
  const rows = new Map<string, { position: number; steps: Array<{ id: string; order: number }> }>();
  stages.forEach((stage, index) => rows.set(stage.name, {
    position: index + 1,
    steps: stage.steps.filter((step) => !moved.has(step.resource_id)).map((step, at) => ({ id: step.resource_id, order: at + 1 })),
  }));
  for (const update of updates) {
    const row = rows.get(update.stage) ?? { position: update.stageOrder ?? rows.size + 1, steps: [] };
    if (update.stageOrder !== undefined) row.position = update.stageOrder;
    row.steps.push({ id: update.resourceId, order: update.order ?? row.steps.length + 1 });
    rows.set(update.stage, row);
  }
  return [...rows.entries()]
    .sort(([, left], [, right]) => left.position - right.position)
    .map(([name, row]) => ({
      name,
      steps: row.steps.sort((left, right) => left.order - right.order)
        .map((step) => ({ resource_id: step.id, ...(checkpoint.get(step.id) ? { checkpoint: true } : {}) })),
    }))
    .filter((stage) => stage.steps.length > 0);
}

/** The track a member most likely wants: the one they're in, else the first open one. */
export function communityContinueTrack(tracks: readonly CommunityTrackView[]) {
  return tracks.find((track) => track.status === "in_progress" && track.next)
    ?? tracks.find((track) => track.open && track.next)
    ?? null;
}

const ACTION_LABEL: Record<CommunityTrackView["status"], string> = { locked: "Locked", open: "Start", in_progress: "Continue", done: "Review" };

function TrackCover({ track }: { track: CommunityTrackView }) {
  if (track.cover_url) return <img className="track-card-cover" src={track.cover_url} alt="" />;
  // No cover yet: the track's initial on a soft tint of the community colour.
  return (
    <span className="track-card-cover" data-locked={track.open ? undefined : ""} aria-hidden="true">
      {track.open ? track.title.trim().charAt(0).toUpperCase() : <Lock size={18} />}
    </span>
  );
}

function TrackCard({ track, onOpen, onEdit }: { track: CommunityTrackView; onOpen: () => void; onEdit?: () => void }) {
  const percent = track.step_count ? Math.round((track.done_count / track.step_count) * 100) : 0;
  const meta = !track.open
    ? track.opens_reason
    : track.status === "done"
      ? `${track.step_count} lessons · all done`
      : track.status === "in_progress"
        ? `${track.done_count} of ${track.step_count} lessons done`
        : `${track.stages.length} ${track.stages.length === 1 ? "section" : "sections"} · ${track.step_count} lessons`;
  return (
    <li className="track-card" data-status={track.status}>
      <button type="button" className="track-card-main" onClick={onOpen}>
        <TrackCover track={track} />
        <span className="track-card-copy">
          <strong>{track.title}</strong>
          {track.summary && track.open ? <span className="track-card-summary">{track.summary}</span> : null}
          <span className="track-card-meta">{meta}</span>
          {track.status === "in_progress" ? <span className="track-card-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span> : null}
        </span>
        <span className="track-card-action">
          {track.status === "done" ? <Check size={15} aria-hidden="true" /> : track.open ? null : <Lock size={14} aria-hidden="true" />}
          {ACTION_LABEL[track.status]}
          {track.open ? <ArrowRight size={15} aria-hidden="true" /> : null}
        </span>
      </button>
      {onEdit ? (
        <button type="button" className="track-card-edit" onClick={onEdit} aria-label={`Edit ${track.title}`}><Pencil size={14} /></button>
      ) : null}
    </li>
  );
}

/** Several tracks: Continue, your tracks, and what's coming up. */
export function WebCommunityTrackHome(props: {
  tracks: readonly CommunityTrackView[];
  onOpenTrack: (key: string) => void;
  canManage?: boolean;
  onNewTrack?: () => void;
  onEditTrack?: (key: string) => void;
}) {
  const current = communityContinueTrack(props.tracks);
  const yours = props.tracks.filter((track) => track.open);
  const coming = props.tracks.filter((track) => !track.open);
  const edit = props.canManage && props.onEditTrack ? props.onEditTrack : undefined;
  return (
    <div className="track-home">
      {current?.next ? (
        <button type="button" className="track-continue" onClick={() => props.onOpenTrack(current.key)}>
          <span>
            <small>{current.status === "in_progress" ? "Pick up where you left off" : "Start here"}</small>
            <strong>{current.next.title}</strong>
            <em>{current.title} · {current.next.stage}</em>
          </span>
          <span className="track-continue-go">{current.status === "in_progress" ? "Continue" : "Start"} <ArrowRight size={16} /></span>
        </button>
      ) : null}
      <section className="track-group" aria-label="Your tracks">
        <div className="track-group-head">
          <h2>Your tracks</h2>
          {props.canManage && props.onNewTrack ? (
            <button type="button" className="track-new" onClick={props.onNewTrack}><Plus size={14} /> New track</button>
          ) : null}
        </div>
        <ul className="track-list">
          {yours.map((track) => (
            <TrackCard key={track.key} track={track} onOpen={() => props.onOpenTrack(track.key)} onEdit={edit ? () => edit(track.key) : undefined} />
          ))}
        </ul>
      </section>
      {coming.length ? (
        <section className="track-group" aria-label="Coming up">
          <div className="track-group-head"><h2>Coming up</h2></div>
          <ul className="track-list">
            {coming.map((track) => (
              <TrackCard key={track.key} track={track} onOpen={() => props.onOpenTrack(track.key)} onEdit={edit ? () => edit(track.key) : undefined} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Above one track's board: back to all tracks, the picker, and the track's title. */
export function WebCommunityTrackHeader(props: {
  tracks: readonly CommunityTrackView[];
  track: CommunityTrackView;
  onPick: (key: string) => void;
  onHome: () => void;
  onEdit?: () => void;
  onNewTrack?: () => void;
}) {
  const { track } = props;
  return (
    <div className="track-header">
      {props.tracks.length > 1 ? (
        <nav className="track-picker" aria-label="Tracks">
          <button type="button" className="track-picker-home" onClick={props.onHome}><ArrowLeft size={14} /> All tracks</button>
          {props.tracks.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              aria-current={candidate.key === track.key ? "true" : undefined}
              onClick={() => props.onPick(candidate.key)}
            >
              {candidate.open ? null : <Lock size={12} aria-label="Locked" />}
              {candidate.title}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="track-title">
        <h2>{track.title}</h2>
        {props.onEdit || props.onNewTrack ? (
          <span className="track-title-actions">
            {props.onEdit ? <button type="button" className="track-title-edit" onClick={props.onEdit}><Pencil size={14} /> Edit track</button> : null}
            {props.onNewTrack ? <button type="button" className="track-title-edit" onClick={props.onNewTrack}><Plus size={14} /> New track</button> : null}
          </span>
        ) : null}
      </div>
      {track.summary ? <p className="track-summary">{track.summary}</p> : null}
    </div>
  );
}

/** A track that isn't open yet: what opens it and what's inside, nothing to start. */
export function WebCommunityTrackLocked({ track }: { track: CommunityTrackView }) {
  return (
    <div className="track-locked">
      <p className="track-locked-reason"><Lock size={16} /> {track.opens_reason}</p>
      <ol className="track-locked-stages">
        {track.stages.map((stage) => (
          <li key={stage.name}>
            <span className="track-locked-dot">{stage.position}</span>
            <span><strong>{stage.name}</strong><em>{stage.step_count} {stage.step_count === 1 ? "step" : "steps"}</em></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Below a track's board: the tracks its checkpoints open. */
export function WebCommunityTrackOpens(props: { track: CommunityTrackView; tracks: readonly CommunityTrackView[]; onOpenTrack: (key: string) => void }) {
  const targets = props.track.opens_tracks
    .map((link) => ({ link, target: props.tracks.find((candidate) => candidate.key === link.track) }))
    .filter((entry): entry is { link: typeof entry.link; target: CommunityTrackView } => Boolean(entry.target));
  if (!targets.length) return null;
  const titleOf = (resourceId: string) => props.track.stages.flatMap((stage) => stage.steps).find((step) => step.resource_id === resourceId)?.title;
  return (
    <section className="track-opens" aria-label="What this track opens">
      <h3>What this track opens</h3>
      <ul>
        {targets.map(({ link, target }) => (
          <li key={`${link.resource_id}:${target.key}`} data-open={target.open ? "" : undefined}>
            <button type="button" onClick={() => props.onOpenTrack(target.key)}>
              <strong>{target.title}</strong>
              <span>{target.open ? `Open now · ${target.step_count} steps` : <><Lock size={12} /> After "{titleOf(link.resource_id) ?? "a checkpoint"}"</>}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- owner editing ----------

type RuleType = CommunityTrackRule["type"];
const RULE_LABEL: Record<RuleType, string> = {
  after_checkpoint: "After a lesson is done",
  after_track: "After a track is finished",
  workflow_stage: "When they reach a Workflow stage",
  client_property: "When a client property is",
};

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "track";

function blankRule(type: RuleType, data: CommunityBuilderTracks, selfKey: string): CommunityTrackRule {
  if (type === "after_track") return { type, track: data.tracks.find((track) => track.key !== selfKey)?.key ?? "" };
  if (type === "workflow_stage") return { type, milestone_key: data.workflow_stages[0]?.key ?? "" };
  if (type === "client_property") return { type, property: data.client_properties[0]?.key ?? "", equals: "" };
  return { type, resource_id: data.lessons[0]?.id ?? "" };
}

/**
 * Create or change a track: its title, what opens it, and (for every track but
 * the main roadmap, whose stages are edited right on the board) its stages and
 * steps. Saves the whole track, the same save the agent's community.track.save makes.
 */
export function WebCommunityTrackEditor<SessionT>(props: {
  session: SessionT;
  communityId: string;
  trackKey: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<CommunityBuilderTracks | null>(null);
  const [draft, setDraft] = useState<CommunityBuilderTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = props.trackKey === null;

  useEffect(() => {
    let cancelled = false;
    fetchCloudCommunityLessonTracks({ session: props.session, communityId: props.communityId })
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        const existing = loaded.tracks.find((track) => track.key === props.trackKey);
        setDraft(existing ?? {
          key: "", title: "", summary: "", order: loaded.tracks.length, show: "always", opens_when: [],
          stages: [{ name: "Section 1", steps: [] }], revision: 0, derived: false,
        });
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Tracks are unavailable."); });
    return () => { cancelled = true; };
  }, [props.session, props.communityId, props.trackKey]);

  const lessonTitle = useMemo(() => new Map((data?.lessons ?? []).map((lesson) => [lesson.id, lesson.title])), [data]);
  if (!data || !draft) {
    return (
      <div className="track-editor-backdrop" role="dialog" aria-modal="true" aria-label="Edit track">
        <div className="track-editor"><p>{error ?? "Loading…"}</p><button type="button" onClick={props.onClose}>Close</button></div>
      </div>
    );
  }
  const isMain = draft.key === COMMUNITY_MAIN_TRACK_KEY;
  const editsStages = !isMain || !draft.derived;
  const update = (patch: Partial<CommunityBuilderTrack>) => setDraft({ ...draft, ...patch });
  const setStages = (stages: CommunityTrackStageDefinition[]) => update({ stages });
  const setRule = (index: number, rule: CommunityTrackRule) => update({ opens_when: draft.opens_when.map((current, i) => (i === index ? rule : current)) });
  const used = new Set(draft.stages.flatMap((stage) => stage.steps.map((step) => step.resource_id)));
  const move = <T,>(rows: T[], from: number, to: number) => {
    if (to < 0 || to >= rows.length) return rows;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    return next;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const key = isNew ? `${slug(draft.title)}${data.tracks.some((track) => track.key === slug(draft.title)) ? `-${Date.now() % 1000}` : ""}` : draft.key;
    try {
      await saveCloudCommunityLessonTrack({
        session: props.session, communityId: props.communityId, key, expectedRevision: draft.revision,
        title: draft.title, summary: draft.summary ?? null, show: draft.show, opensWhen: draft.opens_when,
        // The main roadmap keeps reading its stages from the lessons until it has its own.
        stages: isMain && draft.derived ? [] : draft.stages.filter((stage) => stage.steps.length > 0),
      });
      props.onSaved();
      props.onClose();
    } catch (caught: any) {
      const problems: string[] | undefined = caught?.data?.problems;
      setError(problems?.join(" ") ?? (caught?.data?.code === "track_revision_conflict"
        ? "Someone changed this track since you opened it. Close and open it again."
        : caught instanceof Error ? caught.message : "The track couldn't be saved."));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      await setCloudCommunityLessonTrackArchived({ session: props.session, communityId: props.communityId, key: draft.key, archived: true });
      props.onSaved();
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The track couldn't be archived.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="track-editor-backdrop" role="dialog" aria-modal="true" aria-label={isNew ? "New track" : `Edit ${draft.title}`}>
      <form className="track-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header>
          <h2>{isNew ? "New track" : "Edit track"}</h2>
          <button type="button" className="track-editor-close" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <label className="track-field">
          <span>Title</span>
          <input id="track-title" value={draft.title} onChange={(event) => update({ title: event.target.value })} placeholder="Content Employee" required maxLength={120} />
        </label>
        <label className="track-field">
          <span>Summary <em>optional</em></span>
          <textarea id="track-summary" rows={2} value={draft.summary ?? ""} onChange={(event) => update({ summary: event.target.value })} maxLength={600} />
        </label>

        <fieldset className="track-fieldset">
          <legend>Opens when</legend>
          {draft.opens_when.length === 0 ? <p className="track-hint">Open from the start.</p> : null}
          {draft.opens_when.map((rule, index) => (
            <div className="track-rule" key={index}>
              <select aria-label="Rule" value={rule.type} onChange={(event) => setRule(index, blankRule(event.target.value as RuleType, data, draft.key))}>
                {(Object.keys(RULE_LABEL) as RuleType[]).map((type) => <option key={type} value={type}>{RULE_LABEL[type]}</option>)}
              </select>
              {rule.type === "after_checkpoint" ? (
                <select aria-label="Lesson" value={rule.resource_id} onChange={(event) => setRule(index, { ...rule, resource_id: event.target.value })}>
                  {data.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
                </select>
              ) : rule.type === "after_track" ? (
                <select aria-label="Track" value={rule.track} onChange={(event) => setRule(index, { ...rule, track: event.target.value })}>
                  {data.tracks.filter((track) => track.key !== draft.key).map((track) => <option key={track.key} value={track.key}>{track.title}</option>)}
                </select>
              ) : rule.type === "workflow_stage" ? (
                <select aria-label="Workflow stage" value={rule.milestone_key} onChange={(event) => setRule(index, { ...rule, milestone_key: event.target.value })}>
                  {data.workflow_stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
                </select>
              ) : (
                <span className="track-rule-pair">
                  <select aria-label="Client property" value={rule.property} onChange={(event) => setRule(index, { ...rule, property: event.target.value })}>
                    {data.client_properties.map((property) => <option key={property.key} value={property.key}>{property.name}</option>)}
                  </select>
                  <input aria-label="Value" value={String(rule.equals)} onChange={(event) => setRule(index, { ...rule, equals: event.target.value })} />
                </span>
              )}
              <button type="button" className="track-icon" aria-label="Remove rule" onClick={() => update({ opens_when: draft.opens_when.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="track-add" onClick={() => update({ opens_when: [...draft.opens_when, blankRule("after_checkpoint", data, draft.key)] })}>
            <Plus size={14} /> Add a rule
          </button>
          <label className="track-check">
            <input type="checkbox" checked={draft.show === "when_open"} onChange={(event) => update({ show: event.target.checked ? "when_open" : "always" })} />
            Hide it until it opens (otherwise members see it under "Coming up")
          </label>
        </fieldset>

        {editsStages ? (
          <fieldset className="track-fieldset">
            <legend>Sections and lessons</legend>
            {draft.stages.map((stage, stageIndex) => (
              <div className="track-stage" key={stageIndex}>
                <div className="track-stage-head">
                  <span className="track-stage-number">{stageIndex + 1}</span>
                  <input aria-label="Section name" value={stage.name} onChange={(event) => setStages(draft.stages.map((current, i) => (i === stageIndex ? { ...current, name: event.target.value } : current)))} />
                  <button type="button" className="track-icon" aria-label="Move stage up" onClick={() => setStages(move(draft.stages, stageIndex, stageIndex - 1))}><ArrowUp size={14} /></button>
                  <button type="button" className="track-icon" aria-label="Move stage down" onClick={() => setStages(move(draft.stages, stageIndex, stageIndex + 1))}><ArrowDown size={14} /></button>
                  <button type="button" className="track-icon" aria-label="Remove stage" onClick={() => setStages(draft.stages.filter((_, i) => i !== stageIndex))}><Trash2 size={14} /></button>
                </div>
                <ol className="track-steps">
                  {stage.steps.map((step, stepIndex) => {
                    const setSteps = (steps: typeof stage.steps) => setStages(draft.stages.map((current, i) => (i === stageIndex ? { ...current, steps } : current)));
                    return (
                      <li key={step.resource_id}>
                        <span className="track-step-title">{lessonTitle.get(step.resource_id) ?? "Missing lesson"}</span>
                        <label className="track-step-check">
                          <input type="checkbox" checked={Boolean(step.checkpoint)}
                            onChange={(event) => setSteps(stage.steps.map((current, i) => (i === stepIndex ? { ...current, checkpoint: event.target.checked || undefined } : current)))} />
                          Checkpoint
                        </label>
                        <button type="button" className="track-icon" aria-label="Move up" onClick={() => setSteps(move(stage.steps, stepIndex, stepIndex - 1))}><ArrowUp size={14} /></button>
                        <button type="button" className="track-icon" aria-label="Move down" onClick={() => setSteps(move(stage.steps, stepIndex, stepIndex + 1))}><ArrowDown size={14} /></button>
                        <button type="button" className="track-icon" aria-label="Remove step" onClick={() => setSteps(stage.steps.filter((_, i) => i !== stepIndex))}><Trash2 size={14} /></button>
                      </li>
                    );
                  })}
                </ol>
                <select
                  className="track-add-lesson"
                  aria-label="Add a lesson"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setStages(draft.stages.map((current, i) => (i === stageIndex ? { ...current, steps: [...current.steps, { resource_id: event.target.value }] } : current)));
                  }}
                >
                  <option value="">+ Add a lesson from the library…</option>
                  {data.lessons.filter((lesson) => !used.has(lesson.id)).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
                </select>
              </div>
            ))}
            <button type="button" className="track-add" onClick={() => setStages([...draft.stages, { name: `Section ${draft.stages.length + 1}`, steps: [] }])}>
              <Plus size={14} /> Add a section
            </button>
            <p className="track-hint">A lesson can be in several tracks. Members who finished it in one track have it done in all of them.</p>
          </fieldset>
        ) : (
          <p className="track-hint">This is your main roadmap. Edit its stages and lessons right on the board.</p>
        )}

        {error ? <p className="track-error" role="alert">{error}</p> : null}
        <footer>
          {!isNew && !isMain ? <button type="button" className="track-archive" onClick={() => void archive()} disabled={saving}>Archive track</button> : <span />}
          <span className="track-footer-actions">
            <button type="button" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="track-save" disabled={saving || !draft.title.trim()}>{saving ? "Saving…" : "Save track"}</button>
          </span>
        </footer>
      </form>
    </div>
  );
}
