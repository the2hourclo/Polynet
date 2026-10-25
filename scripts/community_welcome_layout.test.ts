import { describe, expect, it } from "vitest";
import {
  legacyWelcomeLayout, normalizeWelcomeLayout, welcomeLayoutIssue, welcomeLayoutWithForms, welcomeScreens, type WelcomeBlock,
} from "../shared/communityWelcomeLayout";

const text = (markdown: string): WelcomeBlock => ({ type: "text", markdown });
const form = (formKey: string): WelcomeBlock => ({ type: "form", formKey });
const lesson = (resourceId: string): WelcomeBlock => ({ type: "lesson", resourceId });
const next: WelcomeBlock = { type: "next" };

describe("welcome page layout", () => {
  it("splits the page into screens at each Next, and a second step on one screen starts its own", () => {
    const screens = welcomeScreens([text("Hi"), text("https://youtu.be/x"), next, text("About you"), form("intake"), lesson("l1"), next, next]);
    expect(screens.map((screen) => [screen.blocks.length, screen.step?.type ?? null])).toEqual([[2, null], [2, "form"], [1, "lesson"]]);
  });

  it("carries over a page saved before blocks: words and media first, each step on its own screen", () => {
    expect(legacyWelcomeLayout({ message: "Hello", mediaUrl: "https://youtu.be/x", formKeys: ["intake"], lessonIds: ["l1"] }))
      .toEqual([text("Hello\n\nhttps://youtu.be/x"), form("intake"), next, lesson("l1")]);
    expect(welcomeScreens(legacyWelcomeLayout({ message: "", mediaUrl: null, formKeys: ["a", "b"], lessonIds: [] }))).toHaveLength(2);
  });

  it("adds join forms the page doesn't place yet as screens at the end", () => {
    expect(welcomeLayoutWithForms([text("Hi"), form("a")], ["a", "b"])).toEqual([text("Hi"), form("a"), next, form("b")]);
  });

  it("tidies what the editor sends", () => {
    expect(normalizeWelcomeLayout([next, text("  Hi \r\n there "), text("  "), next, next, form(" a "), next]))
      .toEqual([text("Hi \n there"), next, form("a")]);
  });

  it("names what can't be saved", () => {
    expect(welcomeLayoutIssue([form("a"), next, form("a")])).toBe("welcome_step_duplicate");
    expect(welcomeLayoutIssue([text("x".repeat(4_001))])).toBe("welcome_text_too_long");
    expect(welcomeLayoutIssue(Array.from({ length: 41 }, () => text("x")))).toBe("welcome_layout_too_long");
    expect(welcomeLayoutIssue(Array.from({ length: 6 }, (_, i) => lesson(`l${i}`)))).toBe("welcome_lessons_too_many");
    expect(welcomeLayoutIssue([text("Hi"), form("a"), next, lesson("l1")])).toBeNull();
  });
});
