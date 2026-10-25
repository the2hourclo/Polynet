import { useEffect, useState } from "react";

// DRAFT EXPERIMENT (2026-10-25): looks to compare before anything is kept.
// - feel: three Substack-feel looks for the Channels layout.
// - railSize / railColor: the far-left community rail a little bigger, and
//   in the community's colours instead of Polynet's.
// Each pick is this browser's only (localStorage). URL params set them:
// ?feel=quiet|reader|publication|current, ?rail_size=standard|large,
// ?rail_color=polynet|blend|tint|brand. Nothing is stored on the server.

// While true, the Display menu always shows, carrying the draft look choices.
export const DRAFT_LOOKS_IN_DISPLAY_MENU = true;

export type ChannelsFeel = "current" | "quiet" | "reader" | "publication";
export type RailSize = "standard" | "large";
export type RailColor = "polynet" | "blend" | "tint" | "brand";
export type DraftLook = { feel: ChannelsFeel; railSize: RailSize; railColor: RailColor };

export const CHANNELS_FEELS: { key: ChannelsFeel; label: string; description: string }[] = [
  { key: "current", label: "Current", description: "Today's Channels look" },
  { key: "quiet", label: "Quiet", description: "Plain nav, one centred column" },
  { key: "reader", label: "Reader", description: "Reading column and post lists" },
  { key: "publication", label: "Publication", description: "Masthead and editorial pages" },
];

export const RAIL_SIZES: { key: RailSize; label: string; description: string }[] = [
  { key: "standard", label: "Standard icons", description: "Today's rail" },
  { key: "large", label: "Bigger icons", description: "Larger community icons" },
];

export const RAIL_COLORS: { key: RailColor; label: string; description: string }[] = [
  { key: "polynet", label: "Polynet", description: "Today's dark rail" },
  { key: "blend", label: "Blend", description: "Same colour as the page" },
  { key: "tint", label: "Tint", description: "A soft wash of the brand colour" },
  { key: "brand", label: "Brand", description: "Solid brand colour" },
];

const DEFAULT_LOOK: DraftLook = { feel: "current", railSize: "standard", railColor: "polynet" };
const FIELDS = [
  { field: "feel", param: "feel", storage: "polynet.channelsFeel", values: CHANNELS_FEELS },
  { field: "railSize", param: "rail_size", storage: "polynet.railSize", values: RAIL_SIZES },
  { field: "railColor", param: "rail_color", storage: "polynet.railColor", values: RAIL_COLORS },
] as const;
const EVENT = "polynet:draft-look";

function readLook(): DraftLook {
  const look: Record<string, string> = { ...DEFAULT_LOOK };
  let params: URLSearchParams | null = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = null;
  }
  for (const entry of FIELDS) {
    const valid = (value: string | null | undefined) => entry.values.some((option) => option.key === value);
    try {
      const fromUrl = params?.get(entry.param);
      if (valid(fromUrl)) {
        window.localStorage.setItem(entry.storage, fromUrl!);
        look[entry.field] = fromUrl!;
        continue;
      }
      const stored = window.localStorage.getItem(entry.storage);
      if (valid(stored)) look[entry.field] = stored!;
    } catch {
      // Private windows: defaults.
    }
  }
  return look as DraftLook;
}

export function chooseDraftLook(change: Partial<DraftLook>) {
  for (const entry of FIELDS) {
    const value = change[entry.field];
    if (!value) continue;
    try {
      window.localStorage.setItem(entry.storage, value);
    } catch {
      // The pick lasts until reload.
    }
  }
  window.dispatchEvent(new CustomEvent<Partial<DraftLook>>(EVENT, { detail: change }));
}

export function useDraftLook(): DraftLook {
  const [look, setLook] = useState<DraftLook>(() => (typeof window === "undefined" ? DEFAULT_LOOK : readLook()));
  useEffect(() => {
    const onChange = (event: Event) => {
      const change = (event as CustomEvent<Partial<DraftLook>>).detail;
      setLook((current) => ({ ...current, ...change }));
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return look;
}
