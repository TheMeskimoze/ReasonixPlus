import { describe, expect, it } from "vitest";
import { workspacePathKey } from "../src/workspace-key.js";

describe("workspacePathKey", () => {
  it("keeps one directory's spellings on one key", () => {
    const key = workspacePathKey("/work/alpha");
    expect(workspacePathKey("/work/alpha/")).toBe(key);
    expect(workspacePathKey("/work/alpha///")).toBe(key);
    expect(workspacePathKey("\\work\\alpha")).toBe(key);
  });

  it("folds letter case for drive-letter and UNC roots", () => {
    expect(workspacePathKey("C:\\Users\\Foo\\proj")).toBe("c:/users/foo/proj");
    expect(workspacePathKey("c:/users/foo/proj/")).toBe("c:/users/foo/proj");
    expect(workspacePathKey("\\\\Server\\Share\\Proj")).toBe("//server/share/proj");
  });

  it("preserves case for POSIX paths, which are case-sensitive", () => {
    expect(workspacePathKey("/work/Alpha")).not.toBe(workspacePathKey("/work/alpha"));
    expect(workspacePathKey("/work/Alpha")).toBe("/work/Alpha");
  });

  it("keeps a workspace separate from every directory nested under it", () => {
    const install = workspacePathKey("C:\\Users\\uraan\\Documents\\ReasonixPlus");
    const local = workspacePathKey("C:\\Users\\uraan\\Documents\\ReasonixPlus\\local");

    expect(install).toBe("c:/users/uraan/documents/reasonixplus");
    expect(local).toBe("c:/users/uraan/documents/reasonixplus/local");
    expect(install).not.toBe(local);
  });

  it("treats a drive root as itself, not as an empty path", () => {
    expect(workspacePathKey("C:\\")).toBe(workspacePathKey("C:"));
    expect(workspacePathKey("C:\\")).not.toBe("");
    expect(workspacePathKey("/")).toBe("/");
  });

  it("returns an empty key for a missing or empty path", () => {
    expect(workspacePathKey(undefined)).toBe("");
    expect(workspacePathKey("")).toBe("");
  });
});
