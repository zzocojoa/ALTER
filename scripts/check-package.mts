import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { assertArtifact } from "./artifact-contract.ts";
import type { ArtifactFile } from "./artifact-contract.ts";

type FileDigest = Readonly<{ path: string; sha256: string }>;

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(entries.map(async (entry): Promise<readonly string[]> => {
    const path: string = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError(`산출물의 심볼릭 링크는 허용되지 않습니다: ${path}`);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return lists.flat().sort();
}

async function digestFile(path: string): Promise<FileDigest> {
  return { path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
}

const paths: readonly string[] = await filesUnder("dist");
const files: readonly ArtifactFile[] = await Promise.all(paths.map(async (path): Promise<ArtifactFile> => ({ path: relative("dist", path), text: await readFile(path, "utf8") })));
assertArtifact(files);
const artifacts: readonly FileDigest[] = await Promise.all(paths.map(digestFile));
const deletedPaths: ReadonlySet<string> = new Set(execFileSync("git", ["ls-files", "--deleted", "-z"], { encoding: "utf8" }).split("\0"));
const sourcePaths: readonly string[] = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter((path) => path.length > 0 && !path.startsWith(".taskmaster/") && !deletedPaths.has(path));
const sources: readonly FileDigest[] = await Promise.all(sourcePaths.toSorted().map(digestFile));
const report = {
  status: "passed", runtime: "Cloudflare Workers", deployed: false,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  lockfile: await digestFile("package-lock.json"),
  sourceDigest: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
  sources, artifacts,
};
await mkdir("outputs", { recursive: true });
await writeFile("outputs/build-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ check: "worker-artifact", status: report.status, fileCount: artifacts.length, sourceDigest: report.sourceDigest, report: "outputs/build-verification.json", deployed: false }));
