import { describe, expect, it } from "vitest";
import {
  normalizeWorkspacePath,
  toWorkspaceAbsolute,
  toWorkspaceRelative,
  workspaceBasename,
} from "./workspace-path";

describe("workspace paths", () => {
  it("relativizes only paths inside the workspace boundary", () => {
    expect(toWorkspaceRelative("/repo/src/App.tsx", "/repo")).toBe("src/App.tsx");
    expect(toWorkspaceRelative("/repo", "/repo")).toBe(".");
    expect(toWorkspaceRelative("/repo-other/file.ts", "/repo")).toBe("/repo-other/file.ts");
  });

  it("handles Windows paths case-insensitively and preserves absolute outsiders", () => {
    expect(toWorkspaceRelative("C:\\Repo\\src\\App.tsx", "c:\\repo")).toBe("src/App.tsx");
    expect(toWorkspaceRelative("C:\\Repository\\file.ts", "C:\\Repo")).toBe(
      "C:/Repository/file.ts",
    );
  });

  it("resolves relative paths with the workspace platform separator", () => {
    expect(toWorkspaceAbsolute("src/App.tsx", "/repo")).toBe("/repo/src/App.tsx");
    expect(toWorkspaceAbsolute("src/App.tsx", "C:\\repo")).toBe("C:\\repo\\src\\App.tsx");
    expect(toWorkspaceAbsolute("/outside/file.ts", "/repo")).toBe("/outside/file.ts");
  });
});

describe("workspace identity", () => {
  it("keys every spelling of one directory the same", () => {
    const key = normalizeWorkspacePath("C:\\Users\\uraan\\Documents\\ReasonixPlus");
    expect(normalizeWorkspacePath("c:/users/uraan/documents/ReasonixPlus")).toBe(key);
    expect(normalizeWorkspacePath("C:\\Users\\uraan\\Documents\\ReasonixPlus\\")).toBe(key);
  });

  it("keeps a workspace distinct from the local workspace nested inside it", () => {
    const install = normalizeWorkspacePath("C:\\Users\\uraan\\Documents\\ReasonixPlus");
    const local = normalizeWorkspacePath("C:\\Users\\uraan\\Documents\\ReasonixPlus\\local");
    expect(install).not.toBe(local);
  });

  it("preserves case for POSIX workspaces", () => {
    expect(normalizeWorkspacePath("/work/Alpha")).not.toBe(normalizeWorkspacePath("/work/alpha"));
  });

  it("returns an empty key for a missing path", () => {
    expect(normalizeWorkspacePath(undefined)).toBe("");
    expect(normalizeWorkspacePath("")).toBe("");
  });
});

describe("workspaceBasename", () => {
  it("names a workspace by its last segment, preserving case", () => {
    expect(workspaceBasename("C:\\Users\\uraan\\Documents\\ReasonixPlus")).toBe("ReasonixPlus");
    expect(workspaceBasename("C:\\Users\\uraan\\Documents\\ReasonixPlus\\local")).toBe("local");
    expect(workspaceBasename("/srv/projects/Alpha/")).toBe("Alpha");
  });

  it("survives roots and empty input", () => {
    expect(workspaceBasename("C:\\")).toBe("C:");
    expect(workspaceBasename("/")).toBe("/");
    expect(workspaceBasename(undefined)).toBe("");
    expect(workspaceBasename("")).toBe("");
  });
});
