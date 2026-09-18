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

  it("non si lascia aggirare da escape CSS, stringhe o commenti", () => {
    const css = `
      :root { --t\\65 xt: #fff; --bg: #000; content: "url(https://innocuo.test)"; }
      /* @import url(https://innocuo.test); .cattiva {} */
      .ui\\2d button { color: var(--text); background: url(\\68 ttps\\3a //evil.test/x); }
      b\\6f dy { color: red; }
    `;
    const violations = themeCssViolations(css, POLICY);
    expect(violations.map(({ code }) => code)).toEqual(["remote-url", "selector-token"]);
    expect(violations[0]?.detail).toContain("https://evil.test/x");
    expect(violations[1]?.detail).toContain("body");
  });

  it("un CSS sintatticamente rotto è un rifiuto strutturato", () => {
    const violations = themeCssViolations(":root { --text: red;", POLICY);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("syntax-error");
    expect(() => sanitizeThemeCss(":root { --text: red;", POLICY)).toThrow(ThemeCssError);
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
describe("image-set URL guarding", () => {
  it("rifiuta candidate remote anche con casing, escape e prefisso vendor", () => {
    const css = `:root { --text: #fff; --bg: #000; } .brand {
      background-image: IMAGE-SET("https://evil.test/a.svg" 1x);
      background-image: i\\6d age-set("\\68 ttps\\3a //evil.test/b.svg" 1x);
      background-image: -\\77 ebkit-image-set("https://evil.test/c.svg" 1x);
      background-image: image-set(url("https://evil.test/d.svg") 1x, "theme://acme.paper/d.svg" 2x);
    }`;
    const violations = themeCssViolations(css, POLICY);
    expect(violations.filter(({ code }) => code === "remote-url")).toHaveLength(4);
    expect(violations.filter(({ code }) => code === "remote-url").map(({ detail }) => detail)).toEqual([
      "URL remoto https://evil.test/a.svg vietato",
      "URL remoto https://evil.test/b.svg vietato",
      "URL remoto https://evil.test/c.svg vietato",
      "URL remoto https://evil.test/d.svg vietato",
    ]);
  });

  it("controlla candidate stringa locali nello stesso namespace degli url()", () => {
    const valid = `:root { --text: #fff; --bg: #000; } .brand {
      background-image: image-set("theme://acme.paper/one.svg" 1x);
    }`;
    expect(themeCssViolations(valid, POLICY)).toEqual([]);
    const invalid = `:root { --text: #fff; --bg: #000; } .brand {
      background-image: image-set("icons/local.svg" 1x);
    }`;
    expect(themeCssViolations(invalid, POLICY).map(({ code }) => code)).toEqual(["asset-namespace"]);
  });

  it("rifiuta candidate non classificabili senza interpretare le stringhe content", () => {
    const unsafe = `:root { --text: #fff; --bg: #000; } .brand {
      background-image: image-set("theme://acme.paper/safe.svg" 1x, linear-gradient(red, blue) 2x);
    }`;
    expect(themeCssViolations(unsafe, POLICY).map(({ code }) => code)).toEqual(["disallowed-value"]);
    const content = `:root { --text: #fff; --bg: #000; } .brand {
      content: "image-set(https://evil.test/not-a-resource 1x)";
    }`;
    expect(themeCssViolations(content, POLICY)).toEqual([]);
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
