// Turns a callout (> [!TYPE] ...) whose lines hold slide images back into a
// "## Slides" section: image lines, each followed by its note. Pure text in,
// text out; prints nothing else. Usage:
//   node callout-to-slides.mjs find  < bodies.json   (array of {id,title,body_md}) -> ids with an image callout
//   node callout-to-slides.mjs fix   < body.md       -> restored body on stdout
import { readFileSync } from "node:fs";

const IMAGE = /^!\[[^\]]*\]\([^)]+\)\s*$/;

function calloutBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^>\s*\[!(TIP|NOTE|IMPORTANT|ACTION|WARNING)\]/i.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && /^>/.test(lines[end])) end += 1;
    const inner = lines.slice(i + 1, end).map((line) => line.replace(/^>\s?/, ""));
    const images = inner.filter((line) => IMAGE.test(line.trim().replace(/^[-*]\s+/, ""))).length;
    if (images > 0) blocks.push({ start: i, end, inner, images });
  }
  return blocks;
}

function fix(body) {
  const lines = body.split("\n");
  const blocks = calloutBlocks(lines);
  if (blocks.length !== 1) throw new Error(`expected exactly one image callout, found ${blocks.length}`);
  const [block] = blocks;
  const marker = lines[block.start].replace(/^>\s*\[![A-Z]+\]\s*/i, "").trim();
  const inner = block.inner.map((line) => {
    const bare = line.trim().replace(/^[-*]\s+/, "");
    return IMAGE.test(bare) ? bare : line;
  });
  // An image line needs a blank line around it so each slide's note stays its own.
  const section = ["## Slides", "", ...(marker ? [marker, ""] : [])];
  for (const line of inner) {
    if (IMAGE.test(line) && section[section.length - 1] !== "") section.push("");
    section.push(line);
    if (IMAGE.test(line)) section.push("");
  }
  while (section[section.length - 1] === "") section.pop();
  const after = lines.slice(block.end);
  // The section ends at the next "## " heading; text that followed the callout
  // without one would read as the last slide's note, so it gets a divider heading only if needed.
  const nextIsHeading = after.find((line) => line.trim()) ?? "";
  const tail = after.length && !/^## /.test(nextIsHeading) && nextIsHeading ? ["", "## Keep going", ""] : [""];
  return [...lines.slice(0, block.start), "", ...section, ...tail, ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

const mode = process.argv[2];
const input = readFileSync(0, "utf8");
if (mode === "find") {
  const rows = JSON.parse(input);
  const hits = rows
    .map((row) => ({ id: row.id, title: row.title, images: calloutBlocks(String(row.body_md ?? "").split("\n")).map((b) => b.images) }))
    .filter((row) => row.images.length);
  process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
} else if (mode === "fix") {
  process.stdout.write(fix(input));
} else {
  throw new Error("mode must be find or fix");
}
