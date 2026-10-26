import { useState, type ComponentProps, type ReactNode } from "react";
import { ExternalLink, Globe, Layers, Megaphone } from "lucide-react";
import { buildCommunityFunnelPath } from "../../../../shared/webAppRouteState";
import { WebCommunitySalesPageSettings } from "./WebCommunitySalesPageSettings";
import { WebCommunityFunnelSection } from "./WebCommunityFunnelSection";
import { WebCommunityExternalFunnelLink } from "./WebCommunityExternalFunnelLink";
import "./WebCommunitySettings.css";
import "./WebCommunityFunnels.css";

type SalesPageProps = ComponentProps<typeof WebCommunitySalesPageSettings>;
type FunnelsPage = "sales_page" | "versions" | "website";

const ICON = { size: 16, strokeWidth: 2, "aria-hidden": true } as const;

const PAGES: { id: FunnelsPage; label: string; icon: ReactNode; title: string; description: string }[] = [
  {
    id: "sales_page",
    label: "Sales page",
    icon: <Megaphone {...ICON} />,
    title: "Sales page",
    description: "What visitors see at your community's address before they join: its layout, and a live preview.",
  },
  {
    id: "versions",
    label: "Versions",
    icon: <Layers {...ICON} />,
    title: "Versions",
    description: "The words and video on the sales page. Keep the default built from your profile, or build up to two of your own with the AI builder and make one live.",
  },
  {
    id: "website",
    label: "Own website",
    icon: <Globe {...ICON} />,
    title: "Own website",
    description: "Send visitors to a website of your own instead, with its Join button linking back here.",
  },
];

// Funnels: the pages a visitor sees before joining, edited like a site (Rashid,
// 2026-10-25), out of Settings. Its own nav on the left, after Settings', and
// the page on the right. Opens full screen in Classroom like Workflows.
export function WebCommunityFunnelsSection(props: {
  communityId: string | null;
  communitySlug: string | null;
  session: unknown;
  ensureSession: SalesPageProps["ensureSession"];
  funnel: SalesPageProps["funnel"];
  externalWebsite: SalesPageProps["externalWebsite"];
}) {
  const [page, setPage] = useState<FunnelsPage>("sales_page");
  const livePath = buildCommunityFunnelPath(props.communitySlug);
  const external = props.externalWebsite;
  const current = PAGES.find((entry) => entry.id === page)!;
  return (
    <div className="settings-panel pn-settings pn-funnels">
      <div className="pn-funnels-layout">
        <nav className="pn-settings-nav pn-funnels-nav" aria-label="Funnels">
          <div className="pn-funnels-nav-title">
            <h1>Funnels</h1>
            {livePath ? (
              <a className="pn-funnels-live-link" href={livePath} target="_blank" rel="noreferrer">
                {livePath} <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <div className="pn-settings-nav-list">
            <div className="pn-settings-nav-group">
              {PAGES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`pn-settings-nav-item${entry.id === page ? " is-active" : ""}`}
                  aria-current={entry.id === page ? "page" : undefined}
                  onClick={() => setPage(entry.id)}
                >
                  {entry.icon}
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>
        <div className="pn-funnels-main">
          <header className="pn-settings-page-header pn-funnels-page-header">
            <div>
              <h2>{current.title}</h2>
              <p>{current.description}</p>
            </div>
          </header>
          {!props.communityId || !props.communitySlug ? (
            <div className="pn-settings-loading" role="status"><span className="pn-settings-spinner" aria-hidden="true" />Loading…</div>
          ) : page === "sales_page" ? (
            <WebCommunitySalesPageSettings
              communityId={props.communityId}
              communitySlug={props.communitySlug}
              session={props.session}
              ensureSession={props.ensureSession}
              funnel={props.funnel}
              externalWebsite={external}
            />
          ) : page === "versions" ? (
            <section className="pn-settings-subpage pn-funnels-versions" aria-label="Versions">
              <WebCommunityFunnelSection {...props.funnel} />
            </section>
          ) : external.error ? (
            <section className="settings-section pn-settings-card"><p className="pn-settings-inline-error" role="alert">{external.error}</p></section>
          ) : external.isLoading ? (
            <section className="settings-section pn-settings-card"><div className="pn-settings-loading" role="status"><span className="pn-settings-spinner" aria-hidden="true" />Loading website settings…</div></section>
          ) : (
            <div className="pn-settings-stack">
              <WebCommunityExternalFunnelLink key={external.controls.communityId} {...external.controls} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
