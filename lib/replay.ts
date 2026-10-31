import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function fixturesDir(): string {
  return path.join(process.cwd(), "fixtures");
}

function fixturePath(key: string): string {
  const trimmed = key.replace(/\.json$/i, "");
  const parts = trimmed
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return path.join(fixturesDir(), `${parts.join("/")}.json`);
}

function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

// A failed result must never be recorded, or Demo Mode would replay it as a success.
function isUnsuccessful(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }
  const value = result as { flagged?: unknown; ok?: unknown; success?: unknown };
  return value.flagged === true || value.ok === false || value.success === false;
}

export async function withReplay<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const file = fixturePath(key);
  if (isDemoMode()) {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  }

  const result = await fn();
  if (!isUnsuccessful(result)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}