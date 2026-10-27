import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseLessonChapterLine } from "../apps/web/src/components/WebCommunityResourceViewerContent";

test("chapter lines read the way YouTube descriptions write them", () => {
  expect(parseLessonChapterLine("02:15 Set up the map")).toEqual({ time: "02:15", seconds: 135, label: "Set up the map" });
  expect(parseLessonChapterLine("1:02:03 - Wrap up")).toEqual({ time: "1:02:03", seconds: 3723, label: "Wrap up" });
  expect(parseLessonChapterLine("(0:00) Intro")).toEqual({ time: "0:00", seconds: 0, label: "Intro" });
  expect(parseLessonChapterLine("At 02:15 we start")).toBeNull();
  expect(parseLessonChapterLine("02:15")).toBeNull();
});

test("chapters sit in the right panel and seek the video, reloading it only once", () => {
  const source = readFileSync(new URL("../apps/web/src/components/WebCommunityResourceViewerContent.tsx", import.meta.url), "utf8");
  expect(source).toContain('<nav className="lesson-rail-section" aria-label="Video chapters">');
  expect(source).toContain('url.searchParams.set("enablejsapi", "1")');
  expect(source).toContain('JSON.stringify({ event: "command", func, args })');
});
