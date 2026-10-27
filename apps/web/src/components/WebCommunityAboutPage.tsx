import { useEffect, useState } from "react";
import { Check, ExternalLink, Link2, Pencil } from "lucide-react";
import {
  fetchCloudPublicFunnelStats,
  resolveCloudPublicFunnel,
} from "../../../../shared/cloudPublicFunnelGateway";
import { buildCommunityFunnelRenderModel } from "../../../../shared/communityFunnelUi";
import type { PublicPlanSummary } from "../../../../shared/communityTypes";
import type { WebPublicCommunityRecord } from "../webAppContracts";
import { useActiveCommunityLayout } from "../controllers/useWebCommunityLayout";
import { ChatBlockMarkdown } from "../../../../shared/chatBlockMarkdownUi";
import { renderChatInlineMarkdown } from "../../../../shared/chatInlineMarkdownUi";
import { communityJoinUrl, useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import { WebCommunityCard, WebCommunityUpcomingEvents } from "./WebCommunityAside";
import { WebCommunitySalesPage } from "./WebCommunitySalesPage";

type PublicCommunityStats = Pick<WebPublicCommunityRecord, "member_count" | "online_count" | "admin_count">;

// Members see the same sales page visitors land on, read from the same public
// queries, so the owner checks their funnel from inside the community. The
// card's button invites instead of joining.
function WebCommunityAboutSalesPage() {
  const frame = useWebCommunityFrame();
  const slug = frame.community?.slug ?? null;
  const [loaded, setLoaded] = useState<{
    slug: string;
    community: WebPublicCommunityRecord;
    plan: PublicPlanSummary | null;
    stats: PublicCommunityStats | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    void Promise.all([
      resolveCloudPublicFunnel<unknown, WebPublicCommunityRecord, PublicPlanSummary>({ communitySlug: slug }),
      fetchCloudPublicFunnelStats<unknown, PublicCommunityStats>({ communitySlug: slug }).catch(() => null),
    ])
      .then(([funnel, stats]) => {
        if (cancelled || !funnel?.ok || !funnel.community) return;
        setLoaded({
          slug,
          community: funnel.community,
          plan: funnel.active_plan ?? null,
          stats: stats?.ok ? stats.community ?? null : null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const current = loaded && loaded.slug === slug ? loaded : null;
  if (!current) {
    return (
      <div className="community-tab-scroll">
        <div className="community-interaction-loading web-skeleton-pill" aria-hidden="true" />
      </div>
    );
  }
  const community = { ...current.community, ...current.stats };
  const joinUrl = communityJoinUrl(slug);
  const invite = async () => {
    if (!joinUrl || !frame.onCopyJoinLink) return;
    await frame.onCopyJoinLink(joinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="community-tab-scroll">
      <WebCommunitySalesPage
        community={community}
        plan={current.plan}
        renderModel={buildCommunityFunnelRenderModel({
          communityName: community.name,
          oneLiner: community.one_liner,
          about: community.about,
          funnel: community.funnel,
        })}
        media={community.about_media ?? []}
        text={community.about_text ?? ""}
        showMembers={community.about_show_members !== false}
        address={joinUrl ? joinUrl.replace(/^https?:\/\//, "") : null}
        action={
          <div className="community-sales-join">
            {frame.canInvite && joinUrl && frame.onCopyJoinLink ? (
              <button type="button" className="community-sales-join-button" onClick={() => void invite()}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
                {copied ? "Invite link copied" : "Invite people"}
              </button>
            ) : (
              <p className="community-sales-join-note">You're a member</p>
            )}
            {frame.canEditSalesPage ? (
              <button type="button" className="community-aside-link community-sales-join-note" onClick={() => frame.onSelectTab("funnels")}>
                <Pencil size={13} aria-hidden="true" /> Edit this page
              </button>
            ) : null}
            {joinUrl ? (
              <a className="community-aside-link community-sales-join-note" href={joinUrl} target="_blank" rel="noreferrer">
                See it as a visitor <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

// The About tab: the community's own description, from the same fields as its
// public page (Settings > Community), shown inside the community for members.
// The public page stays the place visitors join from.
export function WebCommunityAboutPage() {
  const layout = useActiveCommunityLayout();
  if (layout.pages.about.presentation === "funnel") return <WebCommunityAboutSalesPage />;
  return <WebCommunityAboutCard />;
}

function WebCommunityAboutCard() {
  const frame = useWebCommunityFrame();
  const community = frame.community;
  if (!community) return null;
  const about = String(community.about ?? "").trim();
  const publicUrl = communityJoinUrl(community.slug);
  return (
    <div className="community-tab-scroll">
      <div className="community-about-page">
        <article className="community-about-main community-aside-card">
          {community.banner_url ? (
            <div className="community-about-banner">
              <img
                src={community.banner_url}
                alt=""
                style={{ objectPosition: `${(community.banner_focus_x ?? 0.5) * 100}% ${(community.banner_focus_y ?? 0.5) * 100}%` }}
              />
            </div>
          ) : null}
          <div className="community-about-body">
            <h1 className="community-about-title">{community.name}</h1>
            {community.one_liner ? <p className="community-about-one-liner">{community.one_liner}</p> : null}
            {about ? (
              <div className="community-about-text">
                <ChatBlockMarkdown
                  text={about}
                  renderInline={(text) => renderChatInlineMarkdown(text, { allowLabeledLinks: true })}
                />
              </div>
            ) : (
              <p className="community-aside-empty">The owner hasn't written an About section yet.</p>
            )}
            {publicUrl ? (
              <a className="community-aside-link community-about-public-link" href={publicUrl} target="_blank" rel="noreferrer">
                View the public page <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </article>
        <div className="community-about-side">
          <WebCommunityCard />
          <WebCommunityUpcomingEvents />
        </div>
      </div>
    </div>
  );
}
