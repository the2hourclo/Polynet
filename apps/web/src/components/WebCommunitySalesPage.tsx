import type { ReactNode } from "react";
import { Globe2, Lock, Tag, Users } from "lucide-react";

import type { CommunityFunnelRenderModel } from "../../../../shared/communityFunnelUi";
import { formatPublicPlanJoinPrice } from "../../../../shared/communityFunnelUi";
import type { CommunityPublicFace, PublicPlanSummary } from "../../../../shared/communityTypes";
import { renderMarkdown } from "../../../../shared/markdownUi";
import { UserAvatar } from "../../../../shared/UserAvatar";
import { renderHeroMediaDefault } from "./CommunityFunnelSurface";
import "./WebCommunitySalesPage.css";

// The About page as a sales page, the way Skool does it: one page that a
// visitor lands on and a member opens from the About tab. Media, the facts a
// buyer checks (who runs it, how many people, what it costs), the pitch, and a
// card beside it with the join button. It only arranges what the public funnel
// already has: the published funnel copy and video, the community profile,
// member stats and the selling plan. The caller supplies the action, so the
// public page joins or checks out and the member view invites.

export type CommunitySalesPageCommunity = {
  id?: string;
  name: string;
  one_liner: string | null;
  about: string | null;
  avatar_url?: string | null;
  avatar_focus_x?: number | null;
  avatar_focus_y?: number | null;
  avatar_zoom?: number | null;
  banner_url?: string | null;
  banner_focus_x?: number | null;
  banner_focus_y?: number | null;
  entry_policy?: "open" | "approval" | "paid_subscription" | null;
  host?: Omit<CommunityPublicFace, "user_id"> | null;
  member_count?: number | null;
  online_count?: number | null;
  admin_count?: number | null;
};

export type WebCommunitySalesPageProps = {
  community: CommunitySalesPageCommunity;
  plan: PublicPlanSummary | null;
  renderModel: CommunityFunnelRenderModel;
  // Shown under the card's stats: the join button and its status notes.
  action: ReactNode;
  // A short address under the card's name, e.g. polynet.ai/c/the-2-hour-club.
  address?: string | null;
  alertMessages?: string[];
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

function compactCount(value: number): string {
  return value >= 10_000
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : value.toLocaleString();
}

function priceFact(community: CommunitySalesPageCommunity, plan: PublicPlanSummary | null): string {
  if (community.entry_policy === "paid_subscription") return formatPublicPlanJoinPrice(plan) ?? "Paid";
  if (community.entry_policy === "approval") return "Free · by approval";
  return "Free";
}

function SalesPageMedia(props: { community: CommunitySalesPageCommunity; vslUrl: string | null }) {
  if (props.vslUrl) {
    return (
      <div className="community-sales-media">
        {renderHeroMediaDefault("video", props.vslUrl, { eager: true, playHint: "Watch the intro" })}
      </div>
    );
  }
  if (!props.community.banner_url) return null;
  return (
    <div className="community-sales-media">
      <img
        src={props.community.banner_url}
        alt=""
        style={{
          objectPosition: `${(props.community.banner_focus_x ?? 0.5) * 100}% ${(props.community.banner_focus_y ?? 0.5) * 100}%`,
        }}
      />
    </div>
  );
}

export function WebCommunitySalesPage(props: WebCommunitySalesPageProps) {
  const { community, renderModel } = props;
  const memberCount = typeof community.member_count === "number" ? community.member_count : null;
  const onlineCount = typeof community.online_count === "number" ? community.online_count : null;
  const adminCount = typeof community.admin_count === "number" ? community.admin_count : null;
  const isCustom = renderModel.mode === "custom";
  const about = String(community.about ?? "").trim();
  const hostName = community.host?.display_name?.trim() || null;
  const isOpen = community.entry_policy === "open";

  return (
    <div className="community-sales-page">
      <article className="community-sales-main">
        <h1 className="community-sales-title">{community.name}</h1>
        <SalesPageMedia community={community} vslUrl={renderModel.vslUrl} />

        <ul className="community-sales-facts" aria-label="At a glance">
          <li>
            {isOpen ? <Globe2 size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
            {isOpen ? "Open to join" : "Private"}
          </li>
          {memberCount !== null ? (
            <li>
              <Users size={16} aria-hidden="true" />
              {compactCount(memberCount)} {memberCount === 1 ? "member" : "members"}
            </li>
          ) : null}
          <li>
            <Tag size={16} aria-hidden="true" />
            {priceFact(community, props.plan)}
          </li>
          {hostName ? (
            <li className="community-sales-host">
              <UserAvatar
                className="community-sales-host-avatar"
                readyClassName="has-image"
                imageClassName="community-sales-host-avatar-image"
                fallbackClassName="community-sales-host-avatar-fallback"
                name={hostName}
                imageUrl={community.host?.avatar_url ?? null}
                focusX={community.host?.avatar_focus_x ?? 0.5}
                focusY={community.host?.avatar_focus_y ?? 0.5}
                zoom={community.host?.avatar_zoom ?? 1}
                fallback={<span>{initials(hostName)}</span>}
                alt=""
                aria-hidden={true}
              />
              By {hostName}
            </li>
          ) : null}
        </ul>

        {props.alertMessages?.length ? (
          <div className="community-sales-alerts" role="status">
            {props.alertMessages.map((message) => <p key={message}>{message}</p>)}
          </div>
        ) : null}

        <div className="community-sales-action-inline">{props.action}</div>

        <div className="community-sales-copy">
          {isCustom ? (
            <>
              {renderModel.headline ? <p className="community-sales-lead">{renderModel.headline}</p> : null}
              {renderModel.subheadline ? <p>{renderModel.subheadline}</p> : null}
              {renderModel.pillars.length ? (
                <ul className="community-sales-pillars">
                  {renderModel.pillars.map((pillar, index) => (
                    <li key={`${index}:${pillar.title}`}>
                      <strong>{pillar.title}</strong>
                      <span>{pillar.body}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {renderModel.longFormMarkdown ? renderMarkdown(renderModel.longFormMarkdown, { headingLevelOffset: 1 }) : null}
            </>
          ) : about ? (
            renderMarkdown(about, { headingLevelOffset: 1 })
          ) : community.one_liner ? (
            <p className="community-sales-lead">{community.one_liner}</p>
          ) : null}
        </div>
      </article>

      <aside className="community-sales-card" aria-label={`Join ${community.name}`}>
        {community.banner_url ? (
          <div className="community-sales-card-banner">
            <img
              src={community.banner_url}
              alt=""
              style={{
                objectPosition: `${(community.banner_focus_x ?? 0.5) * 100}% ${(community.banner_focus_y ?? 0.5) * 100}%`,
              }}
            />
          </div>
        ) : null}
        <div className="community-sales-card-body">
          <div className="community-sales-card-identity">
            <UserAvatar
              className="community-sales-card-avatar"
              readyClassName="has-image"
              imageClassName="community-sales-card-avatar-image"
              fallbackClassName="community-sales-card-avatar-fallback"
              name={community.name}
              imageUrl={community.avatar_url ?? null}
              focusX={community.avatar_focus_x ?? 0.5}
              focusY={community.avatar_focus_y ?? 0.5}
              zoom={community.avatar_zoom ?? 1}
              fallback={<span>{initials(community.name)}</span>}
              alt=""
              aria-hidden={true}
            />
            <div>
              <h2>{community.name}</h2>
              {props.address ? <p className="community-sales-card-address">{props.address}</p> : null}
            </div>
          </div>
          {community.one_liner ? <p className="community-sales-card-description">{community.one_liner}</p> : null}
          {memberCount !== null || onlineCount !== null || adminCount !== null ? (
            <dl className="community-sales-card-stats">
              {memberCount !== null ? (
                <div>
                  <dt>Members</dt>
                  <dd>{compactCount(memberCount)}</dd>
                </div>
              ) : null}
              {onlineCount !== null ? (
                <div>
                  <dt>Online</dt>
                  <dd>{compactCount(onlineCount)}</dd>
                </div>
              ) : null}
              {adminCount !== null ? (
                <div>
                  <dt>{adminCount === 1 ? "Admin" : "Admins"}</dt>
                  <dd>{compactCount(adminCount)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <div className="community-sales-card-action">{props.action}</div>
        </div>
      </aside>
    </div>
  );
}
