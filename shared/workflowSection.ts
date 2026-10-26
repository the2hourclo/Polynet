export const WORKFLOW_SECTIONS = ["workflows", "runs", "clients", "forms", "welcome"] as const;
export type WorkflowSection = typeof WORKFLOW_SECTIONS[number];
export function workflowSectionFromSearch(search: string): WorkflowSection {
  const value = new URLSearchParams(search).get("section");
  // "test" is the old Test run tab, now part of Run history.
  if (value === "test") return "runs";
  return value === "runs" || value === "clients" || value === "forms" || value === "welcome" ? value : "workflows";
}
export function workflowSectionUrl(href: string, section: WorkflowSection) {
  const url = new URL(href);
  if (section === "workflows") url.searchParams.delete("section");
  else url.searchParams.set("section", section);
  return `${url.pathname}${url.search}${url.hash}`;
}
