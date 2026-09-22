// Every deployable agent folder keeps its own deno.json, the way it kept its own requirements.txt.
// This checks those copies still agree with the root deno.json, so an agent image can't be built
// against a different version of a dependency than the notebooks use.
import { dirname, fromFileUrl, join } from "@std/path";

const root = dirname(dirname(fromFileUrl(import.meta.url)));

async function importsOf(path: string): Promise<Record<string, string>> {
  const text = await Deno.readTextFile(path);
  return (JSON.parse(text).imports ?? {}) as Record<string, string>;
}

async function agentConfigs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) found.push(...(await agentConfigs(path)));
    else if (entry.name === "deno.json") found.push(path);
  }
  return found;
}

const rootImports = await importsOf(join(root, "deno.json"));
const backend = join(root, "capstone_project", "backend");
const problems: string[] = [];

for (const config of await agentConfigs(backend)) {
  for (const [name, spec] of Object.entries(await importsOf(config))) {
    const expected = rootImports[name];
    const where = config.slice(root.length + 1);
    if (expected === undefined) problems.push(`${where}: "${name}" is not in the root deno.json`);
    else if (expected !== spec) {
      problems.push(`${where}: "${name}" is ${spec}, root has ${expected}`);
    }
  }
}

if (problems.length) {
  console.error("Agent dependency pins do not match the root deno.json:");
  for (const p of problems) console.error(`  - ${p}`);
  Deno.exit(1);
}
console.log("All agent deno.json pins match the root deno.json.");
