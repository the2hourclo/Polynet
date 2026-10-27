import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Image as ImageIcon, Lock, Pin, Play } from "lucide-react";
import type { CommunityInteractionRootBundle } from "../../../../shared/cloudCommunityInteractionsGateway";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "../../../../shared/convexAuthenticatedClient";
import { communityPresenceLeaseIsActive } from "../../../../shared/communityPresenceContract";
import { CommunityAgentIcon, useCommunityAgentName } from "../../../../shared/CommunityAgentIcon";
import { MemberAvatarStack, type MemberAvatarStackFace } from "./MemberAvatarStack";
import { useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import "./WebCommunityPods.css";

// Pods (Rashid, 2026-10-26): in Classroom, a member's invite-only channels are
// pods, not topic chips. Each shows the faces of everyone who can see it, so
// it reads as a small private room. The owner picks where they sit in
// Customize (theme pods_place): the top of the right column or the header.
// Opening one turns the chat into the pod's room (WebCommunityPodRoom).

export type CommunityPod = { id: string; slug: string; name: string; is_general: boolean; position: number; access_mode?: "all_members" | "restricted" };

export type WebCommunityPodsFrame = {
  place: "aside" | "header";
  pods: CommunityPod[];
  unread: Record<string, boolean>;
  selectedSlug: string | null;
  onOpen: (pod: CommunityPod) => void;
  onLeave: () => void;
};

type PodPerson = {
  user_id: string;
  role: "owner" | "admin" | "member";
  profile: { display_name: string | null; avatar_url: string | null; avatar_focus_x: number; avatar_focus_y: number; avatar_zoom: number };
  last_seen_at: number | null;
  active_until: number | null;
};
type PodPeople = { channel_id: string; people: PodPerson[]; people_count: number; agent: boolean };

const REFRESH_MS = 45_000;
// The pods list shows this many before "Show all".
const COLLAPSED_PODS = 5;
// Last answer per community and pod, so moving between tabs doesn't flash empty faces.
const peopleCache = new Map<string, PodPeople>();

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "?";
}

function personName(person: PodPerson): string {
  return person.profile.display_name?.trim() || "Member";
}

function isOnline(person: PodPerson, now: number): boolean {
  return person.last_seen_at !== null
    && communityPresenceLeaseIsActive({ lastSeenAt: person.last_seen_at, activeUntil: person.active_until ?? undefined }, now);
}

function faces(people: PodPerson[]): MemberAvatarStackFace[] {
  return people.map((person) => ({
    user_id: person.user_id,
    display_name: personName(person),
    avatar_url: person.profile.avatar_url,
    avatar_focus_x: person.profile.avatar_focus_x,
    avatar_focus_y: person.profile.avatar_focus_y,
    avatar_zoom: person.profile.avatar_zoom,
    initials: initials(personName(person)),
  }));
}

/** Who can see each pod, refreshed while the pods are on screen. */
function usePodPeople(podIds: string[]): Record<string, PodPeople> {
  const frame = useWebCommunityFrame();
  const communityId = frame.community?.id ?? null;
  const session = frame.session;
  const key = podIds.join(",");
  const read = () => Object.fromEntries(podIds.flatMap((id) => {
    const cached = peopleCache.get(`${communityId}:${id}`);
    return cached ? [[id, cached]] : [];
  }));
  const [people, setPeople] = useState<Record<string, PodPeople>>(read);
  useEffect(() => {
    setPeople(read());
    if (!communityId || !session || podIds.length === 0) return;
    let alive = true;
    const load = async () => {
      try {
        const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
        const result = await client.query(api.communityPods.listPodPeople, {
          authSubject,
          communityId: communityId as Id<"communities">,
          channelIds: podIds as Id<"communityChannels">[],
        });
        for (const pod of result.pods as PodPeople[]) peopleCache.set(`${communityId}:${pod.channel_id}`, pod);
        if (alive) setPeople(read());
      } catch {
        // Faces are a nicety: the pod still opens without them.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [communityId, session, key]);
  return people;
}

function PodFaces({ people, agent, size }: { people?: PodPeople; agent?: boolean; size: "small" | "large" }) {
  const now = Date.now();
  const online = new Set((people?.people ?? []).filter((person) => isOnline(person, now)).map((person) => person.user_id));
  return (
    <span className={`community-pod-faces is-${size}`}>
      <MemberAvatarStack
        faces={faces(people?.people ?? [])}
        totalCount={people?.people_count}
        isLoading={!people}
        limit={size === "small" ? 3 : 6}
        decorative={size === "small"}
      />
      {online.size > 0 ? <span className="community-pod-live" aria-label={`${online.size} here now`} /> : null}
      {agent && people?.agent ? <span className="community-pod-agent" aria-hidden="true"><CommunityAgentIcon size={size === "small" ? 12 : 14} /></span> : null}
    </span>
  );
}

function podSummary(people: PodPeople | undefined, agentName: string): string {
  if (!people) return "Private";
  const now = Date.now();
  const here = people.people.filter((person) => isOnline(person, now));
  const count = `${people.people_count} ${people.people_count === 1 ? "person" : "people"}${people.agent ? ` + ${agentName}` : ""}`;
  if (here.length === 1) return `${count} · ${personName(here[0]!)} is here`;
  if (here.length > 1) return `${count} · ${here.length} here now`;
  return count;
}

function PodRow({ pod, people, selected, unread, onOpen }: { pod: CommunityPod; people?: PodPeople; selected: boolean; unread: boolean; onOpen: () => void }) {
  const agentName = useCommunityAgentName("the agent");
  return (
    <li>
      <button type="button" className={`community-pod-row${selected ? " is-selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={onOpen}>
        <PodFaces people={people} agent size="small" />
        <span className="community-pod-row-text">
          <span className="community-pod-row-name">
            <span>{pod.name}</span>
            <Lock size={12} aria-label="Private" />
          </span>
          <span className="community-pod-row-meta">{podSummary(people, agentName)}</span>
        </span>
        {unread && !selected ? <span className="community-pod-unread" aria-label="New messages" /> : null}
      </button>
    </li>
  );
}

function PodList({ pods, onPicked }: { pods: WebCommunityPodsFrame; onPicked?: () => void }) {
  const [showAll, setShowAll] = useState(false);
  // Pods with something new come first, then the community's own order.
  const ordered = [...pods.pods].sort((a, b) => Number(Boolean(pods.unread[b.slug])) - Number(Boolean(pods.unread[a.slug])) || a.position - b.position);
  const visible = showAll ? ordered : ordered.slice(0, COLLAPSED_PODS);
  const people = usePodPeople(visible.map((pod) => pod.id));
  return (
    <>
      <ul className="community-pod-list">
        {visible.map((pod) => (
          <PodRow
            key={pod.id}
            pod={pod}
            people={people[pod.id]}
            selected={pods.selectedSlug === pod.slug}
            unread={Boolean(pods.unread[pod.slug])}
            onOpen={() => {
              pods.onOpen(pod);
              onPicked?.();
            }}
          />
        ))}
      </ul>
      {ordered.length > COLLAPSED_PODS ? (
        <button type="button" className="community-aside-link community-pod-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer" : `Show all ${ordered.length}`}
        </button>
      ) : null}
    </>
  );
}

/** "Your pods" at the top of the right column. */
export function WebCommunityPodsCard({ pods }: { pods: WebCommunityPodsFrame }) {
  if (pods.place !== "aside" || pods.pods.length === 0) return null;
  return (
    <section className="community-aside-card community-pods-card" aria-label="Your pods">
      <div className="community-aside-card-header">
        <h2>Your pods</h2>
        <span className="community-pods-card-note"><Lock size={12} aria-hidden="true" /> Private</span>
      </div>
      <PodList pods={pods} />
    </section>
  );
}

/** The header's stack of pod faces, opening the same list. In "aside" mode it
 *  only shows where the right column is hidden (narrow windows). */
export function WebCommunityPodsButton({ pods }: { pods: WebCommunityPodsFrame }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const firstPeople = usePodPeople(pods.pods.slice(0, 3).map((pod) => pod.id));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (pods.pods.length === 0) return null;
  const unread = pods.pods.filter((pod) => pods.unread[pod.slug]).length;
  // One face from each of the first pods: the people a member knows best.
  const seen = new Set<string>();
  const leadPeople = pods.pods.slice(0, 3).flatMap((pod) => {
    const person = firstPeople[pod.id]?.people.find((candidate) => !seen.has(candidate.user_id));
    if (!person) return [];
    seen.add(person.user_id);
    return [person];
  });
  return (
    <div className={`community-pods-button-wrap is-${pods.place}`} ref={ref}>
      <button
        type="button"
        className={`community-pods-button${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Your pods${unread ? `, ${unread} with new messages` : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        {leadPeople.length > 0 ? (
          <MemberAvatarStack faces={faces(leadPeople)} limit={3} decorative className="community-pods-button-faces" />
        ) : <Lock size={14} aria-hidden="true" />}
        <span>Pods</span>
        {unread ? <span className="community-pods-button-count">{unread}</span> : null}
      </button>
      {open ? (
        <div className="community-pods-popover" role="dialog" aria-label="Your pods">
          <div className="community-pods-popover-head">
            <strong>Your pods</strong>
            <span className="community-pods-card-note"><Lock size={12} aria-hidden="true" /> Only the people in each pod see it</span>
          </div>
          <PodList pods={pods} onPicked={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** The band across the top of an open pod: who's in the room, and who can see it. */
export function WebCommunityPodRoomHead({ pods, podId }: { pods: WebCommunityPodsFrame; podId: string }) {
  const pod = pods.pods.find((candidate) => candidate.id === podId);
  const people = usePodPeople(pod ? [pod.id] : [])[podId];
  const agentName = useCommunityAgentName("the agent");
  if (!pod) return null;
  const names = (people?.people ?? []).map(personName);
  const listed = names.length <= 4 ? names : [...names.slice(0, 3), `${people!.people_count - 3} others`];
  const withAgent = people?.agent ? [...listed, agentName] : listed;
  const audience = withAgent.length > 1 ? `${withAgent.slice(0, -1).join(", ")} and ${withAgent.at(-1)}` : withAgent[0] ?? "";
  return (
    <div className="community-pod-room-head">
      <button type="button" className="community-pod-room-back" onClick={pods.onLeave}>
        <ArrowLeft size={14} aria-hidden="true" /> Community
      </button>
      <div className="community-pod-room-identity">
        <PodFaces people={people} agent size="large" />
        <div className="community-pod-room-title">
          <h1>{pod.name}</h1>
          <p className="community-pod-room-privacy">
            <Lock size={12} aria-hidden="true" />
            {people ? <span>Only {audience} can see this pod</span> : <span>Private pod</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

// The shelf under a pod's chat: its pinned post, then every file and video
// shared in it. A channel's own features with a pod's layout; each item opens
// the post it came from, where the file plays or downloads as usual.

type ShelfItem = {
  root_id: string; id: string; kind: "file" | "image" | "video"; name: string; mime: string | null;
  size: number | null; image_url: string | null; provider: string | null; author_name: string | null; created_at: string;
};
type Shelf = { pinned_root_id: string | null; files: ShelfItem[]; videos: ShelfItem[] };
type ShelfTab = "pinned" | "files" | "videos";

function usePodShelf(podId: string, refreshKey: string): Shelf | null {
  const frame = useWebCommunityFrame();
  const communityId = frame.community?.id ?? null;
  const session = frame.session;
  const [shelf, setShelf] = useState<Shelf | null>(null);
  useEffect(() => {
    if (!communityId || !session) return;
    let alive = true;
    void (async () => {
      try {
        const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
        const result = await client.query(api.communityPods.listPodShelf, {
          authSubject,
          communityId: communityId as Id<"communities">,
          channelId: podId as Id<"communityChannels">,
        });
        if (alive) setShelf(result as Shelf);
      } catch {
        if (alive) setShelf({ pinned_root_id: null, files: [], videos: [] });
      }
    })();
    return () => { alive = false; };
  }, [communityId, session, podId, refreshKey]);
  return shelf;
}

function shelfSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shelfDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shelfMeta(item: ShelfItem, agentName: string): string {
  return [item.author_name ?? agentName, shelfDate(item.created_at), item.provider ?? shelfSize(item.size)].filter(Boolean).join(" · ");
}

export function WebCommunityPodShelf(props: {
  podId: string;
  podName: string;
  pinnedRoot: CommunityInteractionRootBundle | null | undefined;
  roots: CommunityInteractionRootBundle[];
  onOpenPost: (rootId: string) => void;
}) {
  const agentName = useCommunityAgentName("the agent");
  // New posts and a changed pin refresh the shelf.
  const refreshKey = `${props.roots.length}:${props.roots[0]?.root.id ?? ""}:${props.roots[0]?.root.updated_at ?? ""}:${props.pinnedRoot?.root.id ?? ""}`;
  const shelf = usePodShelf(props.podId, refreshKey);
  const [tab, setTab] = useState<ShelfTab>("pinned");
  const files = shelf?.files ?? [];
  const videos = shelf?.videos ?? [];
  const pinned = props.pinnedRoot ?? null;
  const tabs: Array<{ id: ShelfTab; label: string; count: number }> = [
    { id: "pinned", label: "Pinned", count: pinned ? 1 : 0 },
    { id: "files", label: "Files", count: files.length },
    { id: "videos", label: "Videos", count: videos.length },
  ];
  return (
    <section className="community-pod-shelf" aria-label={`Saved in ${props.podName}`}>
      <header className="community-pod-shelf-head">
        <h2>Saved in this pod</h2>
        <div className="community-pod-shelf-tabs" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "is-active" : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}{entry.count ? <span>{entry.count}</span> : null}
            </button>
          ))}
        </div>
      </header>
      {tab === "pinned" ? (
        pinned ? (
          <button type="button" className="community-pod-shelf-pinned" onClick={() => props.onOpenPost(pinned.root.id)}>
            <Pin size={16} aria-hidden="true" />
            <span className="community-pod-shelf-pinned-text">
              <strong>{pinned.root.title || pinned.root.content_summary || "Pinned post"}</strong>
              {pinned.root.title && pinned.root.content_summary ? <span>{pinned.root.content_summary}</span> : null}
            </span>
          </button>
        ) : (
          <p className="community-pod-shelf-empty">Nothing pinned yet. Pin a message from its ⋯ menu and it stays here.</p>
        )
      ) : null}
      {tab === "files" ? (
        files.length ? (
          <ul className="community-pod-shelf-files">
            {files.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => props.onOpenPost(item.root_id)}>
                  <span className="community-pod-shelf-icon" aria-hidden="true">
                    {item.kind === "image" ? <ImageIcon size={16} /> : <FileText size={16} />}
                  </span>
                  <span className="community-pod-shelf-file-text">
                    <strong>{item.name}</strong>
                    <span>{shelfMeta(item, agentName)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="community-pod-shelf-empty">Files shared in this pod collect here. Add one with + in the message box.</p>
        )
      ) : null}
      {tab === "videos" ? (
        videos.length ? (
          <ul className="community-pod-shelf-videos">
            {videos.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => props.onOpenPost(item.root_id)}>
                  <span className="community-pod-shelf-thumb" style={item.image_url ? { backgroundImage: `url("${item.image_url.replace(/"/g, "%22")}")` } : undefined}>
                    <Play size={18} aria-hidden="true" />
                  </span>
                  <strong>{item.name}</strong>
                  <span>{shelfMeta(item, agentName)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="community-pod-shelf-empty">Videos only this pod can see collect here: upload one, or paste a YouTube or Loom link.</p>
        )
      ) : null}
    </section>
  );
}
