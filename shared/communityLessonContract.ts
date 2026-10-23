// Lesson presentation data for a resource page. The same lesson can be shown
// as a board card, a library row or a wizard step; these fields say where it
// sits and what it carries. The Markdown body stays canonical: platform
// variants, slides and commands are derived from it on read, never stored twice.

export const COMMUNITY_LESSON_KINDS = [
  "lesson",
  "build",
  "checkpoint",
  "prompt",
  "skill",
  "video",
  "doc",
] as const;

export type CommunityLessonKind = (typeof COMMUNITY_LESSON_KINDS)[number];

export type CommunityLessonFields = {
  kind?: CommunityLessonKind;
  // Board column. Absent keeps the lesson in the library only.
  stage?: string;
  stage_order?: number;
  order?: number;
  minutes?: number;
  video_url?: string;
  // A gate keeps every later stage locked until the member completes it.
  gate?: boolean;
  summary?: string;
};

export type CommunityLessonVariant = {
  key: string;
  label: string;
  body_md: string;
};

export type CommunityLessonSlide = {
  image: string;
  alt: string;
  note_md: string;
};

export type CommunityLessonCommand = {
  variant: string | null;
  language: string | null;
  text: string;
};

export type CommunityLessonProjection = {
  intro_md: string;
  variants: CommunityLessonVariant[];
  slides: CommunityLessonSlide[];
  commands: CommunityLessonCommand[];
};

const STAGE_MAX_CHARS = 80;
const SUMMARY_MAX_CHARS = 280;
const VIDEO_URL_MAX_CHARS = 2_048;
const MAX_VARIANTS = 8;
const MAX_SLIDES = 60;
const MAX_COMMANDS = 60;
const COMMAND_MAX_CHARS = 4_000;

function lessonError(field: string): Error {
  return new Error(`community_lesson_${field}_invalid`);
}

function boundedInteger(raw: unknown, field: string, max: number): number {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw lessonError(field);
  }
  return value;
}

function inlineText(raw: unknown, field: string, maxChars: number): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "string") throw lessonError(field);
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length > maxChars) throw lessonError(field);
  return text || undefined;
}

function gateValue(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "yes" || text === "true") return true;
  if (text === "no" || text === "false" || text === "") return false;
  throw lessonError("gate");
}

function videoUrl(raw: unknown): string | undefined {
  const text = inlineText(raw, "video_url", VIDEO_URL_MAX_CHARS);
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw lessonError("video_url");
  }
  if (url.protocol !== "https:") throw lessonError("video_url");
  return url.toString();
}

/**
 * Validates builder input. Returns null when nothing is set, so callers can
 * clear the field. Unknown keys are refused rather than silently dropped.
 */
export function normalizeCommunityLessonFields(raw: unknown): CommunityLessonFields | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw lessonError("fields");
  const record = raw as Record<string, unknown>;
  const allowed = new Set(["kind", "stage", "stage_order", "order", "minutes", "video_url", "gate", "summary"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw lessonError(key);
  }
  const next: CommunityLessonFields = {};
  if (record.kind !== undefined && record.kind !== null) {
    const kind = String(record.kind).trim().toLowerCase();
    if (!(COMMUNITY_LESSON_KINDS as readonly string[]).includes(kind)) throw lessonError("kind");
    next.kind = kind as CommunityLessonKind;
  }
  const stage = inlineText(record.stage, "stage", STAGE_MAX_CHARS);
  if (stage) next.stage = stage;
  if (record.stage_order !== undefined && record.stage_order !== null) {
    next.stage_order = boundedInteger(record.stage_order, "stage_order", 999);
  }
  if (record.order !== undefined && record.order !== null) {
    next.order = boundedInteger(record.order, "order", 9_999);
  }
  if (record.minutes !== undefined && record.minutes !== null) {
    next.minutes = boundedInteger(record.minutes, "minutes", 600);
  }
  const video = videoUrl(record.video_url);
  if (video) next.video_url = video;
  if (record.gate !== undefined && record.gate !== null && gateValue(record.gate)) next.gate = true;
  const summary = inlineText(record.summary, "summary", SUMMARY_MAX_CHARS);
  if (summary) next.summary = summary;
  if (next.gate && !next.stage) throw lessonError("gate_without_stage");
  return Object.keys(next).length ? next : null;
}

const FRONT_MATTER_KEYS: Record<string, keyof CommunityLessonFields> = {
  type: "kind",
  kind: "kind",
  stage: "stage",
  stage_order: "stage_order",
  order: "order",
  minutes: "minutes",
  video: "video_url",
  video_url: "video_url",
  gate: "gate",
  summary: "summary",
};

/**
 * Splits a portal-style Markdown file ("---" front matter, then the body) into
 * a title, lesson fields and the body. Lets an importer or the builder's agent
 * hand over the same files the course portal uses.
 */
export function parseCommunityLessonMarkdown(source: string): {
  title: string | null;
  lesson: CommunityLessonFields | null;
  body_md: string;
} {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { title: null, lesson: null, body_md: text.trim() };
  let title: string | null = null;
  const raw: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z_]+):\s*(.*)$/.exec(line.replace(/\s+#.*$/, ""));
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key === "title") {
      title = value || null;
      continue;
    }
    const field = FRONT_MATTER_KEYS[key];
    if (field && value) raw[field] = value;
  }
  return {
    title,
    lesson: normalizeCommunityLessonFields(raw),
    body_md: text.slice(match[0].length).trim(),
  };
}

function variantKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

const FENCE = /^(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;

function extractCommands(markdown: string, variant: string | null, into: CommunityLessonCommand[]) {
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length && into.length < MAX_COMMANDS; i += 1) {
    const open = FENCE.exec(lines[i]);
    if (!open) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(open[1])) body.push(lines[j++]);
    const text = body.join("\n").trim();
    if (text) {
      into.push({ variant, language: open[2] || null, text: text.slice(0, COMMAND_MAX_CHARS) });
    }
    i = j;
  }
}

function parseSlides(markdown: string): CommunityLessonSlide[] {
  const slides: CommunityLessonSlide[] = [];
  const notes: string[][] = [];
  for (const line of markdown.split("\n")) {
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (image) {
      if (slides.length >= MAX_SLIDES) break;
      slides.push({ image: image[2], alt: image[1], note_md: "" });
      notes.push([]);
    } else if (notes.length) {
      notes[notes.length - 1].push(line);
    }
  }
  return slides.map((slide, index) => ({ ...slide, note_md: notes[index].join("\n").trim() }));
}

/**
 * Derives the structured parts of a lesson body:
 * - "### In <Platform>" headings split it into platform variants;
 * - a "## Slides" section of image lines, each followed by its note, is a deck;
 * - fenced code blocks are commands, tagged with the variant they sit in.
 * Text before the first variant heading is the shared intro.
 */
export function projectCommunityLessonBody(bodyMd: string | null | undefined): CommunityLessonProjection {
  const text = String(bodyMd ?? "").replace(/\r\n?/g, "\n");
  const [main, ...slideParts] = text.split(/^## Slides[ \t]*$/m);
  const slideSection = slideParts.join("\n").split(/^## (?!#)/m)[0] ?? "";
  const headings = [...main.matchAll(/^### In (.+?)\s*$/gm)];
  const intro = (headings.length ? main.slice(0, headings[0].index) : main).trim();
  const commands: CommunityLessonCommand[] = [];
  extractCommands(intro, null, commands);
  const variants: CommunityLessonVariant[] = [];
  const seen = new Set<string>();
  headings.slice(0, MAX_VARIANTS).forEach((heading, index) => {
    const label = heading[1].trim();
    const key = variantKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? main.length;
    const body = main.slice(start, end).trim();
    variants.push({ key, label, body_md: body });
    extractCommands(body, key, commands);
  });
  return {
    intro_md: intro,
    variants,
    slides: slideParts.length ? parseSlides(slideSection) : [],
    commands,
  };
}
