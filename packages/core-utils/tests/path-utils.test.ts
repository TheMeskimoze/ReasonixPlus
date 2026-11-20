import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pathIsStrictlyUnder,
  pathIsUnder,
  relativeDisplayPath,
  resolveToolPath,
  toPosixPath,
} from "../src/path-utils.js";

describe("containment helpers", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reasonix-pathutils-"));
    outside = mkdtempSync(join(tmpdir(), "reasonix-pathutils-out-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("pathIsUnder accepts the root and anything below it", () => {
    expect(pathIsUnder(root, root)).toBe(true);
    expect(pathIsUnder(join(root, "a", "b.ts"), root)).toBe(true);
  });

  it("pathIsUnder rejects a sibling and a `..` escape", () => {
    expect(pathIsUnder(outside, root)).toBe(false);
    expect(pathIsUnder(join(root, "..", "escape.ts"), root)).toBe(false);
  });

  it("pathIsUnder keeps a sibling whose name starts with two dots", () => {
    expect(pathIsUnder(join(root, "..cache", "f.ts"), root)).toBe(true);
  });

  it("pathIsUnder rejects a path on another drive, where relative() is absolute", () => {
    if (process.platform !== "win32") return;
    expect(pathIsUnder("D:\\elsewhere\\f.ts", root)).toBe(false);
  });

  it("pathIsStrictlyUnder excludes the parent itself", () => {
    expect(pathIsStrictlyUnder(root, root)).toBe(false);
    expect(pathIsStrictlyUnder(join(root, "a"), root)).toBe(true);
  });
});

describe("resolveToolPath", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reasonix-resolve-"));
    outside = mkdtempSync(join(tmpdir(), "reasonix-resolve-out-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("treats a leading separator as workspace-relative", () => {
    expect(resolveToolPath(root, "/src/a.ts")).toEqual({
      abs: join(root, "src", "a.ts"),
      inside: true,
    });
    expect(resolveToolPath(root, "\\src\\a.ts").abs).toBe(join(root, "src", "a.ts"));
  });

  it("resolves a plain relative path under the root", () => {
    expect(resolveToolPath(root, "src/a.ts")).toEqual({
      abs: join(root, "src", "a.ts"),
      inside: true,
    });
  });

  it("reports a relative escape", () => {
    expect(resolveToolPath(root, "../outside.ts").inside).toBe(false);
  });

  it("keeps a system absolute path absolute and reports whether it is inside", () => {
    const inside = join(root, "a.ts");
    expect(resolveToolPath(root, inside)).toEqual({ abs: inside, inside: true });
    const away = join(outside, "a.ts");
    expect(resolveToolPath(root, away)).toEqual({ abs: away, inside: false });
  });

  it("resolves the empty path to the root", () => {
    expect(resolveToolPath(root, "")).toEqual({ abs: root, inside: true });
  });
});

describe("relativeDisplayPath", () => {
  it("renders inside paths with forward slashes", () => {
    const root = mkdtempSync(join(tmpdir(), "reasonix-display-"));
    try {
      expect(relativeDisplayPath(root, join(root, "sub", "a.ts"))).toBe("sub/a.ts");
      expect(relativeDisplayPath(root, root)).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an outside path absolute instead of a `..` chain", () => {
    const root = mkdtempSync(join(tmpdir(), "reasonix-display-"));
    const outside = mkdtempSync(join(tmpdir(), "reasonix-display-out-"));
    try {
      const full = join(outside, "a.ts");
      expect(relativeDisplayPath(root, full)).toBe(toPosixPath(full));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
