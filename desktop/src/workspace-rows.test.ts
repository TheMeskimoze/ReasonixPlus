import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath } from "./workspace-path";
import { workspacePickerRows } from "./workspace-rows";

const INSTALL = "C:\\Users\\uraan\\Documents\\ReasonixPlus";
const LOCAL = `${INSTALL}\\local`;

describe("workspacePickerRows", () => {
  it("offers the install dir and Reasonix+ Local as separate workspaces", () => {
    const rows = workspacePickerRows({ local: LOCAL, recent: [INSTALL], current: INSTALL });

    expect(rows.map((row) => row.path)).toEqual([LOCAL, INSTALL]);
    expect(rows.map((row) => row.local)).toEqual([true, false]);
    expect(rows.map((row) => row.name)).toEqual(["local", "ReasonixPlus"]);
    expect(rows.map((row) => row.isCurrent)).toEqual([false, true]);
    expect(rows.map((row) => row.canRemove)).toEqual([false, true]);
  });

  it("collapses every spelling of one workspace into one row", () => {
    const rows = workspacePickerRows({
      local: LOCAL,
      recent: [INSTALL, "c:/users/uraan/documents/reasonixplus/", LOCAL],
    });

    expect(rows.map((row) => row.key)).toEqual([
      normalizeWorkspacePath(LOCAL),
      normalizeWorkspacePath(INSTALL),
    ]);
  });

  it("offers the current workspace when nothing was used before", () => {
    const rows = workspacePickerRows({ recent: [], current: "/proj/a" });
    expect(rows.map((row) => row.path)).toEqual(["/proj/a"]);
    expect(rows[0]!.isCurrent).toBe(true);
  });

  it("offers only the pinned local workspace to a workspace-less tab", () => {
    const rows = workspacePickerRows({ local: LOCAL });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: LOCAL, local: true, isCurrent: false, canRemove: false });
  });

  it("drops blank paths", () => {
    expect(workspacePickerRows({ recent: ["", "   "] })).toEqual([]);
  });
});
