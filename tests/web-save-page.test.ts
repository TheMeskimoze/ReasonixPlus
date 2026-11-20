import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PageContent, saveFetchedPage } from "../src/tools/web.js";

const page: PageContent = {
  url: "https://example.com/a",
  title: "Example",
  text: "hello from the page",
  truncated: false,
};

describe("saveFetchedPage containment", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reasonix-saved-page-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a page inside the workspace", () => {
    const saved = saveFetchedPage(page, "notes/page.txt", root);
    expect(saved.path).toBe(join(root, "notes", "page.txt"));
    expect(readFileSync(saved.path, "utf8")).toContain("hello from the page");
  });

  it("refuses an absolute path on another drive or system root", () => {
    const outside =
      process.platform === "win32"
        ? "D:\\reasonix-outside\\page.txt"
        : "/etc/reasonix-outside-page.txt";
    expect(() => saveFetchedPage(page, outside, root)).toThrow(/must stay inside the workspace/);
  });

  it("refuses a parent-directory escape", () => {
    expect(() => saveFetchedPage(page, "../escape.txt", root)).toThrow(
      /must stay inside the workspace/,
    );
  });
});
