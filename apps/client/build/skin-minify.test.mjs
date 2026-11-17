// @vitest-environment happy-dom
//
// La pelle minimizzata della build (`skin-minify.mjs`) ha le stesse regole
// della pelle scritta: lo stesso albero di postcss, il parser del
// sanitizzatore, con selettori, proprietà e valori a meno degli spazi che la
// grammatica del CSS ignora.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { validateThemeBundle } from "../src/theme/loader";
import { SCRITTOIO_SERIES } from "../src/theme/scrittoio/series";
import { declareThemeSeries } from "../src/theme/theme";
import { minifySkin } from "./skin-minify.mjs";

const SKIN = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/theme/scrittoio/skin.css"), "utf8");

/** Il testo con ogni serie di spazi fuori dalle stringhe ridotta a uno, e
 * senza gli spazi che non contano accanto a `,`, dopo `(` e prima di `)`; nei
 * selettori anche attorno a `>`, nei valori e nei parametri dopo `:`. */
function normalized(text, where) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (/\s/.test(c)) {
      while (i < text.length && /\s/.test(text[i])) i++;
      out += "\u0000";
    } else {
      out += c;
      i++;
    }
  }
  const around = where === "selector" ? "[,>]" : "[,]";
  return out
    .replace(new RegExp(`\u0000*(${around})\u0000*`, "g"), "$1")
    .replace(/\(\u0000+/g, "(")
    .replace(/\u0000+\)/g, ")")
    .replace(where === "selector" ? /(?!)/ : /:\u0000+/g, ":")
    .replace(/^\u0000+|\u0000+$/g, "")
    .replace(/\u0000+/g, " ");
}

/** L'albero di `css` come elenco: una riga per regola, at-rule e
 * dichiarazione, con la profondità. I commenti non sono regole. */
function rules(css) {
  const list = [];
  postcss.parse(css).walk((node) => {
    let depth = 0;
    for (let up = node.parent; up && up.type !== "root"; up = up.parent) depth++;
    if (node.type === "rule") list.push(`${depth} rule ${normalized(node.selector, "selector")}`);
    else if (node.type === "atrule") list.push(`${depth} @${node.name} ${normalized(node.params, "params")}`);
    else if (node.type === "decl") {
      list.push(`${depth} ${node.prop}: ${normalized(node.value, "value")}${node.important ? " !important" : ""}`);
    }
  });
  return list;
}

describe("la pelle minimizzata della build", () => {
  it("ha le stesse regole della pelle scritta, una per una", () => {
    const written = rules(SKIN);
    const minified = rules(minifySkin(SKIN));
    expect(written.length).toBeGreaterThan(1000);
    expect(minified).toEqual(written);
  });

  it("passa dal cancello del tema come la pelle scritta, in ogni luce", () => {
    const restore = declareThemeSeries(SCRITTOIO_SERIES);
    try {
      for (const light of ["light", "dark"]) {
        const bundle = { manifest: SCRITTOIO_SERIES.manifest, sheet: SCRITTOIO_SERIES.sheet(light, "normal"), assets: {} };
        expect(validateThemeBundle({ ...bundle, skin: minifySkin(SKIN) }, light), light).toEqual([]);
      }
    } finally {
      restore();
    }
  });

  it("non ha più commenti, rientri né righe vuote, e pesa meno", () => {
    const out = minifySkin(SKIN);
    let comments = 0;
    postcss.parse(out).walkComments(() => {
      comments++;
    });
    expect(comments).toBe(0);
    expect(out).not.toMatch(/\n/);
    // Due spazi di fila restano solo dentro le stringhe (`content: "•  "`).
    expect(out.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')).not.toMatch(/ {2}/);
    expect(out.length).toBeLessThan(SKIN.length * 0.7);
  });

  it("lascia intatte le stringhe, anche con `/*`, `;` e spazi doppi dentro", () => {
    const css = `.a::before {\n  content: "/* no */ ;  due  spazi";\n  background: url( "a  b;.png" );\n}\n.b::after { content: '{ } ,  : '; }`;
    expect(minifySkin(css)).toBe(`.a::before{content:"/* no */ ;  due  spazi";background:url("a  b;.png")}.b::after{content:'{ } ,  : '}`);
  });

  it("tiene gli spazi che contano nei valori", () => {
    expect(minifySkin(".a { width: calc(1px + 2px); margin: calc( 100% - var(--x) * 2 ) 0 ! important; }")).toBe(
      ".a{width:calc(1px + 2px);margin:calc(100% - var(--x) * 2) 0 ! important}",
    );
    expect(minifySkin(".a { grid-template-columns: repeat( 2 , minmax(0, 1fr) ); font: 12px / 1.5 a , b; }")).toBe(
      ".a{grid-template-columns:repeat(2,minmax(0,1fr));font:12px / 1.5 a,b}",
    );
  });

  it("tiene i combinatori dei selettori", () => {
    expect(minifySkin(".a  .b ,\n.c > .d + .e ~ .f,\n.g :hover, .h:not( .i ) .j {\n  color: red;\n}")).toBe(
      ".a .b,.c>.d + .e ~ .f,.g :hover,.h:not(.i) .j{color:red}",
    );
  });

  it("tiene lo spazio prima di `(` nelle condizioni e dopo `)`", () => {
    expect(minifySkin("@media screen and (min-width: 600px) and (max-width : 900px) {\n  .a { color: red; }\n}")).toBe(
      "@media screen and (min-width:600px) and (max-width :900px){.a{color:red}}",
    );
  });

  it("tiene lo spazio che chiude un escape e un valore vuoto", () => {
    expect(minifySkin(".\\31  .a, .b\\, .c { --vuoto: ; }")).toBe(".\\31  .a,.b\\, .c{--vuoto: }");
  });

  it("non incolla due token separati soltanto da un commento", () => {
    expect(minifySkin(".a { margin: 1px/* x */2px; }\n.b/* x */.c { color: red; }")).toBe(".a{margin:1px/**/2px}.b.c{color:red}");
  });

  it("copia un `url(` senza virgolette fino alla sua parentesi", () => {
    expect(minifySkin(".a { background: url(theme://x/a;b.png) no-repeat; }")).toBe(
      ".a{background:url(theme://x/a;b.png) no-repeat}",
    );
  });
});
