import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_COMMUNITY_LAYOUT,
  communityLayoutTabLabel,
  layoutForMemberChoice,
  normalizeCommunityLayout,
  visibleCommunityLayoutTabs,
} from "../shared/communityLayout";

const SKOOL_LAYOUT = JSON.parse(
  readFileSync(join(__dirname, "..", "packages", "polynet-cli", "templates", "skool", "layout.json"), "utf8"),
);

function problemsOf(raw: unknown) {
  const result = normalizeCommunityLayout(raw);
  return result.ok ? [] : result.problems;
}

describe("community layout v1", () => {
  test("Polynet's default layout is valid and keeps the side column", () => {
    const result = normalizeCommunityLayout(DEFAULT_COMMUNITY_LAYOUT);
    expect(result).toEqual({ ok: true, layout: DEFAULT_COMMUNITY_LAYOUT });
    expect(DEFAULT_COMMUNITY_LAYOUT.navigation.position).toBe("side");
  });

  test("the skool template's layout is valid: top tabs, posts feed, centred", () => {
    const result = normalizeCommunityLayout(SKOOL_LAYOUT);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.layout.navigation.position).toBe("top");
    expect(result.layout.width).toBe("centered");
    expect(result.layout.pages.chat).toEqual({ presentation: "posts", aside: ["community_card", "upcoming_events"] });
    expect(result.layout.pages.about).toEqual({ presentation: "funnel" });
    expect(visibleCommunityLayoutTabs(result.layout).map((t) => communityLayoutTabLabel(result.layout, t.tab)))
      .toEqual(["Community", "Classroom", "Calendar", "Members", "Ask AI", "About"]);
  });

  test("the About page is Polynet's own unless a layout makes it the funnel", () => {
    expect(DEFAULT_COMMUNITY_LAYOUT.pages.about.presentation).toBe("page");
    const funnel = normalizeCommunityLayout({ pages: { about: { presentation: "funnel" } } });
    expect(funnel.ok && funnel.layout.pages.about.presentation).toBe("funnel");
    expect(problemsOf({ pages: { about: { presentation: "landing" } } }).map((p) => p.path)).toEqual(["pages.about.presentation"]);
    expect(problemsOf({ pages: { about: { video: true } } }).map((p) => p.path)).toEqual(["pages.about.video"]);
  });

  test("members may pick Classroom or Channels where the owner offers it", () => {
    const skool = normalizeCommunityLayout(SKOOL_LAYOUT);
    if (!skool.ok) throw new Error("skool");
    expect(skool.layout.navigation.member_choice).toEqual(["top", "side"]);
    expect(DEFAULT_COMMUNITY_LAYOUT.navigation.member_choice).toEqual([]);

    const channels = layoutForMemberChoice(skool.layout, "side");
    expect(channels.navigation.position).toBe("side");
    expect(channels.pages.chat).toEqual({ presentation: "messages", aside: [] });
    expect(channels.navigation.tabs).toEqual(skool.layout.navigation.tabs);
    expect(channels.pages.about).toEqual(skool.layout.pages.about);
    expect(layoutForMemberChoice(skool.layout, null)).toBe(skool.layout);
    // Not offered: the owner's layout.
    expect(layoutForMemberChoice(DEFAULT_COMMUNITY_LAYOUT, "top")).toBe(DEFAULT_COMMUNITY_LAYOUT);

    const offered = normalizeCommunityLayout({ navigation: { position: "side", member_choice: ["side", "top"] } });
    if (!offered.ok) throw new Error("offered");
    const classroom = layoutForMemberChoice(offered.layout, "top");
    expect(classroom.navigation.position).toBe("top");
    expect(classroom.pages.chat.presentation).toBe("posts");

    expect(problemsOf({ navigation: { position: "side", member_choice: ["top"] } }).map((p) => p.path)).toEqual(["navigation.member_choice"]);
    expect(problemsOf({ navigation: { member_choice: ["grid"] } }).map((p) => p.path)).toEqual(["navigation.member_choice.0"]);
  });

  test("an empty object means Polynet's layout", () => {
    expect(normalizeCommunityLayout({})).toEqual({ ok: true, layout: DEFAULT_COMMUNITY_LAYOUT });
  });

  test("tabs left out stay reachable but hidden", () => {
    const result = normalizeCommunityLayout({ navigation: { tabs: [{ tab: "resources" }], home: "resources" } });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(visibleCommunityLayoutTabs(result.layout).map((t) => t.tab)).toEqual(["resources"]);
    expect(result.layout.navigation.tabs).toHaveLength(6);
  });

  test("unknown settings, tabs and blocks are errors, never dropped", () => {
    expect(problemsOf({ colour: "red" })).toEqual([{ path: "colour", message: "\"colour\" isn't a layout setting here." }]);
    expect(problemsOf({ navigation: { tabs: [{ tab: "leaderboard" }, { tab: "chat" }] } })[0]?.path).toBe("navigation.tabs.0.tab");
    expect(problemsOf({ pages: { chat: { aside: ["leaderboard"] } } })[0]?.path).toBe("pages.chat.aside.0");
    expect(problemsOf({ pages: { map: {} } })[0]?.path).toBe("pages.map");
  });

  test("the home tab must be visible, and tabs can't repeat", () => {
    expect(problemsOf({ navigation: { tabs: [{ tab: "chat", hidden: true }, { tab: "resources" }], home: "chat" } })
      .map((p) => p.path)).toContain("navigation.home");
    expect(problemsOf({ navigation: { tabs: [{ tab: "chat" }, { tab: "chat" }] } })[0]?.message).toContain("twice");
  });

  test("labels are short text", () => {
    expect(problemsOf({ navigation: { tabs: [{ tab: "chat", label: "x".repeat(25) }] } })[0]?.path).toBe("navigation.tabs.0.label");
  });
});
