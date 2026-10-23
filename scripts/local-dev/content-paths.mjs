// Where the local course content lives. It is read at seed/serve time and
// never committed (this repo is public). Override with POLYNET_CONTENT_ROOT.
import { join } from "node:path";

export const CONTENT_ROOT =
  process.env.POLYNET_CONTENT_ROOT ||
  "C:\\Users\\rkham\\OneDrive\\Desktop\\Rashid Business\\product\\polynet-site";

export const COMMUNITY_CONTENT = {
  "ai-employee-builders": join(CONTENT_ROOT, ".dev", "content"),
  "the-2-hour-club": join(CONTENT_ROOT, "2hc-content"),
};
