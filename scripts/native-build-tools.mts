import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

export async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
export function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(JSON.stringify({ command, args, status: result.status, signal: result.signal }));
}
export async function download(url: string, file: string, sha256: string): Promise<void> {
  if (!await exists(file)) {
    let lastError: unknown;
    for (let attempt: number = 1; attempt <= 3; attempt += 1) {
      try {
        const response: Response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(JSON.stringify({ url, status: response.status, body: (await response.text()).slice(0, 1000) }));
        await writeFile(file, new Uint8Array(await response.arrayBuffer()));
        lastError = undefined; break;
      } catch (error: unknown) { lastError = error; console.warn(JSON.stringify({ event: "native_dependency_download_retry", url, attempt, message: error instanceof Error ? error.message : String(error) })); }
    }
    if (lastError !== undefined) throw lastError;
  }
  const actual: string = createHash("sha256").update(await readFile(file)).digest("hex");
  if (actual !== sha256) throw new Error(JSON.stringify({ event: "native_dependency_hash_mismatch", file, expected: sha256, actual }));
}

