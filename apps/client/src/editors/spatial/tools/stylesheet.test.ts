import { describe, expect, it } from "vitest";
import { renameUrls, restyle } from "./stylesheet";

const NAMES: Record<string, string> = { a: "o1aaaaaaa", grad: "o2bbbbbbb", root: "o9wwwwwww", "x:y": "o3ccccccc" };
const rename = (id: string): string | null => NAMES[id] ?? null;

describe("restyle", () => {
  it("rinomina gli id dei selettori e degli url, e lascia i colori", () => {
    const css = "#a { fill: url(#grad); stroke: #a; }\n.b>#a:hover, #z { color: #fff }";
    expect(restyle(css, { rename, scope: null })).toBe(
      "#o1aaaaaaa { fill: url(#o2bbbbbbb); stroke: #a; }\n.b>#o1aaaaaaa:hover, #z { color: #fff }",
    );
  });

  it("chiude ogni selettore nel gruppo, e la radice diventa il gruppo", () => {
    const scope = { rename, scope: "o9wwwwwww" };
    expect(restyle("rect, .st0 > path { fill: red }", scope)).toBe("#o9wwwwwww rect, #o9wwwwwww .st0 > path { fill: red }");
    expect(restyle("svg { fill: red } svg .a{} :root{} #root .b{}", scope)).toBe("#o9wwwwwww { fill: red } #o9wwwwwww .a{} #o9wwwwwww{} #o9wwwwwww .b{}");
    expect(restyle("*{stroke:none}", scope)).toBe("#o9wwwwwww *{stroke:none}");
  });

  it("entra nelle at-rule che raggruppano regole, e lascia le altre", () => {
    const scope = { rename, scope: "o9wwwwwww" };
    const css = "@media (min-width: 10px) { .a { fill: url('#grad') } }\n@font-face { font-family: X; src: url(x.woff2) }\n@keyframes k { from { opacity: 0 } }\n@import url(other.css);";
    expect(restyle(css, scope)).toBe(
      "@media (min-width: 10px) { #o9wwwwwww .a { fill: url('#o2bbbbbbb') } }\n@font-face { font-family: X; src: url(x.woff2) }\n@keyframes k { from { opacity: 0 } }\n@import url(other.css);",
    );
  });

  it("rispetta stringhe, commenti, escape e parentesi", () => {
    const scope = { rename, scope: "o9wwwwwww" };
    expect(restyle('[data-x="a,#a"], :is(#a, .b) /* c, #a */ {}', scope)).toBe('#o9wwwwwww [data-x="a,#a"], #o9wwwwwww :is(#o1aaaaaaa, .b) /* c, #a */ {}');
    expect(restyle("#x\\:y { }", { rename, scope: null })).toBe("#o3ccccccc { }");
    expect(restyle("<!-- .a{} -->", scope)).toBe("<!-- #o9wwwwwww .a{} -->");
  });

  it("un foglio malformato resta leggibile e non perde testo", () => {
    const scope = { rename, scope: "o9wwwwwww" };
    expect(restyle(".a { fill: red", scope)).toBe("#o9wwwwwww .a { fill: red");
    expect(restyle("}}{", scope)).toBe("}}{");
  });
});

describe("renameUrls", () => {
  it("rinomina solo i riferimenti noti", () => {
    expect(renameUrls('fill:url( "#grad" );stroke:url(#nope)', rename)).toBe('fill:url("#o2bbbbbbb");stroke:url(#nope)');
  });
});
