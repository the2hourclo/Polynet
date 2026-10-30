import { describe, expect, it } from "vitest";
import { normalizeWelcomePersonalQuestions, welcomeAnswerWords, welcomePersonalBackup, welcomePersonalPrompt } from "../shared/communityWelcomePersonal";

let n = 0;
const key = () => `k${++n}`;

describe("personalized welcome questions", () => {
  it("keeps at most the asked-for number of the agent's questions, with fresh keys", () => {
    const reply = JSON.stringify({ questions: [
      { title: "What do you sell?", type: "short_text", required: true, options: [] },
      { title: "Which takes most of your week?", type: "single_choice", required: true, options: ["Email", "Calls", "Admin"] },
      { title: "Third", type: "long_text", required: false, options: [] },
    ] });
    const questions = normalizeWelcomePersonalQuestions(reply, 2, key);
    expect(questions?.map((q) => [q.title, q.type])).toEqual([["What do you sell?", "short_text"], ["Which takes most of your week?", "single_choice"]]);
    expect(new Set(questions?.map((q) => q.key)).size).toBe(2);
    expect(questions?.[0]).not.toHaveProperty("clientPropertyKey");
  });

  it("gives up on a reply it can't use, so the backup is asked", () => {
    expect(normalizeWelcomePersonalQuestions("Sure! Here are some questions…", 2, key)).toBeNull();
    expect(welcomePersonalBackup("What brought you here?", "b")).toEqual([{ key: "b", title: "What brought you here?", description: "", type: "long_text", required: true, options: [] }]);
  });

  it("reads choice answers to the agent as the words the member picked", () => {
    const question = { key: "q", title: "App", description: "", type: "multiple_choice" as const, required: true, options: ["Claude", "Codex"] };
    expect(welcomeAnswerWords(question, ["0", "1"])).toBe("Claude, Codex");
    expect(welcomeAnswerWords({ ...question, type: "single_choice" }, "1")).toBe("Codex");
    expect(welcomeAnswerWords({ ...question, type: "short_text" }, "Coaching")).toBe("Coaching");
    expect(welcomePersonalPrompt(1)).toContain("one question");
  });
});
