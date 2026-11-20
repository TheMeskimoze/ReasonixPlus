import { describe, expect, it } from "vitest";
import { dropFlags, flagValue } from "../src/mcp/argv-flags.js";

describe("flagValue", () => {
  it("reads both spellings", () => {
    expect(flagValue(["--browser", "firefox"], "browser")).toBe("firefox");
    expect(flagValue(["--browser=firefox"], "browser")).toBe("firefox");
  });

  it("takes the first occurrence and skips unrelated flags", () => {
    expect(flagValue(["-y", "--browser", "chrome", "--browser=firefox"], "browser")).toBe("chrome");
  });

  it("returns undefined for a missing flag or a flag with no value", () => {
    expect(flagValue(["--other"], "browser")).toBeUndefined();
    expect(flagValue(["--browser"], "browser")).toBeUndefined();
    expect(flagValue([], "browser")).toBeUndefined();
  });

  it("does not treat a prefix as the flag", () => {
    expect(flagValue(["--browser-name=x"], "browser")).toBeUndefined();
  });
});

describe("dropFlags", () => {
  it("removes value flags in both spellings and keeps the rest in order", () => {
    expect(
      dropFlags(["-y", "--browser", "chrome", "--cdp-endpoint=ws://x", "tail"], {
        values: ["browser", "cdp-endpoint"],
      }),
    ).toEqual(["-y", "tail"]);
  });

  it("removes bare flags only by exact match", () => {
    expect(dropFlags(["--extension", "--extension=x", "keep"], { bare: ["--extension"] })).toEqual([
      "--extension=x",
      "keep",
    ]);
  });

  it("removes every occurrence, not just the first", () => {
    expect(
      dropFlags(["--output-dir=a", "x", "--output-dir", "b"], { values: ["output-dir"] }),
    ).toEqual(["x"]);
  });

  it("leaves arguments untouched when nothing is named", () => {
    expect(dropFlags(["--a", "1"], {})).toEqual(["--a", "1"]);
  });
});
