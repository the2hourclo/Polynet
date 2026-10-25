import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { MessageSquare, Pin, ThumbsUp, X } from "lucide-react";
import type { CommunityInteractionRootBundle } from "../../../../shared/cloudCommunityInteractionsGateway";
import type { UserProfile } from "../../../../shared/communityTypes";
import {
  ActorAvatar,
  InteractionContent,
  actorLabel,
  agentBadgeLabel,
  bundleText,
  formatRelativeTime,
  stripSharedAttachmentSummary,
} from "./communityInteractionFeed";
import { useWebCommunityFrame } from "../controllers/useWebCommunityFrame";

// The community's posts as one card each, newest activity first: the "posts"
// presentation a layout can choose for the chat page. Same posts, replies,
// reactions, pins and composer as the chat timeline; opening a card opens the
// same thread.

export type CommunityPostsFeedProps = {
  roots: CommunityInteractionRootBundle[];
  pinnedRoot?: CommunityInteractionRootBundle | null;
  selectedRootId: string | null;
  isLoadingRoots: boolean;
  error: string | null;
  errorActionLabel?: string;
  onRetryRoots: () => void;
  onSelectRoot: (rootId: string) => void;
  onToggleReaction?: (targetType: "root" | "reply", targetId: string, emoji: string) => void;
  canLoadOlderRoots?: boolean;
  isLoadingOlderRoots?: boolean;
  onLoadOlderRoots?: () => void;
  composer?: ReactNode;
  channelName?: string | null;
  activeCommunityName: string;
  currentUserId?: string | null;
  profilesByUserId: Record<string, UserProfile>;
  displayName: (userId: string) => string;
  getAvatarColor: (seed: string) => string;
  getInitials: (value: string) => string;
  renderTextWithLinks: (text: string) => ReactNode;
};

function lastActivityMs(bundle: CommunityInteractionRootBundle): number {
  const created = Date.parse(bundle.root.created_at) || 0;
  const replied = bundle.root.last_reply_at ? Date.parse(bundle.root.last_reply_at) || 0 : 0;
  return Math.max(created, replied);
}

export function orderCommunityPosts(
  roots: CommunityInteractionRootBundle[],
  pinnedRoot: CommunityInteractionRootBundle | null | undefined,
): CommunityInteractionRootBundle[] {
  const pinnedId = pinnedRoot?.root.id ?? null;
  const rest = roots
    .filter((bundle) => bundle.root.id !== pinnedId && bundle.root.actor_type !== "system")
    .sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
  return pinnedRoot ? [pinnedRoot, ...rest] : rest;
}

// A post with no title of its own uses its first line as one, so cards read as
// title and body the way members write them.
export function splitPostTitle(title: string | null, body: string): { title: string | null; body: string } {
  if (title) return { title, body };
  const lines = body.split("\n");
  const first = lines[0]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();
  if (first.length > 120) return { title: null, body };
  // A short one-line post is all title, as on a Skool feed.
  if (!rest) return first.length <= 80 ? { title: first, body: "" } : { title: null, body };
  return { title: first.replace(/^#+\s*/, "").replace(/^\*\*(.*)\*\*$/, "$1"), body: rest };
}

const LIKE = "👍";

// The picture a post shows on its card: its first image, or a link preview's.
function postThumbnail(bundle: CommunityInteractionRootBundle): { src: string; alt: string } | null {
  const image = bundle.attachments.find((attachment) => attachment.type === "image" && (attachment.url || attachment.data_url));
  if (image) return { src: (image.url || image.data_url)!, alt: image.name };
  const embed = bundle.embeds?.find((entry) => entry.status === "ready" && entry.image_url);
  return embed ? { src: embed.image_url!, alt: embed.image_alt ?? embed.title ?? "" } : null;
}

function PostCard(props: CommunityPostsFeedProps & { bundle: CommunityInteractionRootBundle; pinned: boolean }) {
  const { bundle } = props;
  const root = bundle.root;
  const label = actorLabel(root, props.displayName, props.activeCommunityName);
  const profile = root.actor_user_id ? props.profilesByUserId[root.actor_user_id] ?? null : null;
  const badge = agentBadgeLabel(root.actor_type);
  const text = splitPostTitle(
    root.title,
    stripSharedAttachmentSummary(bundleText(bundle.content_blocks, root.content_summary), bundle.attachments.length > 0),
  );
  const thumbnail = postThumbnail(bundle);
  const likes = root.reaction_summary.find((row) => row.emoji === LIKE)?.count ?? 0;
  const liked = root.viewer_emojis.includes(LIKE);
  const open = () => props.onSelectRoot(root.id);
  // The whole card opens the post; its own buttons and links keep their job.
  const openFromCard = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
    if (window.getSelection()?.toString()) return;
    open();
  };
  return (
    <article
      className={["community-post-card", root.id === props.selectedRootId && "selected", props.pinned && "is-pinned", bundle.pending && "is-pending"]
        .filter(Boolean)
        .join(" ")}
      aria-label={text.title ? `${text.title}, by ${label}` : `Post by ${label}`}
      onClick={openFromCard}
    >
      <header className="community-post-card-header">
        <ActorAvatar
          className="community-post-card-avatar"
          label={label}
          seed={root.actor_user_id ?? root.actor_agent_key ?? root.id}
          profile={profile}
          getAvatarColor={props.getAvatarColor}
          getInitials={props.getInitials}
        />
        <div className="community-post-card-byline">
          <span className="community-post-card-author">{label}</span>
          <span className="community-post-card-meta">
            {formatRelativeTime(root.created_at)}
            {props.channelName ? <> · <span className="community-post-card-category">{props.channelName}</span></> : null}
            {badge ? <> · {badge}</> : null}
          </span>
        </div>
        {props.pinned ? (
          <span className="community-post-card-pin"><Pin size={14} aria-hidden="true" /> Pinned</span>
        ) : null}
      </header>
      <div className={`community-post-card-body${thumbnail ? " has-thumbnail" : ""}`}>
        <button type="button" className="community-post-card-open" onClick={open}>
          {text.title ? <h3 className="community-post-card-title">{text.title}</h3> : null}
          {text.body ? (
            <div className="community-post-card-preview">
              <InteractionContent text={text.body} renderTextWithLinks={props.renderTextWithLinks} />
            </div>
          ) : null}
        </button>
        {thumbnail ? <img className="community-post-card-thumbnail" src={thumbnail.src} alt={thumbnail.alt} loading="lazy" /> : null}
      </div>
      <footer className="community-post-card-footer">
        <button
          type="button"
          className={`community-post-card-action${liked ? " is-active" : ""}`}
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
          disabled={!props.onToggleReaction}
          onClick={() => props.onToggleReaction?.("root", root.id, LIKE)}
        >
          <ThumbsUp size={17} aria-hidden="true" />
          <span>{likes}</span>
        </button>
        <button type="button" className="community-post-card-action" aria-label={`${root.reply_count} comments`} onClick={open}>
          <MessageSquare size={17} aria-hidden="true" />
          <span>{root.reply_count}</span>
        </button>
        {root.last_reply_actor_user_id && root.last_reply_at ? (
          <span className="community-post-card-last-reply">
            <ActorAvatar
              className="community-post-card-last-reply-avatar"
              label={props.displayName(root.last_reply_actor_user_id)}
              seed={root.last_reply_actor_user_id}
              profile={props.profilesByUserId[root.last_reply_actor_user_id] ?? null}
              getAvatarColor={props.getAvatarColor}
              getInitials={props.getInitials}
            />
            Last comment {formatRelativeTime(root.last_reply_at)}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

// Writing a post starts from a slim "Write something" bar; the full composer
// (attachments, mentions, agent notices) opens in its place.
function PostComposer(props: CommunityPostsFeedProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) boxRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [open]);
  if (!props.composer) return null;
  const userId = props.currentUserId ?? null;
  const name = userId ? props.displayName(userId) : "You";
  const avatar = (
    <ActorAvatar
      className="community-posts-composer-avatar"
      label={name}
      seed={userId ?? "viewer"}
      profile={userId ? props.profilesByUserId[userId] ?? null : null}
      getAvatarColor={props.getAvatarColor}
      getInitials={props.getInitials}
    />
  );
  if (!open) {
    return (
      <button type="button" className="community-posts-composer community-posts-composer-bar" onClick={() => setOpen(true)}>
        {avatar}
        <span>Write something</span>
      </button>
    );
  }
  return (
    <div
      className="community-posts-composer is-open"
      ref={boxRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
      }}
    >
      <div className="community-posts-composer-head">
        {avatar}
        <span className="community-posts-composer-hint">
          Posting{props.channelName ? <> in <strong>{props.channelName}</strong></> : null} · Ctrl+Enter to post
        </span>
        <button type="button" className="community-posts-composer-close" aria-label="Close" onClick={() => setOpen(false)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {props.composer}
    </div>
  );
}

// Every word typed in the top bar's search has to appear in the post.
export function postMatchesSearch(bundle: CommunityInteractionRootBundle, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [bundle.root.title ?? "", bundleText(bundle.content_blocks, bundle.root.content_summary)].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function CommunityPostsFeed(props: CommunityPostsFeedProps) {
  const { postSearch, onPostSearch } = useWebCommunityFrame();
  const searching = postSearch.trim().length > 0;
  const ordered = orderCommunityPosts(props.roots, props.pinnedRoot);
  const posts = searching ? ordered.filter((bundle) => postMatchesSearch(bundle, postSearch)) : ordered;
  return (
    <div className="community-posts-feed">
      <PostComposer {...props} />
      {searching && posts.length > 0 ? (
        <div className="community-posts-search-status" role="status">
          <span>{posts.length === 1 ? "1 post" : `${posts.length} posts`} matching "{postSearch.trim()}"</span>
          <button type="button" className="community-aside-link" onClick={() => onPostSearch("")}>Clear</button>
        </div>
      ) : null}
      {props.error && posts.length === 0 ? (
        <div className="community-interaction-state" role="alert">
          <div>{props.error}</div>
          <button type="button" onClick={props.onRetryRoots}>{props.errorActionLabel ?? "Retry"}</button>
        </div>
      ) : props.isLoadingRoots && posts.length === 0 ? (
        <div className="community-interaction-state" aria-live="polite">
          <div>Loading posts...</div>
          <div className="community-interaction-loading web-skeleton-pill" aria-hidden="true" />
        </div>
      ) : posts.length === 0 && searching ? (
        <div className="community-interaction-empty">
          <MessageSquare size={22} aria-hidden="true" />
          <div>No posts match "{postSearch.trim()}"</div>
          <button type="button" className="community-aside-link" onClick={() => onPostSearch("")}>Clear search</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="community-interaction-empty">
          <MessageSquare size={22} aria-hidden="true" />
          <div>No posts yet</div>
          <span>Write the first post above.</span>
        </div>
      ) : (
        <div className="community-posts-list">
          {posts.map((bundle) => (
            <PostCard key={bundle.root.id} {...props} bundle={bundle} pinned={bundle.root.id === props.pinnedRoot?.root.id} />
          ))}
          {props.canLoadOlderRoots && props.onLoadOlderRoots ? (
            <button
              type="button"
              className="community-posts-load-more"
              disabled={props.isLoadingOlderRoots}
              onClick={props.onLoadOlderRoots}
            >
              {props.isLoadingOlderRoots ? "Loading..." : "Show older posts"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
