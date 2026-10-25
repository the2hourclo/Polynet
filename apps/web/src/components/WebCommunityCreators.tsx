import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { createConvexClient } from "../../../../shared/convexAuthenticatedClient";
import { UserAvatar } from "../../../../shared/UserAvatar";
import "./WebCommunityCreators.css";

type Creator = {
  user_id: string;
  role: "owner" | "co_creator";
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_focus_x: number;
  avatar_focus_y: number;
  avatar_zoom: number;
};

// Last result per community, so switching tabs doesn't flash an empty row.
const cache = new Map<string, Creator[]>();

// Fired after the owner changes who the co-creators are, so rows refresh.
export const COMMUNITY_CREATORS_CHANGED_EVENT = "polynet:community-creators-changed";

function creatorName(creator: Creator): string {
  return creator.display_name?.trim() || (creator.handle ? `@${creator.handle}` : "Creator");
}

function initials(name: string): string {
  return name.replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

// "Created by": the owner first, then the co-creators the owner added. Shown
// under the community's name in Channels, on its card in Classroom and on
// About (Rashid, 2026-10-25).
export function WebCommunityCreators(props: { communityId: string | null | undefined; onOpenProfile?: (userId: string) => void; className?: string }) {
  const communityId = props.communityId ?? null;
  const [creators, setCreators] = useState<Creator[]>(() => (communityId ? cache.get(communityId) ?? [] : []));
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const onChanged = () => setReload((value) => value + 1);
    window.addEventListener(COMMUNITY_CREATORS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COMMUNITY_CREATORS_CHANGED_EVENT, onChanged);
  }, []);
  useEffect(() => {
    if (!communityId) return;
    let alive = true;
    setCreators(cache.get(communityId) ?? []);
    createConvexClient().query(api.communityPublic.listCommunityCreators, { communityId: communityId as Id<"communities"> })
      .then((result) => {
        const rows = ((result as { creators?: Creator[] }).creators ?? []).filter((row) => row.display_name || row.handle);
        cache.set(communityId, rows);
        if (alive) setCreators(rows);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [communityId, reload]);
  if (!creators.length) return null;
  const names = creators.map(creatorName);
  const label = creators.length === 1 ? "Creator" : "Creators";
  return (
    <div className={`community-creators${props.className ? ` ${props.className}` : ""}`} aria-label={`${label}: ${names.join(", ")}`} role="group">
      <span className="community-creators-faces" aria-hidden="true">
        {creators.slice(0, 4).map((creator, index) => (
          <UserAvatar
            key={creator.user_id}
            className="community-creators-avatar"
            readyClassName="has-image"
            imageClassName="community-creators-avatar-image"
            fallbackClassName="community-creators-avatar-fallback"
            name={names[index]!}
            imageUrl={creator.avatar_url}
            focusX={creator.avatar_focus_x}
            focusY={creator.avatar_focus_y}
            zoom={creator.avatar_zoom}
            fallback={<span>{initials(names[index]!)}</span>}
            alt=""
            aria-hidden={true}
          />
        ))}
      </span>
      <span className="community-creators-text">
        <span className="community-creators-label">{label}</span>
        <span className="community-creators-names">
          {creators.map((creator, index) => (
            <span key={creator.user_id}>
              {index > 0 ? (index === creators.length - 1 ? " & " : ", ") : null}
              {props.onOpenProfile ? (
                <button type="button" className="community-creators-name" onClick={() => props.onOpenProfile!(creator.user_id)}>{names[index]}</button>
              ) : (
                <span className="community-creators-name">{names[index]}</span>
              )}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
