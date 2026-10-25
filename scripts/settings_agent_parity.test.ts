// Rashid (2026-10-25): everything an owner can change in Settings, the owner's
// agent can change too. This holds the web app to that: every public mutation
// or action the app calls is an agent operation in convex/polynetBuilderSettings.ts,
// or is listed there with the reason it isn't one. A new Settings save with no
// agent path fails here until it gets one.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "vitest";
import { BUILDER_SETTING_OPERATIONS, SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH } from "../convex/polynetBuilderSettings";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "contracts" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// "module:function" for every Convex function the app names, by api.* or by string.
function appFunctionReferences() {
  const found = new Map<string, string>();
  for (const file of [...sourceFiles("shared"), ...sourceFiles("apps/web/src")]) {
    const text = read(file);
    for (const match of text.matchAll(/\bapi(?: as any\))?\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) found.set(`${match[1]}:${match[2]}`, file);
    for (const match of text.matchAll(/"([A-Za-z][A-Za-z0-9_]*):([A-Za-z][A-Za-z0-9_]*)"/g)) found.set(`${match[1]}:${match[2]}`, file);
  }
  return found;
}

const moduleText = new Map<string, string | null>();
function convexModule(name: string) {
  if (!moduleText.has(name)) {
    try { moduleText.set(name, read(`convex/${name}.ts`)); } catch { moduleText.set(name, null); }
  }
  return moduleText.get(name)!;
}
const isPublicWrite = (reference: string) => {
  const [module, name] = reference.split(":");
  return new RegExp(`export const ${name} = (mutation|action)\\(`).test(convexModule(module) ?? "");
};

const operationCalls = new Set(BUILDER_SETTING_OPERATIONS.map(spec => spec.calls));
const exempt = (reference: string) =>
  SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH[reference] ?? SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH[`${reference.split(":")[0]}:*`];

test("every write the web app makes has an agent operation or a stated reason", () => {
  const writes = [...appFunctionReferences()].filter(([reference]) => isPublicWrite(reference));
  expect(writes.length).toBeGreaterThan(50);
  const missing = writes.filter(([reference]) => !operationCalls.has(reference) && !exempt(reference))
    .map(([reference, file]) => `${reference} (called from ${basename(file)})`);
  expect(missing, "Give these an operation in convex/polynetBuilderSettings.ts, or a reason in SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH").toEqual([]);
});

test("the reasons list has no stale entries and uses the agreed reasons", () => {
  const called = new Set(appFunctionReferences().keys());
  for (const [key, reason] of Object.entries(SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH)) {
    expect(reason, key).toMatch(/^(agent path|pending decision|human only|not a setting): /);
    if (key.endsWith(":*")) continue;
    const reference = key.split("#")[0];
    expect(called.has(reference), `${key} is no longer called by the app`).toBe(true);
    expect(operationCalls.has(reference) && !key.includes("#"), `${key} has an operation already`).toBe(false);
  }
});

test("each operation runs a real public function and sends only fields that function takes", () => {
  const names = new Set<string>();
  for (const spec of BUILDER_SETTING_OPERATIONS) {
    expect(names.has(spec.operation), spec.operation).toBe(false);
    names.add(spec.operation);
    expect(isPublicWrite(spec.calls), `${spec.calls} is not a public mutation or action`).toBe(true);
    const text = convexModule(spec.calls.split(":")[0])!;
    for (const field of Object.keys(spec.fields)) {
      const camel = field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      expect(new RegExp(`\\b${camel}\\s*:`).test(text), `${spec.operation}.${field} -> ${camel} is not an argument in ${spec.calls}`).toBe(true);
    }
    for (const field of spec.required) expect(field in spec.fields, `${spec.operation} requires unknown ${field}`).toBe(true);
    for (const field of ["user_id", "auth_subject", "community_id", "now_ms", "via"])
      expect(field in spec.fields, `${spec.operation} must not take ${field} from input`).toBe(false);
  }
});
