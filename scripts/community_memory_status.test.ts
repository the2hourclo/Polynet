import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("the memory card says why the agent couldn't run instead of a bare Error", () => {
  const source = read("apps/web/src/components/ChannelRosterPanel.tsx");
  expect(source).toContain('<span>{memoryAgentStatus(memory)}</span>');
  expect(source).toContain('stop_reason?.startsWith("founder_inference")');
  expect(source).toContain("Couldn't run: AI usage isn't set up or has run out");
  expect(source).toContain("Couldn't run last time");
});
