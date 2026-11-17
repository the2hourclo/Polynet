// Member properties: fields a host defines about the people in their community
// ("Business type", "Stage", "Revenue") and fills in on each member's record.
// They are the host's own records, kept apart from member facts (memberFacts),
// which belong to the member and need their consent. Members never read them.
// Ported from the fork's Members database (communityClients), trimmed to the
// properties themselves: definitions, values, and up to three shown in the table.

export const MEMBER_PROPERTY_TYPES = ["text", "number", "select", "multi_select", "date", "checkbox", "url"] as const;
export type MemberPropertyType = (typeof MEMBER_PROPERTY_TYPES)[number];

export const MEMBER_PROPERTY_LIMIT = 30;
export const MEMBER_PROPERTY_TABLE_LIMIT = 3;
export const MEMBER_PROPERTY_NAME_MAX = 60;
export const MEMBER_PROPERTY_OPTION_LIMIT = 30;
export const MEMBER_PROPERTY_OPTION_MAX = 60;
export const MEMBER_PROPERTY_TEXT_MAX = 2000;
export const MEMBER_PROPERTY_URL_MAX = 2000;

export type MemberPropertyValue = string | number | boolean | string[];

export type MemberPropertyDefinition = {
  key: string;
  name: string;
  type: MemberPropertyType;
  options: string[];
};

export const MEMBER_PROPERTY_TYPE_LABELS: Record<MemberPropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "One choice",
  multi_select: "Several choices",
  date: "Date",
  checkbox: "Yes or no",
  url: "Link",
};

export class MemberPropertyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function cleanName(value: unknown, max: number, code: string): string {
  if (typeof value !== "string") throw new MemberPropertyError(code);
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > max) throw new MemberPropertyError(code);
  return name;
}

/** A stable key from a property name: "Business offer" -> "business_offer". */
export function memberPropertyKey(name: string): string {
  const key = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return key || "property";
}

export function normalizeMemberPropertyOptions(type: MemberPropertyType, options: unknown): string[] {
  if (type !== "select" && type !== "multi_select") {
    if (options !== undefined && !(Array.isArray(options) && options.length === 0)) {
      throw new MemberPropertyError("member_property_options_not_allowed");
    }
    return [];
  }
  if (!Array.isArray(options) || options.length === 0 || options.length > MEMBER_PROPERTY_OPTION_LIMIT) {
    throw new MemberPropertyError("member_property_options_invalid");
  }
  const seen = new Set<string>();
  return options.map((option) => {
    const name = cleanName(option, MEMBER_PROPERTY_OPTION_MAX, "member_property_options_invalid");
    if (seen.has(name.toLowerCase())) throw new MemberPropertyError("member_property_options_duplicate");
    seen.add(name.toLowerCase());
    return name;
  });
}

export function normalizeMemberPropertyDraft(draft: { name: unknown; type: unknown; options?: unknown }) {
  const name = cleanName(draft.name, MEMBER_PROPERTY_NAME_MAX, "member_property_name_invalid");
  if (!MEMBER_PROPERTY_TYPES.includes(draft.type as MemberPropertyType)) {
    throw new MemberPropertyError("member_property_type_invalid");
  }
  const type = draft.type as MemberPropertyType;
  return { name, type, options: normalizeMemberPropertyOptions(type, draft.options) };
}

/** Options typed as one line, separated by commas: "Coach, Agency, SaaS". */
export function splitMemberPropertyOptions(text: string): string[] {
  return text.split(/[,\n]/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * Checks one value against its property. `null` clears it. Dates are stored
 * as YYYY-MM-DD so they read the same in every timezone.
 */
export function normalizeMemberPropertyValue(property: MemberPropertyDefinition, value: unknown): MemberPropertyValue | null {
  if (value === null || value === undefined) return null;
  const invalid = () => new MemberPropertyError("member_property_value_invalid");
  switch (property.type) {
    case "text": {
      if (typeof value !== "string" || value.length > MEMBER_PROPERTY_TEXT_MAX) throw invalid();
      const text = value.trim();
      return text ? text : null;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
      return value;
    case "checkbox":
      if (typeof value !== "boolean") throw invalid();
      return value ? true : null;
    case "date": {
      if (typeof value !== "string") throw invalid();
      if (!value.trim()) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid();
      return value;
    }
    case "url": {
      if (typeof value !== "string" || value.length > MEMBER_PROPERTY_URL_MAX) throw invalid();
      const text = value.trim();
      if (!text) return null;
      let url: URL;
      try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { throw invalid(); }
      if (url.protocol !== "https:" && url.protocol !== "http:") throw invalid();
      return url.toString();
    }
    case "select": {
      if (typeof value !== "string") throw invalid();
      if (!value.trim()) return null;
      const option = property.options.find((name) => name.toLowerCase() === value.trim().toLowerCase());
      if (!option) throw invalid();
      return option;
    }
    case "multi_select": {
      if (!Array.isArray(value)) throw invalid();
      const picked = new Set<string>();
      for (const item of value) {
        const option = typeof item === "string" ? property.options.find((name) => name.toLowerCase() === item.trim().toLowerCase()) : undefined;
        if (!option) throw invalid();
        picked.add(option);
      }
      // Kept in the property's option order so two equal picks always compare equal.
      const ordered = property.options.filter((name) => picked.has(name));
      return ordered.length ? ordered : null;
    }
  }
}

/** A value in plain words, for the table and the record. */
export function memberPropertyText(property: Pick<MemberPropertyDefinition, "type">, value: MemberPropertyValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (property.type === "checkbox") return value ? "Yes" : "";
  if (property.type === "number" && typeof value === "number") return value.toLocaleString("en-US");
  if (property.type === "date" && typeof value === "string") {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  if (property.type === "url" && typeof value === "string") return value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  return String(value);
}

/** For the spreadsheet export: one cell per property. */
export function memberPropertyCell(property: Pick<MemberPropertyDefinition, "type">, value: MemberPropertyValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (property.type === "checkbox") return value ? "Yes" : "No";
  return String(value);
}
