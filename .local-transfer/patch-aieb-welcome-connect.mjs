// Swaps only the "Connect" sentence on the AIEB welcome setup screen for the
// "Continue with Polynet" wording. Touches nothing else on the page, and does
// nothing if the owner already changed that sentence.
// Run from the polynet-local repo root (the convex dev deployment must be up):
//   node .local-transfer/patch-aieb-welcome-connect.mjs [community-slug]
import { execFileSync } from "node:child_process";

const slug = process.argv[2] ?? "ai-employee-builders";
const run = (fn, args) => JSON.parse(execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "run", fn, JSON.stringify(args)], { encoding: "utf8" }).trim());

const OLD = "When the AI Employee Builder sign-in page opens, sign in with the same email you use here on Polynet. That's how it finds your membership. If it asks for a key instead, make one in **Settings → Your access** here, and paste it on that page only, never into the chat.";
const NEW = "When the AI Employee Builder sign-in page opens, choose **Continue with Polynet** and approve. That's how it finds your membership, with nothing to type. No button there? Make a key in **Settings → Your access** here, and paste it on that page only, never into the chat.";

const page = run("communityMemberWorkflows:getBuilderWelcomePageBySlugInternal", { slug });
let swaps = 0;
const layout = (page.layout ?? []).map((block) => {
  if (block.type !== "choice") return block;
  return { ...block, options: block.options.map((option) => {
    const count = option.markdown.split(OLD).length - 1;
    swaps += count;
    return count ? { ...option, markdown: option.markdown.split(OLD).join(NEW) } : option;
  }) };
});
if (!swaps) {
  console.log("Nothing to change: the old Connect sentence isn't on the page (already updated, or edited by hand).");
  process.exit(0);
}
const result = run("communityMemberWorkflows:saveBuilderWelcomePageInternal", {
  userId: page.owner_id, communityId: page.community_id, expectedRevision: page.revision,
  title: page.title, message: page.message ?? "", mediaUrl: page.media_url ?? "",
  lessonIds: layout.filter((block) => block.type === "lesson").map((block) => block.resourceId), layout,
});
console.log(`Updated ${swaps} Connect step(s) on the ${slug} welcome page (revision ${page.revision} -> ${result.revision}).`);
