// @vitest-environment node

import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.mock("katex/dist/katex.min.css", () => ({}));

import { WelcomeIntro } from "../apps/web/src/components/WebCommunityWelcome";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createElement } = requireFromWeb("react") as typeof import("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as typeof import("react-dom/server");

describe("welcome page preview", () => {
  it("renders the member's welcome intro, a level down when it sits under Settings' Preview heading", () => {
    const markup = renderToStaticMarkup(createElement(WelcomeIntro, {
      title: "Welcome to the 2-Hour Club", message: "Glad you're **here**.", mediaUrl: null,
      total: 2, stepLine: "Step 1 of 2", headingLevel: 3,
    }));

    expect(markup).toContain('<h1 tabindex="-1" aria-level="3">Welcome to the 2-Hour Club</h1>');
    expect(markup).toContain("<strong>here</strong>");
    expect(markup).toContain("Step 1 of 2");
  });

  it("keeps the member page's own heading level and default line", () => {
    const markup = renderToStaticMarkup(createElement(WelcomeIntro, {
      title: "Welcome", message: null, mediaUrl: null, total: 1, stepLine: null,
    }));

    expect(markup).toContain('<h1 tabindex="-1">Welcome</h1>');
    expect(markup).toContain("Finish this step to open the community.");
  });
});
