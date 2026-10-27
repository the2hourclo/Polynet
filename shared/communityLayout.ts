// A community's layout: where its navigation sits, which tabs it shows and in
// what order, and how the community page is arranged. Like the theme
// (shared/communityTheme.ts) it is data a founder or their agent edits, checked
// here before it is stored. The two are separate records, so changing one
// never resets the other.
//
// Only Polynet systems that already exist are offered: channels and posts,
// courses (resources), events, members, the community agent and the public
// About page. The community rail on the far left is Polynet's own and is never
// part of a layout. Owner tools (workflows, analytics, settings) are pinned:
// managers always see them after the community's own tabs.

export const COMMUNITY_LAYOUT_VERSION = 1 as const;

export const COMMUNITY_LAYOUT_TABS = ["chat", "resources", "events", "members", "agent", "about"] as const;
export type CommunityLayoutTab = (typeof COMMUNITY_LAYOUT_TABS)[number];

export const COMMUNITY_LAYOUT_POSITIONS = ["top", "side"] as const;
export type CommunityLayoutPosition = (typeof COMMUNITY_LAYOUT_POSITIONS)[number];

export const COMMUNITY_LAYOUT_ASIDE_BLOCKS = ["community_card", "upcoming_events"] as const;
export type CommunityLayoutAsideBlock = (typeof COMMUNITY_LAYOUT_ASIDE_BLOCKS)[number];

export type CommunityLayoutTabEntry = {
  tab: CommunityLayoutTab;
  // What members see on the tab. Empty means Polynet's own name for it.
  label: string;
  hidden: boolean;
};

export type CommunityLayoutV1 = {
  version: 1;
  navigation: {
    // "side": Polynet's column of channels and tabs. "top": a tab bar across
    // the top of the community, with channels as category chips.
    position: "side" | "top";
    // Every tab, in order. Hidden tabs are still reachable by link.
    tabs: CommunityLayoutTabEntry[];
    // The tab a member lands on.
    home: CommunityLayoutTab;
    // Arrangements each member may pick for themselves ("top" is Classroom,
    // "side" is Channels). Empty: everyone sees the owner's. Left out of a
    // stored layout, a top layout offers both and a side layout none.
    member_choice: CommunityLayoutPosition[];
  };
  // "wide" fills the space next to the rail; "centered" keeps one readable column.
  width: "wide" | "centered";
  pages: {
    chat: {
      // "messages": Polynet's chat timeline. "posts": one card per post, with
      // title, preview, replies and reactions.
      presentation: "messages" | "posts";
      aside: CommunityLayoutAsideBlock[];
    };
    about: {
      // "page": the About tab shows the description, and visitors get
      // Polynet's own public page. "funnel": one sales page for both, with
      // media, stats, description and a join card with the price, served at
      // the public link and inside the community.
      presentation: "page" | "funnel";
    };
  };
};

export type CommunityLayoutProblem = { path: string; message: string };

export type CommunityLayoutResult =
  | { ok: true; layout: CommunityLayoutV1 }
  | { ok: false; problems: CommunityLayoutProblem[] };

export const COMMUNITY_LAYOUT_TAB_DEFAULT_LABELS: Readonly<Record<CommunityLayoutTab, string>> = {
  chat: "Chat",
  resources: "Knowledge",
  events: "Events",
  members: "Members",
  agent: "Agent",
  about: "About",
};

// Polynet's own layout, so a community with no layout record looks as it always has.
export const DEFAULT_COMMUNITY_LAYOUT: CommunityLayoutV1 = {
  version: 1,
  navigation: {
    position: "side",
    tabs: [
      { tab: "chat", label: "", hidden: false },
      { tab: "agent", label: "", hidden: false },
      { tab: "resources", label: "", hidden: false },
      { tab: "events", label: "", hidden: false },
      { tab: "members", label: "", hidden: true },
      { tab: "about", label: "", hidden: true },
    ],
    home: "chat",
    member_choice: [],
  },
  width: "wide",
  pages: {
    chat: { presentation: "messages", aside: [] },
    about: { presentation: "page" },
  },
};

const MAX_LABEL_LENGTH = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(raw: Record<string, unknown>, known: readonly string[], path: string, problems: CommunityLayoutProblem[]) {
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      problems.push({ path: path ? `${path}.${key}` : key, message: `"${key}" isn't a layout setting here.` });
    }
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string, problems: CommunityLayoutProblem[]): T | null {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  problems.push({ path, message: `${path} is one of: ${allowed.join(", ")}.` });
  return null;
}

function normalizeTabs(raw: unknown, problems: CommunityLayoutProblem[]): CommunityLayoutTabEntry[] | null {
  const path = "navigation.tabs";
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push({ path, message: "List the community's tabs in order." });
    return null;
  }
  const seen = new Set<string>();
  const tabs: CommunityLayoutTabEntry[] = [];
  raw.forEach((entry, index) => {
    const at = `${path}.${index}`;
    if (!isRecord(entry)) {
      problems.push({ path: at, message: "Each tab is an object with a \"tab\"." });
      return;
    }
    unknownKeys(entry, ["tab", "label", "hidden"], at, problems);
    const tab = oneOf(entry.tab, COMMUNITY_LAYOUT_TABS, `${at}.tab`, problems);
    if (!tab) return;
    if (seen.has(tab)) {
      problems.push({ path: `${at}.tab`, message: `"${tab}" is listed twice.` });
      return;
    }
    seen.add(tab);
    let label = "";
    if (entry.label !== undefined) {
      if (typeof entry.label !== "string" || entry.label.trim().length > MAX_LABEL_LENGTH) {
        problems.push({ path: `${at}.label`, message: `A tab label is text of up to ${MAX_LABEL_LENGTH} characters.` });
      } else {
        label = entry.label.trim();
      }
    }
    let hidden = false;
    if (entry.hidden !== undefined) {
      if (typeof entry.hidden !== "boolean") problems.push({ path: `${at}.hidden`, message: "hidden is true or false." });
      else hidden = entry.hidden;
    }
    tabs.push({ tab, label, hidden });
  });
  // Tabs left out keep working by link but are not shown, so a layout written
  // before a tab existed still renders.
  for (const tab of COMMUNITY_LAYOUT_TABS) {
    if (!seen.has(tab)) tabs.push({ tab, label: "", hidden: true });
  }
  return tabs;
}

export function normalizeCommunityLayout(raw: unknown): CommunityLayoutResult {
  const problems: CommunityLayoutProblem[] = [];
  if (!isRecord(raw)) return { ok: false, problems: [{ path: "", message: "A layout is a JSON object." }] };
  unknownKeys(raw, ["version", "navigation", "width", "pages"], "", problems);
  if (raw.version !== undefined && raw.version !== COMMUNITY_LAYOUT_VERSION) {
    problems.push({ path: "version", message: `Only layout version ${COMMUNITY_LAYOUT_VERSION} is supported.` });
  }

  const layout: CommunityLayoutV1 = {
    version: 1,
    navigation: { ...DEFAULT_COMMUNITY_LAYOUT.navigation, tabs: DEFAULT_COMMUNITY_LAYOUT.navigation.tabs.map((t) => ({ ...t })) },
    width: DEFAULT_COMMUNITY_LAYOUT.width,
    pages: {
      chat: { ...DEFAULT_COMMUNITY_LAYOUT.pages.chat, aside: [] },
      about: { ...DEFAULT_COMMUNITY_LAYOUT.pages.about },
    },
  };

  if (raw.navigation !== undefined) {
    if (!isRecord(raw.navigation)) {
      problems.push({ path: "navigation", message: "navigation is an object." });
    } else {
      const nav = raw.navigation;
      unknownKeys(nav, ["position", "tabs", "home", "member_choice"], "navigation", problems);
      if (nav.position !== undefined) {
        layout.navigation.position = oneOf(nav.position, ["side", "top"] as const, "navigation.position", problems) ?? layout.navigation.position;
      }
      if (nav.tabs !== undefined) {
        layout.navigation.tabs = normalizeTabs(nav.tabs, problems) ?? layout.navigation.tabs;
      }
      if (nav.home !== undefined) {
        layout.navigation.home = oneOf(nav.home, COMMUNITY_LAYOUT_TABS, "navigation.home", problems) ?? layout.navigation.home;
      }
    }
  }

  const rawChoice = isRecord(raw.navigation) ? raw.navigation.member_choice : undefined;
  if (rawChoice === undefined) {
    layout.navigation.member_choice = layout.navigation.position === "top" ? ["top", "side"] : [];
  } else if (!Array.isArray(rawChoice)) {
    problems.push({ path: "navigation.member_choice", message: "member_choice is a list of positions: top, side." });
  } else {
    const choice: CommunityLayoutPosition[] = [];
    rawChoice.forEach((entry, index) => {
      const value = oneOf(entry, COMMUNITY_LAYOUT_POSITIONS, `navigation.member_choice.${index}`, problems);
      if (value && !choice.includes(value)) choice.push(value);
    });
    if (choice.length > 0 && !choice.includes(layout.navigation.position)) {
      problems.push({ path: "navigation.member_choice", message: "Members can always keep the owner's layout: include its position." });
    }
    layout.navigation.member_choice = choice.length > 1 ? choice : [];
  }

  const home = layout.navigation.tabs.find((entry) => entry.tab === layout.navigation.home);
  if (!home || home.hidden) {
    problems.push({ path: "navigation.home", message: "The home tab has to be one of the tabs members can see." });
  }
  if (!layout.navigation.tabs.some((entry) => !entry.hidden)) {
    problems.push({ path: "navigation.tabs", message: "Show at least one tab." });
  }

  if (raw.width !== undefined) {
    layout.width = oneOf(raw.width, ["wide", "centered"] as const, "width", problems) ?? layout.width;
  }

  if (raw.pages !== undefined) {
    if (!isRecord(raw.pages)) {
      problems.push({ path: "pages", message: "pages is an object." });
    } else {
      unknownKeys(raw.pages, ["chat", "about"], "pages", problems);
      const about = raw.pages.about;
      if (about !== undefined) {
        if (!isRecord(about)) {
          problems.push({ path: "pages.about", message: "pages.about is an object." });
        } else {
          unknownKeys(about, ["presentation"], "pages.about", problems);
          if (about.presentation !== undefined) {
            layout.pages.about.presentation =
              oneOf(about.presentation, ["page", "funnel"] as const, "pages.about.presentation", problems) ?? layout.pages.about.presentation;
          }
        }
      }
      const chat = raw.pages.chat;
      if (chat !== undefined) {
        if (!isRecord(chat)) {
          problems.push({ path: "pages.chat", message: "pages.chat is an object." });
        } else {
          unknownKeys(chat, ["presentation", "aside"], "pages.chat", problems);
          if (chat.presentation !== undefined) {
            layout.pages.chat.presentation =
              oneOf(chat.presentation, ["messages", "posts"] as const, "pages.chat.presentation", problems) ?? layout.pages.chat.presentation;
          }
          if (chat.aside !== undefined) {
            if (!Array.isArray(chat.aside)) {
              problems.push({ path: "pages.chat.aside", message: "aside is a list of blocks." });
            } else {
              const aside: CommunityLayoutAsideBlock[] = [];
              chat.aside.forEach((block, index) => {
                const value = oneOf(block, COMMUNITY_LAYOUT_ASIDE_BLOCKS, `pages.chat.aside.${index}`, problems);
                if (!value) return;
                if (aside.includes(value)) problems.push({ path: `pages.chat.aside.${index}`, message: `"${value}" is listed twice.` });
                else aside.push(value);
              });
              layout.pages.chat.aside = aside;
            }
          }
        }
      }
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, layout };
}

// What a member sees: their own pick when the owner allows it, else the
// owner's layout. A switch keeps the owner's tabs, labels and About page and
// changes only the arrangement: "top" is the tab bar with the posts feed and
// side blocks, "side" is the channel column with the chat timeline.
export function layoutForMemberChoice(
  layout: CommunityLayoutV1,
  choice: CommunityLayoutPosition | null | undefined,
): CommunityLayoutV1 {
  if (!choice || choice === layout.navigation.position || !layout.navigation.member_choice.includes(choice)) return layout;
  const chat: CommunityLayoutV1["pages"]["chat"] =
    choice === "top"
      ? { presentation: "posts", aside: ["community_card", "upcoming_events"] }
      : { presentation: "messages", aside: [] };
  return {
    ...layout,
    navigation: { ...layout.navigation, position: choice },
    width: choice === "top" ? "centered" : "wide",
    pages: { ...layout.pages, chat },
  };
}

// Classroom's Community tab follows the theme's classroom_chat, whatever the
// layout record says (Rashid, 2026-10-27: post cards by default, a chat only
// when the owner picks it in Customize). A layout moved to the top without
// side blocks gets Classroom's usual ones.
export function layoutForClassroomChat(
  layout: CommunityLayoutV1,
  style: "posts" | "chat",
): CommunityLayoutV1 {
  if (layout.navigation.position !== "top") return layout;
  const chat: CommunityLayoutV1["pages"]["chat"] =
    style === "posts"
      ? { presentation: "posts", aside: layout.pages.chat.aside.length ? layout.pages.chat.aside : ["community_card", "upcoming_events"] }
      : { presentation: "messages", aside: layout.pages.chat.aside };
  if (chat.presentation === layout.pages.chat.presentation && chat.aside === layout.pages.chat.aside) return layout;
  return { ...layout, pages: { ...layout.pages, chat } };
}

export function communityLayoutTabLabel(layout: CommunityLayoutV1, tab: CommunityLayoutTab): string {
  const entry = layout.navigation.tabs.find((candidate) => candidate.tab === tab);
  return entry?.label || COMMUNITY_LAYOUT_TAB_DEFAULT_LABELS[tab];
}

export function visibleCommunityLayoutTabs(layout: CommunityLayoutV1): CommunityLayoutTabEntry[] {
  return layout.navigation.tabs.filter((entry) => !entry.hidden);
}
