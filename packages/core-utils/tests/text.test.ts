import { describe, expect, it } from "vitest";
import { capWithMarker, sanitizeTerminalText, stripAnsi } from "../src/text.js";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("stripAnsi", () => {
  it("removes SGR color sequences", () => {
    expect(stripAnsi(`${ESC}[32m·${ESC}[39m${ESC}[33m·${ESC}[39m`)).toBe("··");
  });

  it("removes OSC sequences terminated by BEL or ST", () => {
    expect(stripAnsi(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`)).toBe("link");
    expect(stripAnsi(`${ESC}]0;window title${ESC}\\rest`)).toBe("rest");
  });

  it("removes bare Fe escapes and leaves plain text untouched", () => {
    expect(stripAnsi(`${ESC}cplain`)).toBe("plain");
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});

describe("sanitizeTerminalText", () => {
  it("strips colors and collapses a CR progress line to its surviving frame", () => {
    expect(sanitizeTerminalText(`${ESC}[32m10%${ESC}[0m\r20%\r${ESC}[33m30%`)).toBe("30%");
  });

  it("drops non-printing control bytes but keeps tabs and newlines", () => {
    const raw = `a${String.fromCharCode(7)}b\tc\nd${String.fromCharCode(8)}e`;
    expect(sanitizeTerminalText(raw)).toBe("ab\tc\nde");
  });

  it("drops a trailing lone ESC", () => {
    expect(sanitizeTerminalText(`a${ESC}`)).toBe("a");
  });

  it("is a no-op for ordinary captured text", () => {
    expect(sanitizeTerminalText("Tests 4 passed (4)\n  Duration 1.2s")).toBe(
      "Tests 4 passed (4)\n  Duration 1.2s",
    );
  });
});

describe("capWithMarker", () => {
  it("returns the text untouched under the cap", () => {
    expect(capWithMarker("hello", 10)).toEqual({
      text: "hello",
      truncated: false,
      droppedChars: 0,
    });
  });

  it("keeps the head and reports the dropped chars", () => {
    const capped = capWithMarker("x".repeat(100), 10);
    expect(capped.truncated).toBe(true);
    expect(capped.droppedChars).toBe(90);
    expect(capped.text.startsWith("x".repeat(10))).toBe(true);
    expect(capped.text).toContain("[… 90 chars omitted …]");
  });

  it("keeps the tail when asked", () => {
    const capped = capWithMarker(`head${"x".repeat(100)}tail`, 4, { keep: "tail" });
    expect(capped.text.endsWith("tail")).toBe(true);
    expect(capped.text.startsWith("[… ")).toBe(true);
    expect(capped.text).toContain("chars omitted");
  });

  it("keeps both ends in head-tail mode and puts the hint in the marker", () => {
    const capped = capWithMarker(`start${"x".repeat(200)}END`, 40, {
      keep: "head-tail",
      hint: "narrow the scope",
    });
    expect(capped.text.startsWith("start")).toBe(true);
    expect(capped.text.endsWith("END")).toBe(true);
    expect(capped.text).toContain("chars omitted: narrow the scope");
    expect(capped.droppedChars).toBeGreaterThan(0);
  });

  it("keeps a surrogate pair whole at the cut", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const capped = capWithMarker(`a${emoji.repeat(10)}`, 2);
    expect(capped.text.split("\n\n")[0]).toBe("a");
  });
});
