import { describe, expect, it } from "vitest";
import { readWelcomePersonalTurn, welcomeAnswerWords, welcomePersonalBackup, welcomePersonalLimit, welcomePersonalPrompt, WELCOME_PERSONAL_TOOLS } from "../shared/communityWelcomePersonal";

let n = 0;
const key = () => `k${++n}`;

describe("personalized welcome questions", () => {
  it("reads the agent's ask_question tool call as one required question with a fresh key", () => {
    const turn = readWelcomePersonalTurn({ ok: true, type: "tool_call", toolName: "ask_question",
      arguments: { title: "Which takes most of your week?", description: "", type: "single_choice", options: ["Email", "Calls", "Admin"] } }, key);
    expect(turn).toMatchObject({ kind: "ask", question: { title: "Which takes most of your week?", type: "single_choice", required: true, options: ["Email", "Calls", "Admin"] } });
    expect(turn?.kind === "ask" && turn.question.key).toMatch(/^k\d+$/);
    expect(turn?.kind === "ask" && "clientPropertyKey" in turn.question).toBe(false);
  });

  it("finishes when the agent calls finish, and reads a JSON reply from an engine without tools", () => {
    expect(readWelcomePersonalTurn({ ok: true, type: "tool_call", toolName: "finish", arguments: { covered_parts: [{ part: "tool", answer_quote: "Gmail" }], open_parts: [] } }, key))
      .toEqual({ kind: "finish", openParts: [], covered: [{ part: "tool", quote: "Gmail" }] });
    expect(readWelcomePersonalTurn({ ok: true, type: "tool_call", toolName: "finish", arguments: { covered_parts: [], open_parts: ["how they'd know it worked"] } }, key))
      .toEqual({ kind: "finish", openParts: ["how they'd know it worked"], covered: [] });
    expect(readWelcomePersonalTurn({ ok: true, type: "assistant", assistantText: '{"finish": true}' }, key)).toEqual({ kind: "finish", openParts: [], covered: [] });
    expect(readWelcomePersonalTurn({ ok: true, type: "assistant", assistantText: 'Here: {"ask": {"title": "What do you sell?", "type": "short_text", "options": []}}' }, key))
      .toMatchObject({ kind: "ask", question: { title: "What do you sell?", type: "short_text" } });
  });

  it("gives up on a reply it can't use, so the backup is asked", () => {
    expect(readWelcomePersonalTurn({ ok: true, type: "assistant", assistantText: "Sure! Here are some questions…" }, key)).toBeNull();
    expect(readWelcomePersonalTurn({ ok: true, type: "tool_call", toolName: "write", arguments: {} }, key)).toBeNull();
    expect(welcomePersonalBackup("What brought you here?", "b")).toEqual({ key: "b", title: "What brought you here?", description: "", type: "long_text", required: true, options: [] });
  });

  it("tells the agent how many it may still ask, within the owner's limit", () => {
    expect(welcomePersonalLimit(9)).toBe(5);
    expect(welcomePersonalLimit(0)).toBe(1);
    expect(welcomePersonalPrompt(0, 3)).toContain("first question");
    expect(welcomePersonalPrompt(2, 3)).toContain("1 more at most");
    expect(WELCOME_PERSONAL_TOOLS.map((tool) => tool.name)).toEqual(["ask_question", "finish"]);
  });

  it("reads choice answers to the agent as the words the member picked", () => {
    const question = { key: "q", title: "App", description: "", type: "multiple_choice" as const, required: true, options: ["Claude", "Codex"] };
    expect(welcomeAnswerWords(question, ["0", "1"])).toBe("Claude, Codex");
    expect(welcomeAnswerWords({ ...question, type: "single_choice" }, "1")).toBe("Codex");
  });
});

describe("repeat guard", () => {
  it("spots a question the agent already asked on the page, reworded", async () => {
    const { welcomePersonalRepeats } = await import("../shared/communityWelcomePersonal");
    const asked = ["What's stopping you from handing off those client follow-up emails today?"];
    expect(welcomePersonalRepeats("What is stopping you from handing off the client follow-up emails today?", asked)).toBe(true);
    expect(welcomePersonalRepeats("Which tool do you write those emails in?", asked)).toBe(false);
    const goal = "Find out which email tool they use for client follow-up emails, what stops them handing it off, and how they'd know it worked";
    const both = [...asked, "Which email tool do you send client follow-up emails from?"];
    expect(welcomePersonalRepeats("How would you know handing off your client follow-up emails worked?", both, goal)).toBe(false);
    expect(welcomePersonalRepeats("What's stopping you from handing off those client follow-up emails today?", both, goal)).toBe(true);
  });

  it("doesn't count words the member used in their answers", async () => {
    const { welcomePersonalRepeats } = await import("../shared/communityWelcomePersonal");
    const asked = ["Which email tool do you write client follow-up emails in?", "What's stopping you from handing those follow-ups off?"];
    const known = "Find out their email tool, what stops them, and how they'd know it worked Gmail I never wrote down how I write client follow-up emails";
    expect(welcomePersonalRepeats("How would you know the follow-up emails were going out well without you?", asked, known)).toBe(false);
  });

  it("needs a real quote for each covered part, and reads the goal's own parts", async () => {
    const { welcomePersonalQuoteFound, welcomeGoalParts, welcomeGoalPartsOpen } = await import("../shared/communityWelcomePersonal");
    const answers = ["Gmail, and I write every follow-up by hand.", "I don't trust AI with client details yet, and I don't know where to start."];
    expect(welcomePersonalQuoteFound("I write every follow-up by hand", answers)).toBe(true);
    expect(welcomePersonalQuoteFound("I'd know because replies go out the same day", answers)).toBe(false);
    const goal = "Find out which email tool they use, what stops them handing off follow-ups, and how they'd know it worked";
    expect(welcomeGoalParts(goal)).toEqual(["which email tool they use", "what stops them handing off follow-ups", "how they'd know it worked"]);
    expect(welcomeGoalPartsOpen(goal, ["email tool", "what stops them handing off"])).toEqual(["how they'd know it worked"]);
    expect(welcomeGoalPartsOpen("Find out what they want to automate first", ["automate"])).toEqual([]);
  });
});
