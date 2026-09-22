/**
 * Helpers for the course notebooks running on Deno's Jupyter kernel.
 *
 * The Deno kernel has no IPython magics, so this module supplies the four things the Python
 * notebooks relied on:
 *
 * | Python (IPython)        | Here                                  |
 * | ----------------------- | ------------------------------------- |
 * | `%store name` / `-r`    | `state.set(...)` / `state.get(...)`   |
 * | `!command`, `subprocess`| `await sh("cmd", ["arg"])`            |
 * | `load_dotenv()`         | `await loadEnv()`                     |
 * | `%%writefile path`      | `await writeFile(path, source)`       |
 *
 * `sh()` prints what it captured, because the Deno kernel does not forward a child process's
 * output to the notebook (denoland/deno#20555).
 */
import { load } from "@std/dotenv";
import { dirname, fromFileUrl, isAbsolute, join, resolve } from "@std/path";

/** Repository root, derived from this file's location. */
export function repoRoot(): string {
  return resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
}

/** Where `state` keeps its values; one JSON file, replacing IPython's `%store` database. */
export const STATE_FILE = join(repoRoot(), "capstone_project", "notebooks", ".notebook-state.json");

export type StateValue = string | number | boolean | null | StateValue[] | {
  [key: string]: StateValue;
};

async function readState(): Promise<Record<string, StateValue>> {
  try {
    return JSON.parse(await Deno.readTextFile(STATE_FILE)) as Record<string, StateValue>;
  } catch {
    return {};
  }
}

/**
 * Values that outlive a kernel restart and cross notebooks, replacing `%store`.
 *
 * ```ts
 * await state.set("memory_id", memoryId);          // %store memory_id
 * const memoryId = await state.get<string>("memory_id");  // %store -r memory_id
 * ```
 */
export const state = {
  async set(key: string, value: StateValue): Promise<void> {
    const all = await readState();
    all[key] = value;
    await Deno.writeTextFile(STATE_FILE, `${JSON.stringify(all, null, 2)}\n`);
  },

  async get<T extends StateValue = StateValue>(key: string): Promise<T | undefined> {
    return (await readState())[key] as T | undefined;
  },

  /** Like `get`, but fails with the notebook that should have set the value. */
  async require<T extends StateValue = StateValue>(key: string, setBy?: string): Promise<T> {
    const value = await state.get<T>(key);
    if (value === undefined || value === null) {
      throw new Error(
        `Missing "${key}" in the notebook state${setBy ? `; run ${setBy} first` : ""}.`,
      );
    }
    return value;
  },

  async all(): Promise<Record<string, StateValue>> {
    return await readState();
  },

  async delete(key: string): Promise<void> {
    const all = await readState();
    delete all[key];
    await Deno.writeTextFile(STATE_FILE, `${JSON.stringify(all, null, 2)}\n`);
  },
};

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command and prints its output, replacing `!command` cells and `subprocess.run`.
 *
 * The kernel does not show a child process's own output, so this prints what it captured.
 * Set `quiet` to keep the output and print nothing.
 */
export async function sh(
  command: string,
  args: string[] = [],
  options: { cwd?: string; quiet?: boolean; check?: boolean } = {},
): Promise<ShellResult> {
  const { cwd, quiet = false, check = false } = options;
  const output = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  const result: ShellResult = {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout).trimEnd(),
    stderr: new TextDecoder().decode(output.stderr).trimEnd(),
  };
  if (!quiet) {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log(result.stderr);
  }
  if (check && result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.code}`);
  }
  return result;
}

/**
 * Loads `.env` into the process environment, replacing `load_dotenv()`.
 *
 * Defaults to the repository root's `.env`. Returns the variables it read.
 */
export async function loadEnv(
  envPath: string = join(repoRoot(), ".env"),
): Promise<Record<string, string>> {
  try {
    return await load({ envPath, export: true });
  } catch {
    return {};
  }
}

/**
 * Writes a file, replacing `%%writefile`. Relative paths resolve against the notebooks directory,
 * so the Python paths (`../backend/runtime/simple_agent/travel_agent.py`) translate unchanged.
 */
export async function writeFile(path: string, contents: string): Promise<string> {
  const target = isAbsolute(path) ? path : join(repoRoot(), "capstone_project", "notebooks", path);
  await Deno.mkdir(dirname(target), { recursive: true });
  await Deno.writeTextFile(target, contents);
  console.log(`Wrote ${target}`);
  return target;
}

/** Formats an API key for display: `********abcd`, or a "not configured" marker. */
export function maskKey(value: string | undefined): string {
  return value ? `${"*".repeat(8)}${value.slice(-4)}` : "Not configured";
}
