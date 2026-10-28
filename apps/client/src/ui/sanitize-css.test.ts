import { describe, expect, it } from "vitest";

import {
  ThemeCssError,
  missingThemeRoles,
  sanitizeThemeCss,
  sanitizeUserCss,
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
    expect(violations.map(({ code }) => code)).toEqual(["disallowed-property", "remote-url", "selector-token"]);
    expect(violations[0]?.detail).toContain("custom property");
    expect(violations[1]?.detail).toContain("https://evil.test/x");
    expect(violations[2]?.detail).toContain("body");
  });

  it("un CSS sintatticamente rotto è un rifiuto strutturato", () => {
    const violations = themeCssViolations(":root { --text: red;", POLICY);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("syntax-error");
    expect(() => sanitizeThemeCss(":root { --text: red;", POLICY)).toThrow(ThemeCssError);
  });

  it("dice riga e colonna giuste anche in fondo a un foglio lungo, alternando i fogli", () => {
    const rules = Array.from({ length: 3000 }, () => ".brand { color: var(--text); }").join("\n");
    const long = `:root { --text: #fff; --bg: #000; }\n${rules}\n.brand {\n  display: grid;\n}\n`;
    const short = `:root { --text: #fff; --bg: #000; }\n.brand { padding: 1rem; }`;
    const where = (css: string): [string, number, number][] =>
      themeCssViolations(css, POLICY).map(({ code, line, column }) => [code, line, column]);
    for (let round = 0; round < 2; round += 1) {
      expect(where(long)).toEqual([["structural-property", 3003, 3]]);
      expect(where(short)).toEqual([["structural-property", 2, 10]]);
    }
    // In fondo, oltre l'ultimo a capo, c'è una riga vuota.
    expect(themeCssViolations(":root { --text: #fff; }\n", POLICY).map(({ line, column }) => [line, column])).toEqual([[2, 1]]);
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

describe("allowlist CSS", () => {
  it("applica il default-deny anche a funzioni annidate", () => {
    const css = `:root { --text: #fff; --bg: #000; } .brand {
      color: var(--text, color-mix(in srgb, red, blue));
    }`;
    expect(themeCssViolations(css, POLICY).map(({ code }) => code)).toEqual(["disallowed-value"]);
    expect(themeCssViolations(css, POLICY)[0]?.detail).toContain("color-mix");
  });

  it("ammette custom property canoniche ma non alias ottenuti con casing o escape", () => {
    const valid = `:root { --text: rgb(255, 255, 255); --bg: #000; color: var( --text ); }`;
    expect(themeCssViolations(valid, POLICY)).toEqual([]);

    const invalid = `:root { --Text: #fff; --t\\65 xt: #fff; --bg: #000; }`;
    expect(themeCssViolations(invalid, POLICY).map(({ code }) => code)).toEqual([
      "disallowed-property",
      "disallowed-property",
    ]);
  });

  it("normalizza casing e whitespace solo per proprietà CSS, non per token", () => {
    const css = `:root { --text: #fff; --bg: #000; }
      .brand {  CoLoR :  var ( --text ) ; }`;
    expect(sanitizeThemeCss(css, POLICY)).toBe(css);
  });

  it("applica la matrice at-rule distinta tra foglio e pelle", () => {
    const sheet = `:root { --text: #fff; --bg: #000; }
      @media (prefers-reduced-motion: reduce) { .brand { color: var(--text); } }
      @supports (display: grid) { .brand { color: var(--text); } }
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
    expect(themeCssViolations(sheet, POLICY).map(({ code }) => code)).toEqual(["at-rule", "at-rule"]);

    const skin = `@media (prefers-reduced-motion: reduce) { .brand { color: var(--text); } }
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
      @layer theme { .brand { color: var(--text); } }`;
    expect(themeCssViolations(skin, { ...POLICY, kind: "skin", requiredRoles: [] }).map(({ code }) => code)).toEqual([
      "at-rule",
    ]);
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

describe("user CSS trust boundary", () => {
  const hooks = ["markdown-preview", "fub-note--wide"];

  it("allows local note paint while refusing network and structural escapes", () => {
    const safe = ".markdown-preview .fub-note--wide { color: #eee; }";
    expect(sanitizeUserCss(safe, hooks)).toBe(safe);
    expect(() => sanitizeUserCss(".markdown-preview { background: url(https://example.test/secret); }", hooks)).toThrow(ThemeCssError);
    expect(() => sanitizeUserCss("@import 'https://example.test/secret';", hooks)).toThrow(ThemeCssError);
    expect(() => sanitizeUserCss(".markdown-preview { display: none; }", hooks)).toThrow(ThemeCssError);
    expect(() => sanitizeUserCss(".markdown-preview[data-private] { color: red; }", hooks)).toThrow(ThemeCssError);
  });
});

describe("il gate del contenuto", () => {
  // Il documento offre `file` e `adattato`: lì il contenuto lo disegna il
  // file, e una pelle lo veste soltanto in Scrittura, sotto `.look-tema`.
  const gate = { hooks: ["rich-para", "rich-heading"], scopes: ["rich-page"] };
  const hooks = ["look-tema", "look-file", "rich-page", "rich-para", "rich-heading", "rich-atom", "pane-editor"];
  const skin: ThemeCssPolicy = { assetNamespace: "", allowedHooks: hooks, kind: "skin", gate };
  const codes = (css: string, policy: ThemeCssPolicy = skin) =>
    themeCssViolations(css, policy).filter(({ code }) => code === "content-look");

  it("ammette il contenuto sotto .look-tema, e i segni e la cornice dovunque", () => {
    for (const css of [
      ".look-tema .rich-para { color: var(--doc-fg); }",
      ".look-tema .rich-heading[data-level=\"1\"] { font-size: 2em; }",
      ".look-tema .rich-para strong { color: red !important; }",
      ".look-tema > .rich-page .rich-para + .rich-para { margin-top: 0; }",
      ".rich-page { background: var(--bg); }",
      ".rich-page .rich-atom { color: var(--doc-fg); }",
      ".look-tema .rich-page mark { background: yellow; }",
      ".pane-editor * { animation: none !important; }",
      "@keyframes rich-para { from { opacity: 0; } }",
    ]) {
      expect(codes(css), css).toEqual([]);
    }
  });

  it("rifiuta una classe di contenuto fuori da .look-tema, nominandola e suggerendo .look-tema", () => {
    const found = codes(".rich-para { font-family: serif; }");
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toContain(".rich-para");
    expect(found[0]!.detail).toContain(".look-tema .rich-para");
    expect(found[0]!.line).toBe(1);
    expect(found[0]!.column).toBe(1);
    for (const css of [
      ".rich-para { color: red !important; }",
      ".look-file .rich-para { color: red; }",
      ".pane-editor .rich-heading { color: red; }",
      ".look-tema.rich-para { color: red; }",
      ":not(.look-tema) .rich-para { color: red; }",
      ".rich-atom:not(.rich-para) { color: red; }",
      ".rich-page, .rich-para { color: red; }",
      "@media (min-width: 1px) { .rich-heading { color: red; } }",
      ".rich-\\70 ara { color: red; }",
    ]) {
      expect(codes(css), css).toHaveLength(1);
    }
  });

  it("dentro la pagina del documento anche un selettore di tipo è contenuto", () => {
    for (const css of [".rich-page p { color: red; }", ".rich-page mark { background: red; }", ".rich-page * { font-family: serif !important; }"]) {
      const found = codes(css);
      expect(found, css).toHaveLength(1);
      expect(found[0]!.detail).toContain(".rich-page");
    }
  });

  it("vale per i fogli e per i frammenti come per le pelli", () => {
    expect(codes(".rich-para { color: red; }", { assetNamespace: "", allowedHooks: hooks, gate })).toHaveLength(1);
    expect(() => sanitizeUserCss(".rich-para { color: red; }", hooks, gate)).toThrow(ThemeCssError);
    const fine = ".look-tema .rich-para { color: red; }";
    expect(sanitizeUserCss(fine, hooks, gate)).toBe(fine);
  });

  it("senza gate non cambia niente", () => {
    expect(codes(".rich-para { color: red; }", { ...skin, gate: undefined })).toEqual([]);
  });

  // Il foglio di calcolo offre soltanto `file` e `adattato`: le celle non le
  // veste nessuna pelle, e i segni si appoggiano alla riga, che è cornice.
  it("nel foglio di calcolo le celle sono contenuto, e i segni passano dalla riga", () => {
    const grid = { hooks: ["grid-cell", "no-gridlines"], scopes: ["grid-viewport"] };
    const gridHooks = ["look-tema", "grid-viewport", "grid-row", "grid-cell", "grid-header", "no-gridlines", "selected", "active"];
    const sheet: ThemeCssPolicy = { assetNamespace: "", allowedHooks: gridHooks, kind: "skin", gate: grid };
    for (const css of [
      ".grid-row .selected { box-shadow: inset 0 0 0 999px var(--accent-veil); }",
      ".grid-row .active { box-shadow: inset 0 0 0 2px var(--accent); }",
      ".grid-header.selected { color: var(--accent); }",
      ".grid-viewport:focus-visible { box-shadow: none; }",
    ]) {
      expect(codes(css, sheet), css).toEqual([]);
    }
    for (const css of [
      ".grid-cell { color: var(--doc-fg); }",
      ".grid-cell.selected { box-shadow: none; }",
      ".grid-viewport.no-gridlines .grid-header { border-color: transparent; }",
      ".grid-cell { background: red !important; }",
      ".grid-viewport span { color: red; }",
    ]) {
      expect(codes(css, sheet), css).toHaveLength(1);
    }
  });
});
