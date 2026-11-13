// Il motore delle operazioni, operazione per operazione: i rientri di un
// `move`, `adopt`, `page`, `set` sulla radice, `anchor`, i gruppi di pagina,
// `meta`, `ident`, i tratti, i terminatori, `add` con `raw` e i nomi.
import { describe, expect, it } from "vitest";
import { parseBrush } from "../../../ink/brush";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { pf1 } from "../../../ink/pf1";
import { mergeUndo, SceneEngine } from "./engine";
import { MAX_BATCH, MAX_VALUE_BYTES, type Op } from "./ops";
import { readScene } from "./read";
import type { Elem } from "./serialize";
import {
  apply,
  applied,
  BASE,
  BRUSH,
  E1,
  END,
  END_G,
  FUB_NS,
  INK,
  L1,
  L1_LOCKED,
  lf,
  NS,
  PAPER,
  R2,
  R3,
  R4,
  R4_ELEM,
  rejects,
  ROOT,
  TITLE,
} from "./engine/test-support";

describe("i rientri di un move", () => {
  const GROUP = '    <g id="o6f7g8h9i">';
  const TEXT = [
    '      <text id="o9i0j1k2l" x="720" y="460" font-size="32">',
    '        <tspan x="720" dy="0">Uno</tspan>',
    '        <tspan x="720" dy="40">Due</tspan>',
    "      </text>",
  ];

  it("un testo che esce da un gruppo perde un rientro", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...TEXT, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", ...TEXT.map((line) => line.slice(2)), END_G, END));
  });

  it("un rientro irregolare resta com'è scritto", () => {
    const odd = [TEXT[0]!, '  <tspan x="720" dy="0">Uno</tspan>', TEXT[3]!];
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...odd, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", `    ${odd[0]!.trimStart()}`, ...odd.slice(1), END_G, END));
  });

  it("il testo di un tspan non si tocca", () => {
    const spaced = [TEXT[0]!, '        <tspan x="720" dy="0">a\n        b</tspan>', TEXT[3]!];
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, GROUP, ...spaced, "    </g>", END_G, END));
    const out = apply(engine, { op: "move", target: "o9i0j1k2l", parent: "l3f8a0c2d", pos: { last: true } });
    const moved = [TEXT[0]!.slice(2), '      <tspan x="720" dy="0">a\n        b</tspan>', TEXT[3]!.slice(2)];
    expect(out.text).toBe(lf(ROOT, PAPER, L1, GROUP, "    </g>", ...moved, END_G, END));
  });
});

describe("adopt", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
  const RECT = '  <rect x="1" y="1" width="2" height="2"/>';

  it("usa il primo prefisso libero se fub è già preso", () => {
    const source = lf('<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="urn:altro" viewBox="0 0 10 10">', RECT, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "adopt" });
    const root = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="urn:altro" xmlns:fub1="${FUB_NS}" fub1:version="1" viewBox="0 0 10 10">`;
    expect(out.text).toBe(lf(root, RECT, END));
    expect(readScene(out.text).status).toBe("fubdraw");
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
  });

  it("annullato, tiene la dichiarazione se un livello la usa", () => {
    const engine = SceneEngine.open(lf(SVG, RECT, END));
    apply(engine, { op: "adopt" });
    const layer: Elem = { tag: "g", attrs: { id: "l1a2b3c4d", "fub:layer": "Nuovo" } };
    apply(engine, { op: "add", parent: "#root", pos: { last: true }, elem: layer });
    const out = apply(engine, { op: "adopt", undo: true });
    const root = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="${FUB_NS}" viewBox="0 0 10 10">`;
    expect(out.text).toBe(lf(root, RECT, '  <g id="l1a2b3c4d" fub:layer="Nuovo">', "  </g>", END));
    expect(engine.status).toBe("foreign");
    expect(engine.apply({ op: "set", id: "l1a2b3c4d", attrs: { "fub:layer": "X" } })).toMatchObject({ reason: "foreign" });
  });

  it("su una radice senza dichiarazioni va subito dopo il nome", () => {
    const source = lf("<svg viewBox='0 0 10 10'>", END);
    // Senza namespace SVG non è una scena: niente da adottare.
    expect(() => SceneEngine.open(source)).toThrow();
  });
});

describe("page", () => {
  it("su una radice senza width e height li aggiunge, e l'inversa li toglie", () => {
    const root = `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000">`;
    const source = lf(root, PAPER, L1, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "page", viewBox: "-10 -20 800 600" });
    expect(out.text).toBe(
      lf(
        `<svg ${NS} fub:version="1" viewBox="-10 -20 800 600" width="800" height="600">`,
        '  <rect id="fub-paper" fub:role="paper" x="-10" y="-20" width="800" height="600" fill="#ffffff"/>',
        L1,
        END_G,
        END,
      ),
    );
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
  });

  it("senza carta cambia solo la radice", () => {
    const engine = SceneEngine.open(lf(ROOT, L1, END_G, END));
    const out = apply(engine, { op: "page", viewBox: "0 0 800 600" });
    expect(out.text).toBe(lf(`<svg ${NS} fub:version="1" viewBox="0 0 800 600" width="800" height="600">`, L1, END_G, END));
    expect(out.inverse).toEqual({
      op: "page",
      viewBox: "0 0 1600 1000",
      previous: { root: { viewBox: "0 0 1600 1000", width: "1600", height: "1000" }, paper: null },
    });
  });
});

describe("set sulla radice", () => {
  const guides = (value: string | null): Op => ({ op: "set", id: "#root", attrs: { "fub:guides": value } });

  it("due spostamenti di una guida diventano un passo solo, esatto, e non toccano id", () => {
    const engine = SceneEngine.open(BASE);
    const first = apply(engine, guides("x 100"));
    const second = apply(engine, guides("x 110"));
    expect(first.touched).toEqual([]);
    expect(second.text).toBe(BASE.replace('height="1000">', 'height="1000" fub:guides="x 110">'));
    const merged = mergeUndo(first.undo, second.undo)!;
    expect(applied(engine.undo(merged)).text).toBe(BASE);
  });

  it("rifiuta dichiarazioni, altri attributi e valori fuori grammatica", () => {
    for (const attrs of [
      { "xmlns:fub": FUB_NS },
      { "fub:version": "2" },
      { "fub:layer": "A" },
      { width: "10" },
      { "fub:units": "pc" },
      { "fub:units": 3 },
      { "fub:guides": "x 1\u0001" },
      { "fub:guides": "x 1", "altro:guides": "x 2" },
    ]) {
      rejects(BASE, { op: "set", id: "#root", attrs }, "invalid-elem");
    }
  });

  it("su un documento estraneo aspetta «Modifica»", () => {
    rejects(lf(`<svg ${NS} viewBox="0 0 10 10">`, END), guides("x 1"), "foreign");
  });

  it("le guide che non si leggono restano com'erano, finché non si riscrivono", () => {
    const source = BASE.replace('height="1000">', 'height="1000" fub:guides="x 1;">');
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: "#root", attrs: { "fub:units": "mm" } });
    expect(out.text).toBe(BASE.replace('height="1000">', 'height="1000" fub:units="mm" fub:guides="x 1;">'));
    expect(apply(engine, guides("y 2")).inverse).toEqual(guides("x 1;"));
  });
});

describe("anchor", () => {
  const HEX = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const OTHER = "0".repeat(64);
  const ANNOTATIONS = `<svg ${NS} fub:version="1" fub:annotates="Bando.pdf"`;
  const P1 = '  <g id="p0001" fub:page="1" fub:page-size="595 842">';

  it("riscrive solo i valori, anche fra apici singoli, e l'inversa rimette quelli di prima", () => {
    const source = lf(`${ANNOTATIONS} fub:pages='3' data-x="1" fub:digest='SHA256:${HEX}'>`, P1, END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "anchor", digest: `sha256:${OTHER}`, pages: 12 });
    expect(out.text).toBe(lf(`${ANNOTATIONS} fub:pages='12' data-x="1" fub:digest='sha256:${OTHER}'>`, P1, END_G, END));
    expect(out.inverse).toEqual({ op: "anchor", previous: { digest: `SHA256:${HEX}`, pages: "3" } });
    expect(applied(SceneEngine.open(out.text).apply(out.inverse)).text).toBe(source);
  });

  it("l'inversa toglie ciò che non c'era, col suo spazio", () => {
    const source = lf(`${ANNOTATIONS}>`, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "anchor", digest: `sha256:${HEX}`, pages: 1 });
    expect(out.text).toBe(lf(`${ANNOTATIONS} fub:digest="sha256:${HEX}" fub:pages="1">`, END));
    expect(apply(engine, out.inverse).text).toBe(source);
  });

  it("scrive solo la parte che riceve, e l'inversa rimette l'altra com'era", () => {
    const source = lf(`${ANNOTATIONS} fub:pages="3">`, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "anchor", digest: `sha256:${HEX}` });
    expect(out.text).toBe(lf(`${ANNOTATIONS} fub:pages="3" fub:digest="sha256:${HEX}">`, END));
    expect(out.inverse).toEqual({ op: "anchor", previous: { digest: null, pages: "3" } });
    expect(apply(engine, out.inverse).text).toBe(source);
    const pages = apply(SceneEngine.open(lf(`${ANNOTATIONS} fub:digest='SHA256:${HEX}'>`, END)), { op: "anchor", pages: 7 });
    expect(pages.text).toBe(lf(`${ANNOTATIONS} fub:digest='SHA256:${HEX}' fub:pages="7">`, END));
  });

  it("rifiuta un'impronta o un numero di pagine fuori grammatica, e un documento estraneo", () => {
    const source = lf(`${ANNOTATIONS}>`, END);
    for (const [digest, pages] of [
      [`sha256:${HEX.toUpperCase()}`, 1],
      [`sha256:${HEX}0`, 1],
      [`sha1:${HEX}`, 1],
      [`sha256:${HEX}`, 0],
      [`sha256:${HEX}`, 1.5],
      [`sha256:${HEX}`, 2 ** 32],
      [`sha256:${HEX}`, "3"],
    ]) {
      rejects(source, { op: "anchor", digest, pages }, "invalid-elem");
    }
    rejects(source, { op: "anchor" }, "invalid-elem");
    rejects(source, { op: "anchor", digest: null, pages: 1 }, "invalid-elem");
    rejects(lf('<svg xmlns="http://www.w3.org/2000/svg">', END), { op: "anchor", digest: `sha256:${HEX}`, pages: 1 }, "foreign");
  });
});

describe("i gruppi di pagina", () => {
  const ANNOTATIONS = `<svg ${NS} fub:version="1" fub:annotates="Bando.pdf">`;
  const page = (id: string, n: string): unknown => ({
    op: "add",
    parent: "#root",
    pos: { last: true },
    elem: { tag: "g", attrs: { id, "fub:page": n, "fub:page-size": "595 842" } },
  });

  it("hanno l'id dal numero, su almeno quattro cifre", () => {
    const engine = SceneEngine.open(lf(ANNOTATIONS, END));
    apply(engine, page("p0003", "3") as Op);
    const out = apply(engine, page("p12345", "12345") as Op);
    expect(out.text).toBe(
      lf(ANNOTATIONS, '  <g id="p0003" fub:page="3" fub:page-size="595 842">', END_G, '  <g id="p12345" fub:page="12345" fub:page-size="595 842">', END_G, END),
    );
    for (const [id, n] of [["p3", "3"], ["p0004", "3"], ["o1a2b3c4d", "3"], ["p0000", "0"]]) {
      rejects(lf(ANNOTATIONS, END), page(id!, n!), "invalid-elem");
    }
  });

  it("ident dà a un gruppo di pagina l'id del suo numero", () => {
    const source = lf(ANNOTATIONS, '  <g fub:page="2"/>', END);
    rejects(source, { op: "ident", path: [0], tag: "g", id: "o1a2b3c4d" }, "invalid-elem");
    const out = apply(SceneEngine.open(source), { op: "ident", path: [0], tag: "g", id: "p0002" });
    expect(out.text).toBe(lf(ANNOTATIONS, '  <g id="p0002" fub:page="2"/>', END));
  });
});

describe("meta", () => {
  it("mette la descrizione dopo il titolo, e null li toglie", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "meta", desc: "Una prova" });
    expect(out.text).toBe(lf(ROOT, TITLE, "  <desc>Una prova</desc>", PAPER, L1, E1, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "meta", desc: null });
    const both = apply(engine, { op: "meta", title: null, desc: null });
    expect(both.text).toBe(lf(ROOT, PAPER, L1, E1, R2, R3, END_G, END));
    expect(applied(engine.apply(both.inverse)).text).toBe(out.text);
  });

  it("un titolo vuoto resta un titolo, autochiuso come ogni elemento senza testo", () => {
    const engine = SceneEngine.open(BASE);
    expect(apply(engine, { op: "meta", title: "" }).text).toBe(lf(ROOT, "  <title/>", PAPER, L1, E1, R2, R3, END_G, END));
  });
});

describe("ident", () => {
  const BARE = '    <rect x="10" y="10" width="50" height="50"/>';

  it("toglie l'id, e l'inversa lo rimette", () => {
    const source = lf(ROOT, PAPER, L1, '    <rect id="o0a1b2c3d" x="10" y="10" width="50" height="50"/>', END_G, END);
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: null });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, BARE, END_G, END));
    expect(out.inverse).toEqual({ op: "ident", path: [1, 0], tag: "rect", id: "o0a1b2c3d" });
    expect(applied(engine.apply(out.inverse)).text).toBe(source);
  });

  it("non riusa un id del documento", () => {
    rejects(lf(ROOT, PAPER, L1, BARE, R2, END_G, END), { op: "ident", path: [1, 0], tag: "rect", id: "o2b3c4d5e" }, "duplicate-id");
  });

  it("cambia un id togliendolo e dandone un altro, e l'undo rimette quello di prima com'era", () => {
    const source = lf(ROOT, PAPER, L1, "    <rect id='path1234' x=\"10\" y=\"10\" width=\"50\" height=\"50\"/>", END_G, END);
    const engine = SceneEngine.open(source);
    const rename: Op = {
      op: "batch",
      ops: [
        { op: "ident", path: [1, 0], tag: "rect", id: null },
        { op: "ident", path: [1, 0], tag: "rect", id: "Sole_1" },
      ],
    };
    const out = apply(engine, rename);
    expect(out.text).toBe(lf(ROOT, PAPER, L1, '    <rect id="Sole_1" x="10" y="10" width="50" height="50"/>', END_G, END));
    expect([...out.touched].sort()).toEqual(["Sole_1", "path1234"]);
    expect(applied(engine.apply(out.inverse)).text, "l'undo").toBe(lf(ROOT, PAPER, L1, BARE.replace("<rect", '<rect id="path1234"'), END_G, END));
  });

  it("dà ogni id che il formato ammette, e rifiuta quello vuoto, non XML o troppo lungo", () => {
    const source = lf(ROOT, PAPER, L1, BARE, END_G, END);
    const engine = SceneEngine.open(source);
    expect(apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: "un sole & più" }).text).toContain('<rect id="un sole &amp; più"');
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "" }, "invalid-elem");
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "a\u0001" }, "invalid-elem");
    rejects(source, { op: "ident", path: [1, 0], tag: "rect", id: "a".repeat(MAX_VALUE_BYTES + 1) }, "limit");
  });

  it("scrive l'id nel tag così com'è, senza riordinare il resto", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, "    <rect height='50'   width='50'/>", END_G, END));
    const out = apply(engine, { op: "ident", path: [1, 0], tag: "rect", id: "o0a1b2c3d" });
    expect(out.text).toBe(lf(ROOT, PAPER, L1, "    <rect id=\"o0a1b2c3d\" height='50'   width='50'/>", END_G, END));
  });
});

describe("i tratti", () => {
  const STROKE = `    <path id="o7k2m9x4q" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>`;

  it("un set del pennello ridisegna il contorno", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, STROKE, END_G, END));
    const brush = BRUSH.replace("size=4", "size=8");
    const out = apply(engine, { op: "set", id: "o7k2m9x4q", attrs: { "fub:brush": brush } });
    const d = pf1(inkToQuantized(decodeInk(INK)), parseBrush(brush));
    const redrawn = `    <path id="o7k2m9x4q" fub:tool="pen" fub:brush="${brush}" d="${d}" fill="#000000" fub:ink="${INK}"/>`;
    expect(out.text).toBe(lf(ROOT, PAPER, L1, redrawn, END_G, END));
    // L'inversa rimette il pennello e il `d` di prima, scritto a mano.
    expect(out.inverse).toEqual({ op: "set", id: "o7k2m9x4q", attrs: { "fub:brush": BRUSH, d: "M0 0 Z" } });
  });

  it("un d scritto a mano su un tratto si ricalcola", () => {
    const engine = SceneEngine.open(lf(ROOT, PAPER, L1, STROKE, END_G, END));
    const out = apply(engine, { op: "set", id: "o7k2m9x4q", attrs: { d: "M1 1 Z" } });
    expect(out.text).toContain(` d="${pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH))}"`);
  });

  it("un inchiostro non conforme si rifiuta", () => {
    const broken: Op = { op: "set", id: "o7k2m9x4q", attrs: { "fub:ink": "1 s100 cxypt 1,2" } };
    rejects(lf(ROOT, PAPER, L1, STROKE, END_G, END), broken, "invalid-elem");
  });
});

describe("i terminatori", () => {
  it("le righe nuove usano il terminatore prevalente, anche \\r", () => {
    const source = [ROOT, TITLE, PAPER, L1, E1, END_G, END, ""].join("\r");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, elem: R4_ELEM });
    expect(out.text).toBe([ROOT, TITLE, PAPER, L1, E1, R4, END_G, END, ""].join("\r"));
  });

  it("un set su un gruppo autochiuso in un file CRLF apre il gruppo con CRLF", () => {
    const source = [ROOT, PAPER, L1, '    <g id="o6f7g8h9i"/>', END_G, END, ""].join("\r\n");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "set", id: "o6f7g8h9i", attrs: { opacity: "0.5" } });
    expect(out.text).toBe([ROOT, PAPER, L1, '    <g id="o6f7g8h9i" opacity="0.5">', "    </g>", END_G, END, ""].join("\r\n"));
  });
});

describe("add con raw", () => {
  const RAW = '<g style="fill:#e69f00">\n      <!-- un commento -->\n      <rect width="10" height="10"/>\n    </g>';

  it("scrive l'elemento estraneo così com'è, e l'inversa lo toglie col percorso", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { after: "o1a2b3c4d" }, raw: RAW });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, `    ${RAW}`, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "remove", target: { path: [2, 1], tag: "g" } });
    expect(engine.scene().some((item) => item.kind === "foreign")).toBe(true);
    apply(engine, out.inverse);
    expect(engine.text).toBe(BASE);
  });

  it("con un id lo toglie per id, e un add ripetuto è un doppione", () => {
    const engine = SceneEngine.open(BASE);
    const raw = '<use id="u1" href="#o1a2b3c4d" x="10"/>';
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw });
    expect(out.inverse).toEqual({ op: "remove", target: "u1" });
    expect(out.touched).toContain("u1");
    const again = applied(engine.apply({ op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }));
    expect(again.duplicate).toBe(true);
    expect(again.text).toBe(out.text);
  });

  it("i ritorni a capo diventano quelli del documento", () => {
    const source = [ROOT, TITLE, PAPER, L1, E1, END_G, END, ""].join("\r\n");
    const engine = SceneEngine.open(source);
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw: '<g style="x">\n<rect/>\r</g>' });
    expect(out.text).toBe([ROOT, TITLE, PAPER, L1, E1, '    <g style="x">', "<rect/>", "</g>", END_G, END, ""].join("\r\n"));
  });

  it("uno script entra inerte, con S005", () => {
    const engine = SceneEngine.open(BASE);
    const out = apply(engine, { op: "add", parent: "#root", pos: { last: true }, raw: "<script>alert(1)</script>" });
    expect(readScene(out.text).diagnostics.map((d) => d.code)).toContain("S005");
  });

  it("una sequenza entra con gli spazi fra gli elementi, e l'inversa la toglie dall'ultimo al primo", () => {
    const engine = SceneEngine.open(BASE);
    const raw = `${R4.trim()}\n    <g style="x"><!-- nota --><rect/></g>`;
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, E1, R2, R3, R4, '    <g style="x"><!-- nota --><rect/></g>', END_G, END));
    expect(out.inverse).toEqual({ op: "batch", ops: [{ op: "remove", target: { path: [2, 4], tag: "g" } }, { op: "remove", target: "o4d5e6f7g" }] });
    expect(engine.scene().some((item) => item.kind === "element" && item.id === "o4d5e6f7g")).toBe(true);
    apply(engine, out.inverse);
    expect(engine.text).toBe(BASE);
  });

  it("in un genitore vuoto la sequenza va su righe sue", () => {
    const engine = SceneEngine.open(lf(ROOT, TITLE, PAPER, '  <g id="l3f8a0c2d" fub:layer="Livello 1"/>', END));
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw: `${R4.trim()}\n    <rect style="x"/>` });
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, R4, '    <rect style="x"/>', END_G, END));
  });

  it("un elemento del formato tiene i suoi byte, e il contorno dei tratti si ricalcola", () => {
    const engine = SceneEngine.open(BASE);
    const d = pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH));
    const group = '<g id="o5e6f7g8h"  opacity=\'0.5\'>\n      <!-- c -->\n      <foo xmlns="urn:x"/>\n      <rect id="o6f7g8h9i" x="1" y="1" width="2" height="2"/>\n    </g>';
    const stale = `<path id="o7k2m9x4q" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>`;
    const bare = `<path id="o8m3n0y5r" fub:tool="highlighter" fub:brush="${BRUSH}" fill="#000000" fub:ink="${INK}"></path>`;
    const raw = `${group}\n    ${stale}\n    ${bare}`;
    const out = apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { first: true }, raw });
    const strokes = [stale.replace('d="M0 0 Z"', `d="${d}"`), bare.replace('"></path>', `" d="${d}"></path>`)];
    expect(out.text).toBe(lf(ROOT, TITLE, PAPER, L1, `    ${group}`, ...strokes.map((s) => `    ${s}`), E1, R2, R3, END_G, END));
    expect(out.inverse).toEqual({ op: "batch", ops: ["o8m3n0y5r", "o7k2m9x4q", "o5e6f7g8h"].map((target) => ({ op: "remove", target })) });
    expect(out.touched).toEqual(expect.arrayContaining(["o5e6f7g8h", "o6f7g8h9i", "o7k2m9x4q", "o8m3n0y5r"]));
  });

  it("rifiuta una forma sbagliata, un elemento del formato che elem non ammetterebbe, gli id presi e i genitori bloccati", () => {
    const add = (raw: unknown, parent = "l3f8a0c2d"): unknown => ({ op: "add", parent, pos: { last: true }, raw });
    rejects(BASE, { ...(add("<rect style='x'/>") as object), elem: R4_ELEM }, "invalid-elem");
    const malformed = ["<rect style='x'>", "<rect style='x'/>testo<rect style='y'/>", " <rect style='x'/>", "<rect style='x'/> ", "<!-- c --><rect style='x'/>", "<rect style='x'/><!-- c --><rect style='y'/>", "<rect style='x'/><?pi?><rect style='y'/>", "testo", 7, ""];
    for (const raw of malformed) rejects(BASE, add(raw), "invalid-elem");
    for (const raw of [
      '<rect width="10" height="10"/>',
      '<rect id="z" width="10" height="10"/>',
      '<g id="l1b2c3d4e" fub:layer="Dentro"/>',
      '<rect id="o9z8y7x6w" fub:role="paper" width="10" height="10"/>',
      '<g id="o9z8y7x6w"><rect width="1" height="1"/></g>',
      `<path id="o9z8y7x6w" fub:tool="pen" fub:brush="${BRUSH}" fub:ink="1 s100 cxypt"/>`,
    ]) {
      rejects(BASE, add(raw), "invalid-elem");
    }
    rejects(BASE, add("<title>Nome</title>", "#root"), "invalid-elem");
    rejects(BASE, add(`<rect id="o9z8y7x6w" width="1" height="1" font-family="${"x".repeat(MAX_VALUE_BYTES + 1)}"/>`), "limit");
    rejects(BASE, add('<g style="x"><rect id="o2b3c4d5e"/></g>'), "duplicate-id");
    rejects(BASE, add('<g style="x"><rect id="z"/><rect id="z"/></g>'), "duplicate-id");
    rejects(BASE, add(`${R4.trim()}<rect style="x" id="o4d5e6f7g"/>`), "duplicate-id");
    rejects(lf(ROOT, TITLE, PAPER, L1_LOCKED, E1, END_G, END), add("<rect style='x'/>"), "locked");
    rejects(BASE, add("<rect style='x'/>", "o1a2b3c4d"), "missing-parent");
  });

  it("un estraneo porta valori oltre il limite di elem", () => {
    const engine = SceneEngine.open(BASE);
    const raw = `<rect style="x" data-n="${"x".repeat(MAX_VALUE_BYTES + 1)}"/>`;
    expect(apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }).text).toContain(raw);
  });

  it(`l'inversa di una sequenza lunga si applica anche oltre ${MAX_BATCH} operazioni`, () => {
    const engine = SceneEngine.open(BASE);
    const ids = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `o${i.toString(36).padStart(8, "0")}`);
    const raw = ids.map((id) => `<rect id="${id}" x="0" y="0" width="1" height="1"/>`).join("\n    ");
    const added = applied(engine.apply({ op: "add", parent: "l3f8a0c2d", pos: { last: true }, raw }));
    // Un'altra modifica in mezzo: l'annulla non è più esatto, e passa
    // dall'inversa.
    applied(engine.apply({ op: "set", id: "o1a2b3c4d", attrs: { fill: "#000000" } }));
    applied(engine.undo(added.undo));
    expect(engine.text).toBe(BASE.replace('fill="none"', 'fill="#000000"'));
    // Ciò che arriva resta nel limite.
    rejects(BASE, added.undo.inverse, "limit");
  });
});

describe("i nomi", () => {
  it("il nome di un oggetto segue il suo primo `title`, anche quando il tag del contenitore si riscrive", () => {
    const engine = SceneEngine.open(BASE);
    const named = (id: string): string | undefined => {
      const item = engine.scene().find((entry) => entry.kind === "element" && entry.id === id);
      return item?.kind === "element" ? item.title : undefined;
    };
    apply(engine, { op: "add", parent: "l3f8a0c2d", pos: { first: true }, elem: { tag: "title", attrs: {}, text: "Sfondo" } });
    expect(named("l3f8a0c2d")).toBe("Sfondo");
    // Il tag d'apertura si riscrive senza rileggere i figli: il nome resta.
    apply(engine, { op: "set", id: "l3f8a0c2d", attrs: { "fub:layer": "Primo" } });
    expect(named("l3f8a0c2d")).toBe("Sfondo");
    apply(engine, {
      op: "add",
      parent: "l3f8a0c2d",
      pos: { last: true },
      elem: { tag: "g", attrs: { id: "o9g8f7e6d" }, children: [{ tag: "title", attrs: {}, text: "Casa" }, { ...R4_ELEM, children: [{ tag: "title", attrs: {}, text: "Tetto" }] }] },
    });
    expect(named("o9g8f7e6d")).toBe("Casa");
    expect(named("o4d5e6f7g")).toBe("Tetto");
    apply(engine, { op: "set", id: "o9g8f7e6d", attrs: { opacity: "0.5" } });
    expect(named("o9g8f7e6d")).toBe("Casa");
    apply(engine, { op: "remove", target: { path: [2, 0], tag: "title" } });
    expect(named("l3f8a0c2d")).toBeUndefined();
    expect(named("o1a2b3c4d")).toBeUndefined();
  });
});
