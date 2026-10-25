// Callouts in a lesson: a quote whose first line names its type, the same
// "> [!TIP]" alerts GitHub and Obsidian read, so agents and the CLI can write
// them and other Markdown tools still show something sensible.
//
//   > [!TIP]
//   > Connect one tool first.

export type LessonCalloutType = "tip" | "note" | "important" | "action" | "warning";

export const LESSON_CALLOUTS: readonly { type: LessonCalloutType; marker: string; label: string; hint: string }[] = [
  { type: "tip", marker: "TIP", label: "Tip", hint: "A helpful shortcut" },
  { type: "note", marker: "NOTE", label: "Note", hint: "Good to know" },
  { type: "important", marker: "IMPORTANT", label: "Key idea", hint: "The one thing to remember" },
  { type: "action", marker: "ACTION", label: "Do this", hint: "A step to take now" },
  { type: "warning", marker: "WARNING", label: "Warning", hint: "A mistake to avoid" },
];

// Other names writers use for the same callouts.
const ALIASES: Record<string, LessonCalloutType> = { CAUTION: "warning", KEY: "important", DO: "action", TODO: "action" };

/** "[!TIP]" at the very start of a quote's first line, and any spaces after it. */
export const LESSON_CALLOUT_MARKER = /^\[!([A-Za-z]+)\][ \t]*/;

export function lessonCalloutType(value: unknown): LessonCalloutType | null {
  if (typeof value !== "string") return null;
  const word = value.toUpperCase();
  return LESSON_CALLOUTS.find((callout) => callout.marker === word || callout.type.toUpperCase() === word)?.type ?? ALIASES[word] ?? null;
}

export function lessonCallout(type: LessonCalloutType) {
  return LESSON_CALLOUTS.find((callout) => callout.type === type) ?? LESSON_CALLOUTS[0];
}

export function lessonCalloutMarker(type: LessonCalloutType): string {
  return `[!${lessonCallout(type).marker}]`;
}
