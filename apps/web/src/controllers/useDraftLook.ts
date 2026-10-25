import { useMemo } from "react";
import { DEFAULT_COMMUNITY_THEME, type CommunityThemeV1 } from "../../../../shared/communityTheme";

// DRAFT OPTIONS (2026-10-25): three Substack-feel looks for the Channels
// layout, and the far-left rail a little bigger and in the community's
// colours. The owner picks them in Settings → Appearance → Customize (theme
// tokens channels_look, rail_size, rail_color), so they follow the theme's
// draft, preview and publish. For side-by-side screenshots, the address can
// override them in this tab only: ?feel=, ?rail_size=, ?rail_color=.

export type ChannelsFeel = CommunityThemeV1["channels_look"];
export type RailSize = CommunityThemeV1["rail_size"];
export type RailColor = CommunityThemeV1["rail_color"];
export type DraftLook = { feel: ChannelsFeel; railSize: RailSize; railColor: RailColor };

const FEELS: readonly ChannelsFeel[] = ["current", "quiet", "reader", "publication"];
const RAIL_SIZES: readonly RailSize[] = ["standard", "large"];
const RAIL_COLORS: readonly RailColor[] = ["polynet", "blend", "tint", "brand"];

const URL_OVERRIDE: Partial<DraftLook> = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const pick = <T extends string>(name: string, values: readonly T[]) => {
      const value = params.get(name);
      return values.includes(value as T) ? (value as T) : undefined;
    };
    const override: Partial<DraftLook> = {
      feel: pick("feel", FEELS),
      railSize: pick("rail_size", RAIL_SIZES),
      railColor: pick("rail_color", RAIL_COLORS),
    };
    return Object.fromEntries(Object.entries(override).filter(([, value]) => value)) as Partial<DraftLook>;
  } catch {
    return {};
  }
})();

export function useDraftLook(theme: CommunityThemeV1 | null): DraftLook {
  const look = theme ?? DEFAULT_COMMUNITY_THEME;
  return useMemo(() => ({
    feel: look.channels_look ?? "current",
    railSize: look.rail_size ?? "standard",
    railColor: look.rail_color ?? "polynet",
    ...URL_OVERRIDE,
  }), [look.channels_look, look.rail_size, look.rail_color]);
}
