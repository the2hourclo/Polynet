import type { ReactNode } from "react";
import { MessageSquare, Pin } from "lucide-react";
import type { CommunityInteractionRootBundle } from "../../../../shared/cloudCommunityInteractionsGateway";
import type { UserProfile } from "../../../../shared/communityTypes";
import {
  ActorAvatar,
  InteractionContent,
  actorLabel,
  agentBadgeLabel,
  bundleText,
  formatRelativeTime,
  kindChipLabel,
  stripSharedAttachmentSummary,
} from "./communityInteractionFeed";
import { ReactionSummary } from "./communityInteractionRowParts";

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

function PostCard(props: CommunityPostsFeedProps & { bundle: CommunityInteractionRootBundle; pinned: boolean }) {
  const { bundle } = props;
  const root = bundle.root;
  const label = actorLabel(root, props.displayName, props.activeCommunityName);
  const profile = root.actor_user_id ? props.profilesByUserId[root.actor_user_id] ?? null : null;
  const badge = agentBadgeLabel(root.actor_type);
  const chip = kindChipLabel(root.kind);
  const body = stripSharedAttachmentSummary(bundleText(bundle.content_blocks, root.content_summary), bundle.attachments.length > 0);
  const open = () => props.onSelectRoot(root.id);
  return (
    <article
      className={["community-post-card", root.id === props.selectedRootId && "selected", props.pinned && "is-pinned", bundle.pending && "is-pending"]
        .filter(Boolean)
        .join(" ")}
      aria-label={root.title ? `${root.title}, by ${label}` : `Post by ${label}`}
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
          </span>
        </div>
        {props.pinned ? (
          <span className="community-post-card-pin"><Pin size={14} aria-hidden="true" /> Pinned</span>
        ) : null}
        {badge ? <span className="community-interaction-badge">{badge}</span> : null}
        {chip ? <span className="community-interaction-kind">{chip}</span> : null}
      </header>
      <button type="button" className="community-post-card-open" onClick={open}>
        {root.title ? <h3 className="community-post-card-title">{root.title}</h3> : null}
        <div className="community-post-card-preview">
          <InteractionContent text={body} renderTextWithLinks={props.renderTextWithLinks} />
        </div>
        {bundle.attachments.length > 0 ? (
          <span className="community-post-card-attachments">
            {bundle.attachments.length === 1 ? "1 attachment" : `${bundle.attachments.length} attachments`}
          </span>
        ) : null}
      </button>
      <footer className="community-post-card-footer">
        <ReactionSummary
          rows={root.reaction_summary}
          viewerEmojis={root.viewer_emojis}
          onToggle={(emoji) => props.onToggleReaction?.("root", root.id, emoji)}
        />
        <button type="button" className="community-post-card-replies" onClick={open}>
          <MessageSquare size={16} aria-hidden="true" />
          {root.reply_count === 0 ? "Reply" : root.reply_count === 1 ? "1 comment" : `${root.reply_count} comments`}
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

export function CommunityPostsFeed(props: CommunityPostsFeedProps) {
  const posts = orderCommunityPosts(props.roots, props.pinnedRoot);
  return (
    <div className="community-posts-feed">
      {props.composer ? <div className="community-posts-composer">{props.composer}</div> : null}
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
