// The welcome page as one long page the owner writes, split into screens by
// "Next" breaks. Words and media are markdown text blocks (a link alone on a
// line plays as a video or shows as an image). A form or a lesson is a step:
// the member finishes it before going on, so each screen holds at most one.
// A choice shows cards (say, the app they use); picking one shows only its words.

/** icon: an https image link, or a small inline image (data:image/…), shown on the card. */
export type WelcomeChoiceOption = { label: string; hint: string; markdown: string; icon?: string };

export type WelcomeBlock =
  | { type: "text"; markdown: string }
  /** agent: shows the community's agent (its photo and name) above the cards as the plugin that connects to the picked app. */
  | { type: "choice"; prompt: string; options: WelcomeChoiceOption[]; agent?: boolean }
  /** questions: the keys of the questions this part shows, together on one screen. Without it, the whole form, one question at a time. */
  | { type: "form"; formKey: string; questions?: string[] }
  | { type: "lesson"; resourceId: string }
  | { type: "next" };

export type WelcomeStep = { type: "form"; formKey: string; questions?: string[] } | { type: "lesson"; resourceId: string };
export type WelcomeScreen = { blocks: WelcomeBlock[]; step: WelcomeStep | null };

/** Room for a form split into a page per question (30 questions and their breaks) beside the words. */
export const WELCOME_BLOCKS_MAX = 100;
export const WELCOME_TEXT_MAX = 4_000;
export const WELCOME_TEXT_TOTAL_MAX = 12_000;
export const WELCOME_FORMS_MAX = 5;
export const WELCOME_LESSONS_MAX = 5;
export const WELCOME_CHOICES_MAX = 3;
export const WELCOME_CHOICE_OPTIONS_MAX = 4;
export const WELCOME_CHOICE_PROMPT_MAX = 120;
export const WELCOME_CHOICE_LABEL_MAX = 40;
export const WELCOME_CHOICE_HINT_MAX = 160;
/** One option's words: room for a setup prompt someone pastes into their AI. */
export const WELCOME_CHOICE_TEXT_MAX = 8_000;
export const WELCOME_CHOICE_TEXT_TOTAL_MAX = 30_000;
export const WELCOME_CHOICE_ICON_MAX = 8_000;

/** A card icon must be an https image link or a small inline image; anything else is refused. */
export function isWelcomeChoiceIcon(value: string): boolean {
  return value.length <= WELCOME_CHOICE_ICON_MAX
    && (/^https:\/\/\S+$/i.test(value) || /^data:image\/(?:svg\+xml|png|jpeg|webp|gif)(?:;base64)?,[^\s"'<>]+$/i.test(value));
}

const isStepBlock = (block: WelcomeBlock): block is WelcomeStep => block.type === "form" || block.type === "lesson";

/** Screens in order. Empty screens (two breaks in a row, or a break at either end) are dropped. */
export function welcomeScreens(layout: WelcomeBlock[]): WelcomeScreen[] {
  const screens: WelcomeScreen[] = [];
  let current: WelcomeScreen = { blocks: [], step: null };
  const close = () => { if (current.blocks.length) screens.push(current); current = { blocks: [], step: null }; };
  for (const block of layout) {
    if (block.type === "next") { close(); continue; }
    if (block.type === "text" && !block.markdown.trim()) continue;
    if (isStepBlock(block)) {
      // A second step on one screen starts a screen of its own.
      if (current.step) close();
      current.step = block;
    }
    current.blocks.push(block);
  }
  close();
  return screens;
}

/** The page a welcome flow saved before blocks existed: the words and media first, then each step on its own screen. */
export function legacyWelcomeLayout(page: { message?: string | null; mediaUrl?: string | null; formKeys: string[]; lessonIds: string[] }): WelcomeBlock[] {
  const intro = [page.message?.trim(), page.mediaUrl?.trim()].filter(Boolean).join("\n\n");
  const steps: WelcomeBlock[] = [
    ...page.formKeys.map((formKey) => ({ type: "form" as const, formKey })),
    ...page.lessonIds.map((resourceId) => ({ type: "lesson" as const, resourceId })),
  ];
  return [
    ...(intro ? [{ type: "text" as const, markdown: intro }] : []),
    ...steps.flatMap((step, index) => (index ? [{ type: "next" as const }, step] : [step])),
  ];
}

/** The saved layout, with the join forms it doesn't place yet added as screens at the end, so none is hidden. */
export function welcomeLayoutWithForms(layout: WelcomeBlock[], formKeys: string[]): WelcomeBlock[] {
  const placed = new Set(layout.flatMap((block) => (block.type === "form" ? [block.formKey] : [])));
  const missing = formKeys.filter((key) => !placed.has(key));
  return [...layout, ...missing.flatMap((formKey) => [{ type: "next" as const }, { type: "form" as const, formKey }])];
}

export function welcomeLayoutSteps(layout: WelcomeBlock[]) {
  return {
    formKeys: [...new Set(layout.flatMap((block) => (block.type === "form" ? [block.formKey] : [])))],
    lessonIds: layout.flatMap((block) => (block.type === "lesson" ? [block.resourceId] : [])),
  };
}

/** Tidies what the editor sends: trims text, drops empty text and breaks that start, end or repeat. */
export function normalizeWelcomeLayout(layout: WelcomeBlock[]): WelcomeBlock[] {
  const out: WelcomeBlock[] = [];
  for (const block of layout) {
    if (block.type === "text") {
      const markdown = block.markdown.replace(/\r\n?/g, "\n").trim();
      if (markdown) out.push({ type: "text", markdown });
    } else if (block.type === "next") {
      if (out.length && out[out.length - 1].type !== "next") out.push({ type: "next" });
    } else if (block.type === "choice") {
      const options = block.options.map((option) => ({
        label: option.label.replace(/\s+/g, " ").trim(),
        hint: option.hint.replace(/\s+/g, " ").trim(),
        markdown: option.markdown.replace(/\r\n?/g, "\n").trim(),
        ...(option.icon?.trim() ? { icon: option.icon.trim() } : {}),
      })).filter((option) => option.label || option.markdown);
      if (options.length) out.push({ type: "choice", prompt: block.prompt.replace(/\s+/g, " ").trim(), options, ...(block.agent ? { agent: true } : {}) });
    } else if (block.type === "form") {
      const formKey = block.formKey.trim();
      const questions = block.questions?.map((key) => key.trim()).filter(Boolean);
      const last = out[out.length - 1];
      // Two parts of one form with nothing between them are one part.
      if (questions && last?.type === "form" && last.formKey === formKey && last.questions) last.questions.push(...questions);
      else if (!questions || questions.length) out.push({ type: "form", formKey, ...(questions ? { questions } : {}) });
    } else out.push({ type: "lesson", resourceId: block.resourceId.trim() });
  }
  while (out.length && out[out.length - 1].type === "next") out.pop();
  return out;
}

export type WelcomeLayoutIssue =
  | "welcome_layout_too_long" | "welcome_text_too_long" | "welcome_forms_too_many" | "welcome_lessons_too_many"
  | "welcome_step_duplicate" | "welcome_step_invalid" | "welcome_form_parts_invalid"
  | "welcome_choices_too_many" | "welcome_choice_invalid" | "welcome_choice_too_long";

/** Why a normalized layout can't be saved, or null. */
export function welcomeLayoutIssue(layout: WelcomeBlock[]): WelcomeLayoutIssue | null {
  if (layout.length > WELCOME_BLOCKS_MAX) return "welcome_layout_too_long";
  let total = 0;
  for (const block of layout) {
    if (block.type !== "text") continue;
    if (block.markdown.length > WELCOME_TEXT_MAX) return "welcome_text_too_long";
    total += block.markdown.length;
  }
  if (total > WELCOME_TEXT_TOTAL_MAX) return "welcome_text_too_long";
  const choices = layout.flatMap((block) => (block.type === "choice" ? [block] : []));
  if (choices.length > WELCOME_CHOICES_MAX) return "welcome_choices_too_many";
  let choiceTotal = 0;
  for (const choice of choices) {
    if (choice.prompt.length > WELCOME_CHOICE_PROMPT_MAX || choice.options.length > WELCOME_CHOICE_OPTIONS_MAX) return "welcome_choice_invalid";
    for (const option of choice.options) {
      if (!option.label || option.label.length > WELCOME_CHOICE_LABEL_MAX || option.hint.length > WELCOME_CHOICE_HINT_MAX) return "welcome_choice_invalid";
      if (option.icon !== undefined && !isWelcomeChoiceIcon(option.icon)) return "welcome_choice_invalid";
      if (option.markdown.length > WELCOME_CHOICE_TEXT_MAX) return "welcome_choice_too_long";
      choiceTotal += option.markdown.length;
    }
  }
  if (choiceTotal > WELCOME_CHOICE_TEXT_TOTAL_MAX) return "welcome_choice_too_long";
  const { formKeys, lessonIds } = welcomeLayoutSteps(layout);
  if (formKeys.some((key) => !key) || lessonIds.some((id) => !id)) return "welcome_step_invalid";
  if (formKeys.length > WELCOME_FORMS_MAX) return "welcome_forms_too_many";
  if (lessonIds.length > WELCOME_LESSONS_MAX) return "welcome_lessons_too_many";
  if (new Set(lessonIds).size !== lessonIds.length) return "welcome_step_duplicate";
  // A form placed more than once is split: every part names its questions, and no question shows twice.
  for (const formKey of formKeys) {
    const parts = layout.flatMap((block) => (block.type === "form" && block.formKey === formKey ? [block] : []));
    if (parts.length < 2) continue;
    if (parts.some((part) => !part.questions)) return "welcome_step_duplicate";
    const keys = parts.flatMap((part) => part.questions ?? []);
    if (keys.length > 30 || new Set(keys).size !== keys.length || keys.some((key) => key.length > 80)) return "welcome_form_parts_invalid";
  }
  return null;
}

/** Where one part of a split form sits among that form's parts, for the member's page: the last part sends the form in. */
export function welcomeFormPartPlace(layout: WelcomeBlock[], step: WelcomeStep): { index: number; count: number; last: boolean } {
  if (step.type !== "form") return { index: 0, count: 1, last: true };
  const parts = layout.flatMap((block) => (block.type === "form" && block.formKey === step.formKey ? [block] : []));
  const first = step.questions?.[0];
  const index = Math.max(0, parts.findIndex((part) => (first ? part.questions?.[0] === first : !part.questions)));
  return { index, count: parts.length, last: index === parts.length - 1 };
}

/** The questions one part shows, from the questions the member's copy of the form has. The last part also
 * picks up any the parts don't place (added to the form since the page was split), so none is skipped. */
export function welcomeFormPartQuestions<Q extends { key: string }>(layout: WelcomeBlock[], step: WelcomeStep, questions: Q[]): Q[] {
  if (step.type !== "form" || !step.questions) return questions;
  const placed = new Set(layout.flatMap((block) => (block.type === "form" && block.formKey === step.formKey ? block.questions ?? [] : [])));
  const mine = new Set(step.questions);
  const last = welcomeFormPartPlace(layout, step).last;
  return questions.filter((question) => mine.has(question.key) || (last && !placed.has(question.key)));
}
