import { describe, expect, it } from "vitest";

import {
  ThemeCssError,
  missingThemeRoles,
  sanitizeThemeCss,
  themeCssViolations,
  unknownThemeHooks,
  type ThemeCssPolicy,
} from "./sanitize-css";

const POLICY: ThemeCssPolicy = {
  assetNamespace: "theme://acme.paper/",
  allowedHooks: ["ui-button", "brand"],
  requiredRoles: ["text", "bg"],
};

describe("sanitizeThemeCss", () => {
  it("restituisce intatto un foglio completo nel suo namespace", () => {
    const css = `
      :root { --text: #fff; --bg: #000; }
      .ui-button:hover, .brand {
        color: var(--text);
        background-image: url("theme://acme.paper/noise.svg");
        transform: translateY(-1px);
      }
    `;

    expect(sanitizeThemeCss(css, POLICY)).toBe(css);
  });

  it("nomina insieme tutte le violazioni in ordine deterministico", () => {
    const css = `
      @import url("https://example.test/spia.css");
      @namespace svg url("theme://altro/svg");
      :root { --text: #fff; }
      .ui-button.estraneo#shell body {
        display: grid;
        padding: 1rem;
        background: url("../fuori.svg");
      }
    `;

    const first = themeCssViolations(css, POLICY);
    const second = themeCssViolations(css, POLICY);
    expect(second).toEqual(first);
    expect(first.map(({ code }) => code)).toEqual([
      "at-import",
      "remote-url",
      "at-namespace",
      "asset-namespace",
      "selector-hook",
      "selector-id",
      "selector-token",
      "structural-property",
      "structural-property",
      "asset-namespace",
      "missing-role",
    ]);

    expect(() => sanitizeThemeCss(css, POLICY)).toThrow(ThemeCssError);
    try {
      sanitizeThemeCss(css, POLICY);
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeCssError);
      expect((error as Error).message).toContain("https://example.test/spia.css");
      expect((error as Error).message).toContain("hook .estraneo non dichiarato");
      expect((error as Error).message).toContain("selettore #shell fuori dal vocabolario");
      expect((error as Error).message).toContain("selettore body fuori dal vocabolario");
      expect((error as Error).message).toContain("proprietà display vietata");
      expect((error as Error).message).toContain("asset ../fuori.svg fuori da theme://acme.paper/");
      expect((error as Error).message).toContain("ruolo --bg mancante");
    }
  });
});

describe("presidi puri del contratto", () => {
  it("elenca ogni ruolo mancante nell'ordine del contratto, una volta sola", () => {
    expect(missingThemeRoles(":root { --text: #fff; }", ["bg", "text", "accent", "bg"]))
      .toEqual(["bg", "accent"]);
  });

  it("elenca solo gli hook fuori vocabolario, una volta sola", () => {
    expect(unknownThemeHooks(".brand.bad, .bad:hover, .worse {}", ["brand"]))
      .toEqual(["bad", "worse"]);
  });
});
