import { useCallback, useEffect, useState } from "react";
import type { CommunityLessonProgressStatus } from "../../../../shared/communityLessonContract";
import {
  fetchCloudOwnResourceProgress,
  setCloudOwnResourceProgress,
  type CommunityResourceProgressState,
} from "../../../../shared/cloudCommunityResourceProgressGateway";

export type WebCommunityLessonProgress = {
  /** Status by lesson ref; a lesson with no entry is not started. */
  statusByRef: Readonly<Record<string, CommunityLessonProgressStatus>>;
  loaded: boolean;
  error: string | null;
  setStatus: (resourceId: string, ref: string, status: CommunityLessonProgressStatus) => void;
};

/**
 * The signed-in member's own lesson progress for one community, read from and
 * written to the same store the site SDK's progress()/setProgress() use. Writes
 * show at once and are put back if the server refuses them (a locked lesson).
 */
export function useWebCommunityLessonProgress<SessionT>(params: {
  communityId: string | null;
  session: SessionT | null;
}): WebCommunityLessonProgress {
  const { communityId, session } = params;
  const [state, setState] = useState<{ communityId: string; statusByRef: Record<string, CommunityLessonProgressStatus> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!communityId || !session) return () => {};
    let cancelled = false;
    fetchCloudOwnResourceProgress({ session, communityId })
      .then((progress: CommunityResourceProgressState) => {
        if (cancelled) return;
        setState({ communityId, statusByRef: Object.fromEntries(progress.lessons.map((lesson) => [lesson.ref, lesson.status])) });
        setError(null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Progress is unavailable.");
      });
    return () => { cancelled = true; };
  }, [communityId, session]);

  useEffect(() => load(), [load]);

  const setStatus = useCallback((resourceId: string, ref: string, status: CommunityLessonProgressStatus) => {
    if (!communityId || !session) return;
    let previous: CommunityLessonProgressStatus | undefined;
    setState((current) => {
      const statusByRef = { ...(current?.communityId === communityId ? current.statusByRef : {}) };
      previous = statusByRef[ref];
      statusByRef[ref] = status;
      return { communityId, statusByRef };
    });
    setCloudOwnResourceProgress({ session, communityId, resourceId, status })
      .then((result) => {
        if (result.ok) return;
        setError(result.message);
        setState((current) => {
          if (!current || current.communityId !== communityId) return current;
          const statusByRef = { ...current.statusByRef };
          if (previous) statusByRef[ref] = previous; else delete statusByRef[ref];
          return { communityId, statusByRef };
        });
      })
      .catch(() => { load(); });
  }, [communityId, session, load]);

  const current = state && state.communityId === communityId ? state : null;
  return { statusByRef: current?.statusByRef ?? {}, loaded: Boolean(current), error, setStatus };
}
