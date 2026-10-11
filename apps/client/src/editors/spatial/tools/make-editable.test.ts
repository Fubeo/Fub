import { describe, expect, it } from "vitest";
import { ROOT_PRESENTATION } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import { LIVE_ROOT, planEditable, type EditablePlan, type EditableScope } from "./make-editable";

const ALL: EditableScope = { kind: "all" };

/// Il piano su `text`. Le operazioni, applicate a un motore in un passo solo,
/// danno il testo che il piano dice; il loro inverso torna al testo di prima.
function plan(text: string, scope: EditableScope = ALL): EditablePlan {
  const out = planEditable(text, scope);
  if (out.ops.length === 0) {
    expect(out.after).toBeNull();
    return out;
  }
  const engine = SceneEngine.open(text);
  const applied = engine.apply({ op: "batch", ops: [...out.ops] });
  expect(applied.outcome).toBe("applied");
  if (applied.outcome !== "applied") return out;
  expect(applied.text).toBe(out.after);
  expect(engine.status).toBe("fubdraw");
  const undone = engine.apply(applied.inverse);
  expect(undone.outcome === "applied" && undone.text).toBe(text);
  return out;
}

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';
const svg = (body: string, attrs = 'viewBox="0 0 200 100"'): string => `<svg ${NS} ${attrs}>\n${body}\n</svg>\n`;

describe("rendere modificabile un disegno", () => {
  it("un file di Illustrator: le classi diventano attributi, i nomi titoli, il foglio se ne va", () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Livello_1" data-name="Livello 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <style>
      .cls-1 {
        fill: #e30613;
      }

      .cls-2 {
        fill: none;
        stroke: #000;
        stroke-miterlimit: 10;
        stroke-width: 2px;
      }
    </style>
  </defs>
  <rect class="cls-1" x="10" y="10" width="30" height="30"/>
  <circle class="cls-2" cx="70" cy="30" r="15"/>
  <path class="cls-1" data-name="Tracciato 1" d="M10 60 L40 90 L10 90 Z"/>
</svg>
`;
    expect(SceneEngine.open(text).status).toBe("foreign");
    const out = plan(text);
    expect(out.after).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<svg id="Livello_1" data-name="Livello 1" xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100">
  <rect x="10" y="10" width="30" height="30" fill="#e30613"/>
  <circle cx="70" cy="30" r="15" fill="none" stroke="#000" stroke-width="2"/>
  <path d="M10 60 L40 90 L10 90 Z" fill="#e30613"><title>Tracciato 1</title></path>
</svg>
`);
    expect(out.ops[0]).toEqual({ op: "adopt" });
    expect(out.leftovers).toEqual([]);
    expect([out.converted, out.rules, out.sheets, out.invisible]).toEqual([3, 2, 1, 0]);
    expect(Object.fromEntries(out.translations)).toEqual({ sheet: 3, data: 1 });
  });

  it("un file di Inkscape: lo stile in linea diventa attributi, nell'ordine e nel modo di scrivere del file", () => {
    const text = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
   width="210mm"
   height="297mm"
   viewBox="0 0 210 297"
   version="1.1"
   id="svg1"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg">
  <sodipodi:namedview
     id="namedview1"
     pagecolor="#ffffff" />
  <defs
     id="defs1" />
  <g
     inkscape:label="Livello 1"
     inkscape:groupmode="layer"
     id="layer1">
    <rect
       style="fill:#ff0000;fill-opacity:1;stroke:#000000;stroke-width:0.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1"
       id="rect1"
       width="50"
       height="40"
       x="20"
       y="30" />
    <path
       style="fill:none;stroke:#0000ff;stroke-width:1px;stroke-linecap:butt;stroke-linejoin:miter;stroke-opacity:1"
       d="m 20,100 50,0 -25,40 z"
       id="path1" />
  </g>
</svg>
`;
    const out = plan(text);
    expect(out.after).toContain(`    <rect
       id="rect1"
       width="50"
       height="40"
       x="20"
       y="30"
       fill="#ff0000"
       stroke="#000000"
       stroke-width="0.5"
       stroke-linecap="round"
       stroke-linejoin="round" />
    <path
       d="m 20,100 50,0 -25,40 z"
       id="path1"
       fill="none"
       stroke="#0000ff" />`);
    expect(out.after).toContain(`  <sodipodi:namedview
     id="namedview1"
     pagecolor="#ffffff" />`);
    expect([out.converted, out.rules, out.sheets, out.invisible]).toEqual([2, 0, 0, 1]);
    expect(Object.fromEntries(out.translations)).toEqual({ style: 2 });
  });

  it("i colori di CSS diventano colori del formato, con l'opacità a parte; quelli già buoni restano come sono scritti", () => {
    const out = plan(svg(`  <rect x="0" y="0" width="10" height="10" style="fill:rgb(255, 0, 0);stroke:hsla(120, 100%, 50%, 0.5)"/>
  <rect x="20" y="0" width="10" height="10" style="fill:transparent;stroke:red"/>
  <rect x="40" y="0" width="10" height="10" style="color:#336699;fill:currentColor"/>
  <rect x="60" y="0" width="10" height="10" style="fill:#F00;fill-opacity:50%"/>`));
    expect(out.after).toBe(svg(`  <rect x="0" y="0" width="10" height="10" fill="#ff0000" stroke="#00ff00" stroke-opacity="0.5"/>
  <rect x="20" y="0" width="10" height="10" fill="none" stroke="red"/>
  <rect x="40" y="0" width="10" height="10" fill="#336699"/>
  <rect x="60" y="0" width="10" height="10" fill="#F00" fill-opacity="0.5"/>`));
    expect(Object.fromEntries(out.translations)).toEqual({ style: 4, color: 2 });
  });

  it("le misure relative diventano pixel", () => {
    const out = plan(svg(`  <rect x="10%" y="5%" width="50%" height="2em" style="font-size:20px"/>`));
    expect(out.after).toBe(svg(`  <rect x="20" y="5" width="100" height="40"/>`));
    expect(Object.fromEntries(out.translations)).toEqual({ style: 1, unit: 1 });
  });

  it("una regola sotto una condizione tiene estraneo ciò che sceglie, e il foglio con lui", () => {
    const out = plan(svg(`  <style>.a{fill:#000}@media (prefers-color-scheme: dark){.a{fill:#fff}}</style>
  <rect class="a" x="0" y="0" width="10" height="10"/>
  <rect style="fill:blue" x="20" y="0" width="10" height="10"/>`));
    expect(out.after).toBe(svg(`  <style>.a{fill:#000}@media (prefers-color-scheme: dark){.a{fill:#fff}}</style>
  <rect class="a" x="0" y="0" width="10" height="10"/>
  <rect x="20" y="0" width="10" height="10" fill="blue"/>`));
    expect(out.leftovers).toEqual([{ path: [1], tag: "rect", name: null, reason: { kind: "condition", text: "@media (prefers-color-scheme: dark)" } }]);
    expect([out.converted, out.rules, out.sheets, out.invisible]).toEqual([1, 0, 0, 1]);
  });

  it("le regole che non scelgono mai niente, come quelle del puntatore sopra, se ne vanno", () => {
    const out = plan(svg(`  <style>.b{fill:#000}.b:hover{fill:red}</style>
  <rect class="b" x="0" y="0" width="10" height="10"/>`));
    expect(out.after).toBe(svg(`  <rect x="0" y="0" width="10" height="10"/>`));
    expect([out.converted, out.rules, out.sheets]).toEqual([1, 2, 1]);
  });

  it("un foglio in CDATA, coi commenti e con !important, vale come lo vede un browser", () => {
    const out = plan(svg(`  <style><![CDATA[ .a { fill: #f00 } /* commento */ .b{stroke:#00f !important} ]]></style>
  <rect class="a b" x="0" y="0" width="10" height="10" style="stroke:#0f0"/>`));
    expect(out.after).toBe(svg(`  <rect x="0" y="0" width="10" height="10" fill="#f00" stroke="#00f"/>`));
    expect([out.rules, out.sheets]).toEqual([2, 1]);
  });

  it("una variabile si risolve, e la regola che la dichiara se ne va quando nessuno la usa più", () => {
    const out = plan(svg(`  <style>:root{--c:#f00}.a{fill:var(--c)}</style>
  <rect class="a" x="0" y="0" width="10" height="10"/>`));
    expect(out.after).toBe(svg(`  <rect x="0" y="0" width="10" height="10" fill="#f00"/>`));
    const kept = plan(svg(`  <style>:root{--c:#f00}.a{fill:var(--c)}.b{fill:var(--c)}</style>
  <rect class="a" x="0" y="0" width="10" height="10"/>
  <switch><rect class="b" x="0" y="0" width="10" height="10"/></switch>`));
    expect(kept.leftovers.map((each) => each.reason)).toEqual([{ kind: "element", tag: "switch" }]);
    expect(kept.after).toContain("<style>:root{--c:#f00}.b{fill:var(--c)}</style>");
  });

  it("una regola per tipo che sceglie anche ciò che resta estraneo non si toglie", () => {
    const out = plan(svg(`  <style>path{stroke-linejoin:round}</style>
  <path style="stroke:#000" d="M0 0 L10 10 L20 0"/>
  <switch><path d="M0 0 L5 5"/></switch>`));
    expect(out.ops).toEqual([]);
    expect(out.leftovers).toEqual([
      { path: [1], tag: "path", name: null, reason: { kind: "shared", text: "path" } },
      { path: [2], tag: "switch", name: null, reason: { kind: "element", tag: "switch" } },
    ]);
  });

  it("una regola per tipo che sceglie solo ciò che si converte se ne va, e l'angolo dell'autore resta", () => {
    const out = plan(svg(`  <style>path{stroke-linejoin:round}</style>
  <path style="stroke:#000" d="M0 0 L10 10 L20 0"/>
  <path class="x" stroke="#000" d="M0 20 L10 30 L20 20"/>`));
    expect(out.after).toBe(svg(`  <path d="M0 0 L10 10 L20 0" stroke="#000" stroke-linejoin="round"/>
  <path stroke="#000" d="M0 20 L10 30 L20 20" stroke-linejoin="round"/>`));
    expect([out.converted, out.rules, out.sheets]).toEqual([2, 1, 1]);
  });

  it("un limite degli spigoli che cambia l'aspetto resta estraneo; dove non si vede si toglie", () => {
    const out = plan(svg(`  <defs><style>.cls-1{fill:none;stroke:#000;stroke-miterlimit:10}</style></defs>
  <path class="cls-1" d="M0 0 L100 17.6 L0 35.2 Z"/>
  <path class="cls-1" d="M0 50 H100 V90 H0 Z"/>`));
    expect(out.after).toBe(svg(`  <defs><style>.cls-1{fill:none;stroke:#000;stroke-miterlimit:10}</style></defs>
  <path class="cls-1" d="M0 0 L100 17.6 L0 35.2 Z"/>
  <path d="M0 50 H100 V90 H0 Z" fill="none" stroke="#000"/>`));
    expect(out.leftovers).toEqual([{ path: [1], tag: "path", name: null, reason: { kind: "property", name: "stroke-miterlimit", value: "10" } }]);
  });

  it("la regola di riempimento conta solo dove la forma ha dei buchi", () => {
    const out = plan(svg(`  <path style="fill:#000;fill-rule:evenodd" d="M0 0 H10 V10 H0 Z"/>
  <path style="fill:#000;fill-rule:evenodd" d="M20 0 H40 V20 H20 Z M25 5 H35 V15 H25 Z"/>`));
    expect(out.after).toBe(svg(`  <path d="M0 0 H10 V10 H0 Z"/>
  <path style="fill:#000;fill-rule:evenodd" d="M20 0 H40 V20 H20 Z M25 5 H35 V15 H25 Z"/>`));
    expect(out.leftovers).toEqual([{ path: [1], tag: "path", name: null, reason: { kind: "property", name: "fill-rule", value: "evenodd" } }]);
  });

  it("un gruppo tiene ciò che porta ai figli, anche a quelli che restano estranei", () => {
    const out = plan(svg(`  <g class="grp" data-name="Gruppo">
    <rect style="fill:red" x="0" y="0" width="10" height="10"/>
    <foreignObject x="0" y="20" width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  </g>
  <style>.grp{stroke:#00f;stroke-width:2}</style>`));
    expect(out.after).toBe(svg(`  <g stroke="#00f" stroke-width="2">
    <title>Gruppo</title>
    <rect x="0" y="0" width="10" height="10" fill="red"/>
    <foreignObject x="0" y="20" width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  </g>`));
    expect(out.leftovers).toEqual([{ path: [0, 2], tag: "foreignObject", name: null, reason: { kind: "element", tag: "foreignObject" } }]);
    expect(Object.fromEntries(out.translations)).toEqual({ style: 1, sheet: 1, data: 1 });
  });

  it("il carattere di un testo, con la dimensione in pixel e il peso com'è scritto", () => {
    const out = plan(svg(`  <text x="10" y="20" style="font-family:'Myriad Pro', sans-serif;font-size:1.5em;font-weight:bold"><tspan x="10" dy="0">Ciao</tspan></text>`));
    expect(out.after).toBe(svg(`  <text x="10" y="20" font-family="'Myriad Pro', sans-serif" font-size="24" font-weight="bold"><tspan x="10" dy="0">Ciao</tspan></text>`));
  });

  it("i livelli bloccati, ciò che altri copiano, le copie e i comportamenti restano come sono", () => {
    const out = plan(svg(`  <g fub:layer="Livello" fub:locked="true"><rect style="fill:red" x="0" y="0" width="10" height="10"/></g>
  <rect id="r" style="fill:red" x="20" y="0" width="10" height="10"/>
  <use href="#r" x="50"/>
  <rect onclick="x()" style="fill:red" x="40" y="0" width="10" height="10"/>`));
    expect(out.ops).toEqual([]);
    expect(out.leftovers.map((each) => [each.path, each.name, each.reason])).toEqual([
      [[0, 0], null, { kind: "locked" }],
      [[1], "r", { kind: "copy" }],
      [[2], null, { kind: "use" }],
      [[3], null, { kind: "attribute", name: "onclick" }],
    ]);
  });

  it("su un blocco solo, le regole che servono ancora agli altri restano", () => {
    const out = plan(
      svg(`  <defs><style>.cls-1{fill:#e30613}.cls-2{fill:#000}</style></defs>
  <rect class="cls-1" x="0" y="0" width="10" height="10"/>
  <rect class="cls-1" x="20" y="0" width="10" height="10"/>
  <rect class="cls-2" x="40" y="0" width="10" height="10"/>`),
      { kind: "units", paths: [[1], [3]] },
    );
    expect(out.after).toBe(svg(`  <defs><style>.cls-1{fill:#e30613}</style></defs>
  <rect x="0" y="0" width="10" height="10" fill="#e30613"/>
  <rect class="cls-1" x="20" y="0" width="10" height="10"/>
  <rect x="40" y="0" width="10" height="10"/>`));
    expect([out.converted, out.rules, out.sheets]).toEqual([2, 1, 0]);
  });

  it("le fermate di una sfumatura e chi la usa si convertono insieme", () => {
    const out = plan(svg(`  <defs id="defs1"><linearGradient id="lg1"><stop style="stop-color:#ff0000;stop-opacity:1" offset="0" id="stop1"/><stop style="stop-color:#0000ff;stop-opacity:0.5" offset="1" id="stop2"/></linearGradient></defs>
  <rect style="fill:url(#lg1);stroke:none" x="0" y="0" width="10" height="10"/>`));
    expect(out.after).toBe(svg(`  <defs id="defs1"><linearGradient id="lg1"><stop offset="0" id="stop1" stop-color="#ff0000"/><stop offset="1" id="stop2" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient></defs>
  <rect x="0" y="0" width="10" height="10" fill="url(#lg1)"/>`));
    expect(out.converted).toBe(2);
  });

  it("la trasformazione di CSS attorno a un'origine diventa una matrice; la fusione resta nello stile", () => {
    const out = plan(svg(`  <g style="opacity:0.5;mix-blend-mode:multiply"><rect style="fill:red;transform:rotate(45deg);transform-origin:5px 5px" x="0" y="0" width="10" height="10"/></g>`));
    expect(out.after).toBe(svg(`  <g opacity="0.5" style="mix-blend-mode:multiply"><rect x="0" y="0" width="10" height="10" fill="red" transform="matrix(0.7071 0.7071 -0.7071 0.7071 5 -2.0711)"/></g>`));
  });

  it("lo stile della radice, che la superficie non porta ai livelli vivi, si scrive sui figli", () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="fill:#00f;stroke-width:3">
  <path style="stroke:#000" d="M0 0 L10 10"/>
  <circle class="c" cx="50" cy="50" r="10"/>
</svg>
`;
    const out = plan(text);
    expect(out.after).toBe(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100" style="fill:#00f;stroke-width:3">
  <path d="M0 0 L10 10" fill="#00f" stroke="#000" stroke-width="3"/>
  <circle cx="50" cy="50" r="10" fill="#00f"/>
</svg>
`);
  });

  it("un disegno già modificabile non cambia", () => {
    const out = plan(svg(`  <rect x="0" y="0" width="10" height="10" fill="red"/>`));
    expect(out.ops).toEqual([]);
    expect([out.converted, out.leftovers.length]).toEqual([0, 0]);
  });

  it("gli attributi della radice che passano ai livelli vivi sono quelli del pittore", () => {
    expect([...LIVE_ROOT]).toEqual([...ROOT_PRESENTATION]);
  });
});
