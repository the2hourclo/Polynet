// Types for checks.mjs, which Polynet's backend imports too.
export type SiteProblem = { path: string; message: string };
export type SiteCheckResult = { errors: SiteProblem[]; warnings: SiteProblem[] };
export function isCheckedFile(path: string): boolean;
export function isEmbedPage(path: string, embeds?: Set<string>): boolean;
export function checkSite(files: Array<{ path: string; text: string }>, options?: { embeds?: Set<string> }): SiteCheckResult;
export function formatProblems(result: SiteCheckResult): string[];
