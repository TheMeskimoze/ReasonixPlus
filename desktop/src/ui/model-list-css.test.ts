import { describe, expect, it } from "vitest";
import { cssRules } from "../../../tests/support/css.js";

describe("model list CSS", () => {
  it("lets the browser skip off-screen model rows", () => {
    // A live catalog can list hundreds of ids while the box shows a handful, so the
    // rows past the fold must cost nothing to lay out. `auto` in both properties lets
    // the browser remember a rendered row's real size instead of trusting the guess.
    const bodies = cssRules(".provider-models-scroll > .mcard").join("\n");
    expect(bodies).toContain("content-visibility: auto");
    expect(bodies).toMatch(/contain-intrinsic-size:\s*auto\s+\d/);
  });

  it("keeps one row recipe across the composer's model, effort and gate menus", () => {
    // The three menus ask one kind of question (pick one of these) and must read as one
    // control family: no menu may restyle the shared row or its text.
    for (const list of [".model-menu-list", ".effort-menu-list"]) {
      for (const part of [" .popup-item", " .popup-item .cmd", " .desc"]) {
        expect(cssRules(`${list}${part}`).join("\n"), `${list}${part}`).not.toMatch(
          /font-size|padding|gap|display|white-space|text-overflow/,
        );
      }
    }
  });

  it("names every menu's first row at the header metrics", () => {
    // The model menu's target switch takes the header's own text size, padding and
    // colour, so all four composer menus open with the same title band.
    const header = cssRules(".popup .ph").join("\n");
    const tabs = cssRules(".model-menu-tabs").join("\n");
    const tab = cssRules(".model-menu-tab").join("\n");
    expect(tab).toContain("font-size: 14px");
    expect(tab).toContain("padding: 8px 0");
    expect(tabs).toContain("padding: 0 12px");
    expect(header).toContain("padding: 8px 12px");
    expect(header).toContain("color: var(--muted)");
    expect(tab).toContain("color: var(--muted)");
    // A title band, not a tab bar: the open target brightens nothing and draws no
    // accent under its text, and the one line under the band is the header's own.
    expect(cssRules('.model-menu-tab[data-on="true"]')).toEqual([]);
    expect(tab).not.toContain("border-bottom");
    expect(cssRules(".model-menu-tab:hover").join("\n")).not.toContain("border-radius");
  });

  it("lets a menu list scroll inside its card instead of past it", () => {
    // The popup caps its own height; the list is its only growing child, so it needs a
    // shrinkable min-height and no second, per-list cap.
    expect(cssRules(".popup-list").join("\n")).toContain("min-height: 0");
    expect(cssRules(".model-menu-list").join("\n")).not.toContain("max-height");
  });
});
