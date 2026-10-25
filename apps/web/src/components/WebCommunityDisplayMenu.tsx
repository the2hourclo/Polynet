import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Hash, LayoutGrid, Moon, RotateCcw, Sun, SunMoon, type LucideIcon } from "lucide-react";
import type { CommunityLayoutPosition } from "../../../../shared/communityLayout";
import type { AppTheme } from "../../../../shared/theme";
import { useWebCommunityFrame } from "../controllers/useWebCommunityFrame";

// The member's Display menu at the top right of a community, like the
// reader's sun/moon toggle on Substack: Light or Dark where the community's
// look has both, and Classroom or Channels where the owner offers both
// layouts. Classroom puts it at the end of the tab bar's top row; Channels
// puts it beside Messages in the bar above the page. It shows nothing when
// there is nothing to choose. The panel is drawn on the page body so no
// scrolling column clips it, and it carries the community's theme with it.

type Option = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  checked: boolean | null;
  choose: () => void;
};

const MODE_OPTIONS: { theme: AppTheme; label: string; description: string; icon: LucideIcon }[] = [
  { theme: "light", label: "Light", description: "Light pages, dark text", icon: Sun },
  { theme: "dark", label: "Dark", description: "Dark pages, light text", icon: Moon },
];

const LAYOUT_OPTIONS: Record<CommunityLayoutPosition, { label: string; description: string; icon: LucideIcon }> = {
  top: { label: "Classroom", description: "Tabs across the top", icon: LayoutGrid },
  side: { label: "Channels", description: "Channels down the side", icon: Hash },
};

const PANEL_WIDTH = 288;
const VIEWPORT_MARGIN = 12;

export function WebCommunityDisplayMenu(props: { placement: "top" | "bar" }) {
  const { community, layoutChoice, displayMode } = useWebCommunityFrame();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_MARGIN));
    setPosition({ top: rect.bottom + 8, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  // Focus starts on the selected option, as in a native menu.
  useEffect(() => {
    if (!open || !position) return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']");
    const checked = panelRef.current?.querySelector<HTMLElement>("[aria-checked='true']");
    (checked ?? items?.[0])?.focus();
  }, [open, position]);

  const modeOptions: Option[] = displayMode
    ? MODE_OPTIONS.map((option) => ({
        key: `mode:${option.theme}`,
        label: option.label,
        description: option.description,
        icon: option.icon,
        checked: displayMode.current === option.theme,
        choose: () => displayMode.onChoose(option.theme),
      }))
    : [];
  const layoutOptions: Option[] = layoutChoice
    ? layoutChoice.allowed.map((entry) => ({
        key: `layout:${entry}`,
        ...LAYOUT_OPTIONS[entry],
        checked: layoutChoice.current === entry,
        choose: () => layoutChoice.onChoose(entry === layoutChoice.standard ? null : entry),
      }))
    : [];
  if (layoutChoice?.preference && layoutChoice.preference !== layoutChoice.standard) {
    layoutOptions.push({
      key: "layout:standard",
      label: "Community default",
      description: `Back to ${LAYOUT_OPTIONS[layoutChoice.standard].label}`,
      icon: RotateCcw,
      checked: null,
      choose: () => layoutChoice.onChoose(null),
    });
  }
  if (modeOptions.length === 0 && layoutOptions.length === 0) return null;

  const TriggerIcon = displayMode
    ? SunMoon
    : LAYOUT_OPTIONS[layoutChoice?.current ?? "top"].icon;

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown" ? items[(index + 1) % items.length]
      : event.key === "ArrowUp" ? items[(index - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0]
      : event.key === "End" ? items[items.length - 1]
      : null;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const renderOption = (option: Option) => {
    const Icon = option.icon;
    return (
      <button
        key={option.key}
        type="button"
        role={option.checked === null ? "menuitem" : "menuitemradio"}
        aria-checked={option.checked === null ? undefined : option.checked}
        tabIndex={-1}
        className={`community-display-option${option.checked ? " is-selected" : ""}`}
        onClick={() => {
          option.choose();
          close(true);
        }}
      >
        <span className="community-display-option-icon" aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
        <span className="community-display-option-text">
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </span>
        {option.checked ? <Check className="community-display-option-check" size={16} strokeWidth={2} aria-hidden="true" /> : null}
      </button>
    );
  };

  const panel = open && position ? createPortal(
    <div className="community-theme-scope" data-community-theme={community?.id ?? undefined}>
      <div
        ref={panelRef}
        className="community-display-panel"
        role="menu"
        aria-label="Display"
        style={{ top: position.top, left: position.left, width: Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2) }}
        onKeyDown={onPanelKeyDown}
      >
        {modeOptions.length > 0 ? (
          <div role="group" aria-label="Mode">
            <div className="community-display-group" aria-hidden="true">Mode</div>
            {modeOptions.map(renderOption)}
          </div>
        ) : null}
        {layoutOptions.length > 0 ? (
          <div role="group" aria-label="Layout">
            <div className="community-display-group" aria-hidden="true">Layout</div>
            {layoutOptions.map(renderOption)}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={props.placement === "top"
          ? `community-top-nav-icon${open ? " is-open" : ""}`
          : `icon-button community-display-bar-button${open ? " active" : ""}`}
        aria-label="Display"
        title="Display"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <TriggerIcon size={20} strokeWidth={2} aria-hidden="true" />
      </button>
      {panel}
    </>
  );
}
