import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneStateDir } from "../src/core/state-dir.js";

describe("pruneStateDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reasonix-state-dir-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, ageMs: number): void {
    const path = join(dir, name);
    writeFileSync(path, "x");
    const stamp = new Date(Date.now() - ageMs);
    utimesSync(path, stamp, stamp);
  }

  it("keeps the newest maxFiles and removes the rest", () => {
    write("f0.txt", 5 * 60_000);
    write("f1.txt", 4 * 60_000);
    write("f2.txt", 3 * 60_000);
    write("f3.txt", 2 * 60_000);
    write("f4.txt", 1 * 60_000);

    pruneStateDir(dir, { match: (name) => name.endsWith(".txt"), maxFiles: 2 });

    expect(readdirSync(dir).sort()).toEqual(["f3.txt", "f4.txt"]);
  });

  it("removes entries older than maxAgeMs", () => {
    write("old.txt", 60 * 60_000);
    write("fresh.txt", 1_000);

    pruneStateDir(dir, { match: (name) => name.endsWith(".txt"), maxAgeMs: 30 * 60_000 });

    expect(readdirSync(dir)).toEqual(["fresh.txt"]);
  });

  it("honours the match filter", () => {
    write("keep.png", 5_000);
    write("drop.txt", 5_000);

    pruneStateDir(dir, { match: (name) => name.endsWith(".txt"), maxFiles: 0 });

    expect(readdirSync(dir)).toEqual(["keep.png"]);
  });

  it("uses the remove hook so sibling artifacts go together", () => {
    write("abc.json", 5_000);
    write("abc.txt", 5_000);

    pruneStateDir(dir, {
      match: (name) => name.endsWith(".json"),
      maxFiles: 0,
      remove: (path) => {
        for (const target of [path, path.replace(/\.json$/, ".txt")])
          rmSync(target, { force: true });
      },
    });

    expect(readdirSync(dir)).toEqual([]);
  });

  it("is a no-op on a missing directory", () => {
    expect(pruneStateDir(join(dir, "nope"), { match: () => true })).toEqual({
      removed: 0,
      failed: 0,
    });
  });
});
