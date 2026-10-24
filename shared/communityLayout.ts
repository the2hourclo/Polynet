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
  },
  width: "wide",
  pages: {
    chat: { presentation: "messages", aside: [] },
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
    pages: { chat: { ...DEFAULT_COMMUNITY_LAYOUT.pages.chat, aside: [] } },
  };

  if (raw.navigation !== undefined) {
    if (!isRecord(raw.navigation)) {
      problems.push({ path: "navigation", message: "navigation is an object." });
    } else {
      const nav = raw.navigation;
      unknownKeys(nav, ["position", "tabs", "home"], "navigation", problems);
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
      unknownKeys(raw.pages, ["chat"], "pages", problems);
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

export function communityLayoutTabLabel(layout: CommunityLayoutV1, tab: CommunityLayoutTab): string {
  const entry = layout.navigation.tabs.find((candidate) => candidate.tab === tab);
  return entry?.label || COMMUNITY_LAYOUT_TAB_DEFAULT_LABELS[tab];
}

export function visibleCommunityLayoutTabs(layout: CommunityLayoutV1): CommunityLayoutTabEntry[] {
  return layout.navigation.tabs.filter((entry) => !entry.hidden);
}
