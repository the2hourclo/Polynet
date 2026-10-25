import { ExternalLink } from "lucide-react";
import { ChatBlockMarkdown } from "../../../../shared/chatBlockMarkdownUi";
import { renderChatInlineMarkdown } from "../../../../shared/chatInlineMarkdownUi";
import { communityJoinUrl, useWebCommunityFrame } from "../controllers/useWebCommunityFrame";
import { WebCommunityCard, WebCommunityUpcomingEvents } from "./WebCommunityAside";

// The About tab: the community's own description, from the same fields as its
// public page (Settings > Community), shown inside the community for members.
// The public page stays the place visitors join from.
export function WebCommunityAboutPage() {
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
