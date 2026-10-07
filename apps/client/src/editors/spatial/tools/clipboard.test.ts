// Gli appunti: la selezione copiata come SVG, e un SVG incollato come
// operazioni che il motore accetta in un passo solo. Un giro fra due disegni
// riporta gli stessi byte, id a parte.

import { describe, expect, it } from "vitest";
import { MAX_OP_BYTES, type Op } from "../scene/ops";
import { MAX_EDIT_BYTES, readScene } from "../scene/read";
import { elementChildren, pathOf, rawOf, type ContainerNode, type ElementPart } from "../scene/model";
import { doc, HEAD } from "../scene/test-support";
import type { Bounds } from "../scene/geometry";
import { boundsOf, nodeOf } from "./arrange";
import { copySvg, looksLikeSvg, pasteFrame, planPaste, readPaste, type PastePlan, type PasteSource } from "./clipboard";
import { destinationIn, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";

const NEW_ID = /[or][0-9a-z]{8}/g;

/// Il testo con ogni id della forma degli id nuovi uguale.
const anonymous = (text: string): string => text.replace(NEW_ID, "ID");

/// La selezione di `keys` di `opened`, copiata: `bounds` è il riquadro, o
/// quello degli oggetti che l'indice conosce.
function copy(opened: Opened, keys: readonly string[], bounds?: Bounds): string {
  const units = keys.map((key) => opened.index.get(key)).filter((unit) => unit !== null);
  const paths = keys.map((key) => pathOf(node(opened, key)));
  const out = copySvg({ text: opened.engine.text, paths, bounds: bounds ?? boundsOf(units)! });
  if (out === null) throw new Error("niente da copiare");
  return out;
}

/// Il piano dell'incolla di `text` nel primo livello di `opened`, spostato di
/// `delta`, e le parti fatte che ha reso.
function plan(
  opened: Opened,
  text: string,
  file: string | null = null,
  delta: readonly [number, number] = [0, 0],
  href: (value: string) => string | null = () => null,
): { plan: PastePlan; steps: number[] } {
  const source = readPaste(text, file);
  if (typeof source === "string") throw new Error(`non si incolla: ${source}`);
  const ids = new NewIds((id) => opened.engine.holder(id) !== null);
  const layer = opened.index.layers[0]!;
  const model = opened.engine.model!;
  const target = {
    model,
    container: nodeOf(model, layer) as ContainerNode,
    to: destinationIn(layer, ids)!,
    ids,
    delta: [delta[0], delta[1]] as const,
    href,
  };
  const run = planPaste(source, target);
  const steps: number[] = [];
  for (;;) {
    const next = run.next();
    if (next.done === true) return { plan: next.value, steps };
    steps.push(next.value);
  }
}

/// Incolla `text` nel primo livello di `opened`, in un `batch` solo, e
/// verifica che un annulla riporti il testo di prima.
function paste(
  opened: Opened,
  text: string,
  file: string | null = null,
  delta: readonly [number, number] = [0, 0],
  href?: (value: string) => string | null,
): PastePlan {
  const { plan: out } = plan(opened, text, file, delta, href);
  const before = opened.engine.text;
  const op: Op = { op: "batch", ops: out.ops };
  const outcome = opened.engine.apply(op);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.reason} (${outcome.detail})`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(op).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return out;
}

/// L'elemento di id `id`.
function node(opened: Opened, id: string): ElementPart {
  const found = opened.engine.holder(id);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  return found;
}

/// Il testo dei figli del livello `l1`.
const layerChildren = (opened: Opened): string[] => elementChildren(node(opened, "l1") as ContainerNode).map(rawOf);

/// Un documento FubDraw di prova: una sfumatura nella `defs` della radice, e
/// nel livello un oggetto che la usa, un gruppo con dentro una forma e un
/// testo, e un tracciato.
const SOURCE = doc(
  [
    "",
    "  <defs>",
    '    <linearGradient id="og1111111"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
    "  </defs>",
    `  ${LAYER}`,
    '    <rect id="oaaaaaaaa" x="10" y="10" width="20" height="20" fill="url(#og1111111)"/>',
    '    <g id="obbbbbbbb">',
    "      <title>Casa</title>",
    '      <circle id="occcccccc" cx="50" cy="50" r="5" fill="#ff0000"/>',
    '      <text id="odddddddd" x="40" y="70" font-size="8">Ciao <tspan font-weight="bold">mondo</tspan></text>',
    "    </g>",
    '    <path id="oeeeeeeee" d="M 60 10 L 90 40" stroke="#000000" stroke-width="2"/>',
    "  </g>",
    "",
  ].join("\n"),
);

/// Un disegno che riceve: un livello con un oggetto.
const TARGET = doc(`\n  ${LAYER}\n    <rect id="ozzzzzzzz" x="0" y="0" width="5" height="5"/>\n  </g>\n`);

describe("copySvg", () => {
  it("scrive un SVG completo, col riquadro della selezione e ciò a cui rimanda", () => {
    const svg = copy(open(SOURCE), ["oaaaaaaaa", "oeeeeeeee"], { min: [10, 9], max: [91, 41] });
    expect(svg).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1" viewBox="10 9 81 32" width="81" height="32">',
        "  <defs>",
        '    <linearGradient id="og1111111"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
        "  </defs>",
        '  <rect id="oaaaaaaaa" x="10" y="10" width="20" height="20" fill="url(#og1111111)"/>',
        '  <path id="oeeeeeeee" d="M 60 10 L 90 40" stroke="#000000" stroke-width="2"/>',
        "</svg>",
        "",
      ].join("\n"),
    );
  });

  it("porta su di sé la trasformazione e lo stile che ereditava", () => {
    const opened = open(
      doc(`${LAYER}<g id="og0000000" transform="translate(10 0)" fill="#00ff00" stroke-width="3"><rect id="or0000000" x="0" y="0" width="10" height="10"/></g></g>`),
    );
    const svg = copy(opened, ["or0000000"]);
    expect(svg).toContain('<rect id="or0000000" x="0" y="0" width="10" height="10" fill="#00ff00" stroke-width="3" transform="matrix(1 0 0 1 10 0)"/>');
  });

  it("scrive la misura nell'unità del disegno", () => {
    const opened = open(
      doc(`${LAYER}<rect id="oaaaaaaaa" x="10" y="10" width="20" height="5"/></g>`).replace('viewBox="0 0 100 100"', 'width="200mm" height="100mm" viewBox="0 0 100 50"'),
    );
    expect(copy(opened, ["oaaaaaaaa"])).toContain('viewBox="10 10 20 5" width="40mm" height="10mm"');
  });

  it("non copia niente se non c'è niente", () => {
    expect(copySvg({ text: SOURCE, paths: [[9]], bounds: { min: [0, 0], max: [1, 1] } })).toBeNull();
  });
});

describe("un giro di copia e incolla", () => {
  it("fra due disegni conserva gli elementi byte per byte, id a parte", () => {
    const source = open(SOURCE);
    const keys = ["oaaaaaaaa", "obbbbbbbb", "oeeeeeeee"];
    const svg = copy(source, keys);
    const target = open(TARGET);
    const out = paste(target, svg);
    expect(out.keys).toHaveLength(3);
    const pasted = layerChildren(target);
    expect(pasted.slice(1).map(anonymous)).toEqual(keys.map((key) => anonymous(rawOf(node(source, key)))));
    // La sfumatura va prima, nella `defs` del disegno, che nasce; gli id sono
    // nuovi, e il riferimento segue il suo.
    const [gradient] = elementChildren(node(target, "fub-defs") as ContainerNode);
    expect(gradient!.facts.id).toMatch(/^r[0-9a-z]{8}$/);
    expect(pasted[1]).toContain(`fill="url(#${gradient!.facts.id!})"`);
    for (const key of keys) expect(target.engine.holder(key)).toBeNull();
    expect(out.keys.map((key) => rawOf(node(target, key)))).toEqual(pasted.slice(1));
    // E il testo intero resta come lo scriverebbe il disegno.
    expect(anonymous(target.engine.text)).toBe(
      anonymous(
        doc(
          [
            "",
            '  <defs id="fub-defs">',
            '    <linearGradient id="og1111111"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
            "  </defs>",
            `  ${LAYER}`,
            '    <rect id="ozzzzzzzz" x="0" y="0" width="5" height="5"/>',
            '    <rect id="oaaaaaaaa" x="10" y="10" width="20" height="20" fill="url(#og1111111)"/>',
            '    <g id="obbbbbbbb">',
            "      <title>Casa</title>",
            '      <circle id="occcccccc" cx="50" cy="50" r="5" fill="#ff0000"/>',
            '      <text id="odddddddd" x="40" y="70" font-size="8">Ciao <tspan font-weight="bold">mondo</tspan></text>',
            "    </g>",
            '    <path id="oeeeeeeee" d="M 60 10 L 90 40" stroke="#000000" stroke-width="2"/>',
            "  </g>",
            "",
          ].join("\n"),
        ),
      ),
    );
  });

  it("nello stesso disegno rientra uguale, accanto agli originali", () => {
    const opened = open(SOURCE);
    const svg = copy(opened, ["obbbbbbbb"]);
    const out = paste(opened, svg);
    expect(out.keys).toHaveLength(1);
    expect(anonymous(rawOf(node(opened, out.keys[0]!)))).toBe(anonymous(rawOf(node(opened, "obbbbbbbb"))));
  });

  it("un livello diventa un gruppo, col suo nome per titolo", () => {
    const source = open(SOURCE);
    const layer = source.index.layers[0]!;
    const svg = copySvg({ text: source.engine.text, paths: [layer.path], bounds: source.extent()! })!;
    const target = open(TARGET);
    const out = paste(target, svg);
    const group = rawOf(node(target, out.keys[0]!));
    expect(anonymous(group).split("\n").slice(0, 3)).toEqual(['<g id="ID">', "      <title>Livello 1</title>", '      <rect id="ID" x="10" y="10" width="20" height="20" fill="url(#ID)"/>']);
    expect(group).not.toContain("fub:layer");
  });

  it("in un livello trasformato compensa la sua trasformazione", () => {
    const svg = copy(open(SOURCE), ["oaaaaaaaa", "oeeeeeeee"]);
    const target = open(TARGET.replace(LAYER, '<g id="l1" fub:layer="Livello 1" transform="translate(100 0)">'));
    const out = paste(target, svg);
    const [rect, path] = out.keys.map((key) => rawOf(node(target, key)));
    // Tutti e due la prendono come la prenderebbe un `set`.
    expect(anonymous(rect!)).toBe('<rect id="ID" x="10" y="10" width="20" height="20" fill="url(#ID)" transform="matrix(1 0 0 1 -100 0)"/>');
    expect(anonymous(path!)).toBe('<path id="ID" d="M 60 10 L 90 40" stroke="#000000" stroke-width="2" transform="matrix(1 0 0 1 -100 0)"/>');
  });

  it("dove il livello passa uno stile, chi entra scrive il valore di partenza", () => {
    const svg = copy(open(SOURCE), ["oeeeeeeee"]);
    const target = open(TARGET.replace(LAYER, '<g id="l1" fub:layer="Livello 1" fill="#ff0000" stroke-linecap="round">'));
    const out = paste(target, svg);
    expect(anonymous(rawOf(node(target, out.keys[0]!)))).toBe('<path id="ID" d="M 60 10 L 90 40" fill="#000000" stroke="#000000" stroke-width="2" stroke-linecap="butt"/>');
  });

  it("fra unità diverse la misura vera resta", () => {
    const mm = open(doc(`${LAYER}<rect id="oaaaaaaaa" x="10" y="10" width="20" height="20"/></g>`).replace('viewBox="0 0 100 100"', 'width="100mm" height="100mm" viewBox="0 0 100 100"'));
    const svg = copy(mm, ["oaaaaaaaa"]);
    expect(svg).toContain('width="20mm" height="20mm"');
    const px = open(TARGET);
    const out = paste(px, svg);
    // Un millimetro è 96 / 25,4 pixel.
    expect(anonymous(rawOf(node(px, out.keys[0]!)))).toBe('<rect id="ID" x="10" y="10" width="20" height="20" transform="matrix(3.7795 0 0 3.7795 0 0)"/>');
    const back = open(doc(`${LAYER}</g>`).replace('viewBox="0 0 100 100"', 'width="10cm" height="10cm" viewBox="0 0 100 100"'));
    const again = paste(back, svg);
    expect(anonymous(rawOf(node(back, again.keys[0]!)))).toBe('<rect id="ID" x="10" y="10" width="20" height="20"/>');
  });

  it("le immagini e i collegamenti del vault cambiano riferimento, gli altri restano", () => {
    const source = open(
      doc(
        `${LAYER}<image id="oiiiiiiii" href="foto.png" x="0" y="0" width="10" height="10"/>` +
          '<a id="oaaaaaaaa" href="Note/Pioggia.md#Nuvole"><rect id="orrrrrrrr" x="20" y="0" width="5" height="5"/></a>' +
          '<a id="obbbbbbbb" href="https://example.org"><rect id="ossssssss" x="30" y="0" width="5" height="5"/></a></g>',
      ),
    );
    const svg = copy(source, ["oiiiiiiii", "oaaaaaaaa", "obbbbbbbb"]);
    const seen: string[] = [];
    const target = open(TARGET);
    const out = paste(target, svg, null, [0, 0], (value) => {
      seen.push(value);
      return `../${value}`;
    });
    expect(seen).toEqual(["foto.png", "Note/Pioggia.md#Nuvole"]);
    expect(out.keys.map((key) => anonymous(rawOf(node(target, key))))).toEqual([
      '<image id="ID" href="../foto.png" x="0" y="0" width="10" height="10"/>',
      '<a id="ID" href="../Note/Pioggia.md#Nuvole"><rect id="ID" x="20" y="0" width="5" height="5"/></a>',
      '<a id="ID" href="https://example.org"><rect id="ID" x="30" y="0" width="5" height="5"/></a>',
    ]);
  });

  it("spostato di `delta`, e il riquadro segue", () => {
    const svg = copy(open(SOURCE), ["oeeeeeeee"]);
    const target = open(TARGET);
    const source = readPaste(svg) as PasteSource;
    expect(pasteFrame(source, target.engine.model!)).toEqual({ min: [59, 9], max: [91, 41] });
    const out = paste(target, svg, null, [5, -9]);
    expect(out.bounds).toEqual({ min: [64, 0], max: [96, 32] });
    expect(anonymous(rawOf(node(target, out.keys[0]!)))).toBe('<path id="ID" d="M 60 10 L 90 40" stroke="#000000" stroke-width="2" transform="matrix(1 0 0 1 5 -9)"/>');
  });
});

describe("un SVG di un altro programma", () => {
  const INKSCAPE = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="20mm" height="10mm" viewBox="0 0 20 10" fill="#336699">',
    '  <sodipodi:namedview id="nv" pagecolor="#ffffff"/>',
    "  <defs>",
    '    <linearGradient id="grad"><stop offset="0" stop-color="#000000"/></linearGradient>',
    "  </defs>",
    "  <style>.a { fill: url(#grad); } svg { stroke: none; }</style>",
    '  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">',
    '    <circle cx="5" cy="5" r="4"/>',
    '    <rect class="a" x="10" y="0" width="10" height="10"/>',
    "  </g>",
    "</svg>",
    "",
  ].join("\n");

  it("entra in un gruppo alla sua misura, col nome del file, i suoi fogli chiusi dentro", () => {
    const target = open(doc(`\n  ${LAYER}\n  </g>\n`).replace('viewBox="0 0 100 100"', 'width="100mm" height="100mm" viewBox="0 0 100 100"'));
    const out = paste(target, INKSCAPE, "/home/fabio/Logo.svg");
    expect(out.keys).toHaveLength(1);
    const [group] = out.keys;
    const text = rawOf(node(target, group!));
    const ids = [...text.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!);
    expect(ids).toHaveLength(4);
    const [, gradient, layer, circle] = ids;
    expect(text).toBe(
      [
        `<g id="${group}" fill="#336699" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">`,
        "      <title>Logo</title>",
        "      <defs>",
        `    <linearGradient id="${gradient}"><stop offset="0" stop-color="#000000"/></linearGradient>`,
        "  </defs>",
        `      <style>#${group} .a { fill: url(#${gradient}); } #${group} { stroke: none; }</style>`,
        `      <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="${layer}">`,
        `        <circle id="${circle}" cx="5" cy="5" r="4"/>`,
        '        <rect class="a" x="10" y="0" width="10" height="10"/>',
        "      </g>",
        "    </g>",
      ].join("\n"),
    );
    expect(text).not.toContain("namedview");
  });

  it("alla sua misura anche dove le unità sono pixel, coi margini del viewBox", () => {
    const target = open(TARGET);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    const out = paste(target, svg);
    expect(out.bounds).toEqual({ min: [0, 0], max: [200, 100] });
    expect(anonymous(rawOf(node(target, out.keys[0]!)))).toBe('<g id="ID" transform="matrix(10 0 0 10 50 0)"><rect id="ID" width="10" height="10"/></g>');
  });

  it("gli attributi della radice che un gruppo non ammette vanno su un gruppo dentro, che chiude i fogli", () => {
    const target = open(TARGET);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" id="art" class="logo" style="enable-background:new" width="10" height="10"><title>Arte</title><style>svg .x { fill: red }</style><use href="#art"/><rect class="x" width="1" height="1"/></svg>';
    const out = paste(target, svg);
    const text = rawOf(node(target, out.keys[0]!));
    const [group, inner] = [...text.matchAll(/<g id="([^"]+)"/g)].map((match) => match[1]!);
    expect(text).toBe(
      `<g id="${group}">\n      <title>Arte</title>\n      <g id="${inner}" class="logo"><title>Arte</title><style>#${inner} .x { fill: red }</style><use href="#${inner}"/><rect class="x" width="1" height="1"/></g>\n    </g>`,
    );
  });

  it("con uno script entra con S005 e non esegue niente", () => {
    const target = open(TARGET);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" onclick="alert(3)"/></svg>';
    const out = paste(target, svg);
    expect(out.keys).toHaveLength(1);
    const diagnostics = readScene(target.engine.text).diagnostics.filter((d) => d.code === "S005");
    expect(diagnostics.map((d) => d.detail)).toEqual(["onload", "script", "onclick"]);
  });

  it("le entità del DOCTYPE si sostituiscono col loro testo", () => {
    const target = open(TARGET);
    // Come scrive Illustrator: anche il namespace è un'entità.
    const svg = [
      '<!DOCTYPE svg [<!ENTITY ns_svg "http://www.w3.org/2000/svg"><!ENTITY c "#ff0000"><!ENTITY t "A > B">]>',
      '<svg xmlns="&ns_svg;" width="10" height="10"><rect width="10" height="10" fill="&c;"/><text x="0" y="5"><tspan x="0" dy="0">&t;</tspan></text></svg>',
    ].join("\n");
    const out = paste(target, svg);
    expect(anonymous(rawOf(node(target, out.keys[0]!)))).toBe('<g id="ID"><rect id="ID" width="10" height="10" fill="#ff0000"/><text id="ID" x="0" y="5"><tspan x="0" dy="0">A &gt; B</tspan></text></g>');
  });
});

describe("le risorse negli appunti", () => {
  const GRADIENT = '<linearGradient id="og1111111"><stop offset="0" stop-color="#ffffff"/></linearGradient>';

  it("copia la risorsa di un colore ereditato", () => {
    const opened = open(doc(`<defs>${GRADIENT}</defs>${LAYER}<g id="og0000000" fill="url(#og1111111)"><rect id="or0000000" x="0" y="0" width="10" height="10"/></g></g>`));
    const svg = copy(opened, ["or0000000"]);
    expect(svg).toContain(`<defs>\n    ${GRADIENT}\n  </defs>`);
    expect(svg).toContain('<rect id="or0000000" x="0" y="0" width="10" height="10" fill="url(#og1111111)"/>');
  });

  it("nello stesso disegno una risorsa che non è privata resta la stessa", () => {
    const opened = open(SOURCE);
    const out = paste(opened, copy(opened, ["oaaaaaaaa"]));
    expect(rawOf(node(opened, out.keys[0]!))).toContain('fill="url(#og1111111)"');
    expect(opened.engine.text.match(/<linearGradient/g)).toHaveLength(1);
  });

  it("una risorsa privata ha la sua copia, una sola per chi la usa", () => {
    const opened = open(
      doc(
        `\n  <defs id="fub-defs">\n    <linearGradient id="rgggggggg" fub:role="private"><stop offset="0" stop-color="#ffffff"/></linearGradient>\n  </defs>\n  ${LAYER}\n` +
          '    <rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" fill="url(#rgggggggg)"/>\n' +
          '    <rect id="obbbbbbbb" x="10" y="0" width="5" height="5" fill="none" stroke="url(#rgggggggg)"/>\n  </g>\n',
      ),
    );
    const out = paste(opened, copy(opened, ["oaaaaaaaa", "obbbbbbbb"]));
    const resources = elementChildren(node(opened, "fub-defs") as ContainerNode);
    expect(resources.map((resource) => anonymous(rawOf(resource)))).toEqual([
      '<linearGradient id="ID" fub:role="private"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
      '<linearGradient id="ID" fub:role="private"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
    ]);
    const copied = resources[1]!.facts.id!;
    expect(copied).not.toBe("rgggggggg");
    expect(out.keys.map((key) => rawOf(node(opened, key)).includes(`url(#${copied})`))).toEqual([true, true]);
    // La copia va in fondo alla `defs`, col rientro dei suoi figli.
    expect(opened.engine.text).toContain(`</linearGradient>\n    <linearGradient id="${copied}"`);
  });

  it("un testo su tracciato porta il suo tracciato; se è privato, la copia ha il suo", () => {
    const opened = open(
      doc(
        '<defs id="fub-defs"><path id="rpppppppp" fub:role="private" d="M 0 50 L 100 50"/></defs>' +
          `${LAYER}<text id="otttttttt"><textPath startOffset="10" href="#rpppppppp">Sul colle</textPath></text></g>`,
      ),
    );
    const svg = copy(opened, ["otttttttt"]);
    expect(svg).toContain('<path id="rpppppppp" fub:role="private" d="M 0 50 L 100 50"/>');
    const out = paste(opened, svg);
    const resources = elementChildren(node(opened, "fub-defs") as ContainerNode);
    expect(resources).toHaveLength(2);
    const copied = resources[1]!.facts.id!;
    expect(rawOf(resources[1]!)).toBe(`<path id="${copied}" fub:role="private" d="M 0 50 L 100 50"/>`);
    expect(rawOf(node(opened, out.keys[0]!))).toContain(`<textPath startOffset="10" href="#${copied}">Sul colle</textPath>`);
    // In un altro disegno il tracciato entra con chi lo segue.
    const target = open(doc(`<defs id="fub-defs"/>${LAYER}</g>`));
    const there = paste(target, svg);
    const [path] = elementChildren(node(target, "fub-defs") as ContainerNode);
    expect(rawOf(node(target, there.keys[0]!))).toContain(`href="#${path!.facts.id!}"`);
  });

  it("fra due disegni una risorsa diversa con lo stesso id entra con un id nuovo", () => {
    const svg = copy(open(SOURCE), ["oaaaaaaaa"]);
    const other = GRADIENT.replace("#ffffff", "#000000");
    const target = open(doc(`<defs id="fub-defs">${other}</defs>${LAYER}</g>`));
    const out = paste(target, svg);
    const resources = elementChildren(node(target, "fub-defs") as ContainerNode);
    expect(resources.map(rawOf)).toEqual([other, `<linearGradient id="${resources[1]!.facts.id!}"><stop offset="0" stop-color="#ffffff"/></linearGradient>`]);
    expect(rawOf(node(target, out.keys[0]!))).toContain(`fill="url(#${resources[1]!.facts.id!})"`);
    // La stessa, scritta in un altro modo, resta quella del disegno.
    const same = open(doc(`<defs id="fub-defs">\n  ${GRADIENT.replace("><", ">\n    <")}</defs>${LAYER}</g>`));
    const again = paste(same, svg);
    expect(elementChildren(node(same, "fub-defs") as ContainerNode)).toHaveLength(1);
    expect(rawOf(node(same, again.keys[0]!))).toContain('fill="url(#og1111111)"');
  });

  it("da un altro programma porta le risorse usate, prima di ciò che le usa, e lascia le altre", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">',
      "  <defs>",
      '    <pattern id="p" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="2" height="2" fill="url(#g)"/></pattern>',
      '    <linearGradient id="h" xlink:href="#g" x2="1"/>',
      '    <linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient>',
      '    <linearGradient id="unused"><stop offset="1" stop-color="#0000ff"/></linearGradient>',
      "  </defs>",
      '  <rect x="0" y="0" width="10" height="10" fill="url(#p)"/>',
      '  <rect x="0" y="0" width="10" height="10" fill="url(#h)"/>',
      "</svg>",
    ].join("\n");
    const target = open(doc(`\n  <defs id="mine">\n    <title>Le mie risorse</title>\n  </defs>\n  ${LAYER}\n  </g>\n`));
    const out = paste(target, svg);
    const home = node(target, "mine") as ContainerNode;
    const moved = elementChildren(home).slice(1);
    const id = (index: number): string => moved[index]!.facts.id!;
    // La sfumatura prima del motivo e della sfumatura estranea che la usano.
    expect(moved.map((part) => part.details?.role ?? null)).toEqual(["resource", "resource", null]);
    expect(moved.map(rawOf)).toEqual([
      `<linearGradient id="${id(0)}"><stop offset="0" stop-color="#ff0000"/></linearGradient>`,
      `<pattern id="${id(1)}" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="2" height="2" fill="url(#${id(0)})"/></pattern>`,
      `<linearGradient id="${id(2)}" xlink:href="#${id(0)}" x2="1"/>`,
    ]);
    expect(target.engine.holder("fub-defs")).toBeNull();
    // Il gruppo non ha più la `defs`, e chi usa una risorsa del disegno è
    // modificabile; chi usa la sfumatura estranea no.
    const group = node(target, out.keys[0]!) as ContainerNode;
    expect(rawOf(group)).not.toContain("defs");
    const [first, second] = elementChildren(group);
    expect(first!.details?.role).toBe("rect");
    expect(rawOf(first!)).toContain(`fill="url(#${id(1)})"`);
    expect(second!.details).toBeNull();
    expect(rawOf(second!)).toContain(`fill="url(#${id(2)})"`);
  });

  it("con un foglio di stile le risorse restano dove sono", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>rect { stroke: #000000; }</style>' +
      '<defs><linearGradient id="a"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>' +
      '<rect x="0" y="0" width="10" height="10" fill="url(#a)"/></svg>';
    const target = open(TARGET);
    const out = paste(target, svg);
    expect(target.engine.holder("fub-defs")).toBeNull();
    expect(rawOf(node(target, out.keys[0]!))).toContain("<linearGradient");
  });
});

describe("readPaste", () => {
  it("dice perché un testo non si incolla", () => {
    expect(readPaste("<svg")).toBe("malformed");
    expect(readPaste('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toBe("not-svg");
    expect(readPaste('<svg xmlns="http://www.w3.org/2000/svg"><defs/><title>Vuoto</title></svg>')).toBe("empty");
    expect(readPaste('<!DOCTYPE svg [<!ENTITY m "<g/>">]><svg xmlns="http://www.w3.org/2000/svg">&m;</svg>')).toBe("entities");
    expect(readPaste(`<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(MAX_EDIT_BYTES)}</svg>`)).toBe("too-large");
  });

  it("di un SVG di FubDraw lascia fuori la carta, il titolo e ciò che è del documento", () => {
    const svg = doc('<title>Disegno</title><rect id="fub-paper" fub:role="paper" width="100" height="100"/><metadata/><rect id="oaaaaaaaa" width="1" height="1"/>');
    const source = readPaste(svg, "C:\\disegni\\Prova.SVG") as PasteSource;
    expect(source.fubdraw).toBe(true);
    expect(source.pieces).toHaveLength(1);
    expect(source.dropped.size).toBe(3);
    expect(source.name).toBe("Prova");
  });

  it("un SVG di FubDraw coi suoi fogli entra in un gruppo, e i livelli diventano gruppi", () => {
    const svg = doc(`<title>Disegno</title><style>.a { fill: red }</style>${LAYER}<rect class="a" id="oaaaaaaaa" width="1" height="1"/></g>`);
    const target = open(TARGET);
    const out = paste(target, svg);
    const text = rawOf(node(target, out.keys[0]!));
    const group = out.keys[0]!;
    expect(anonymous(text)).toBe(
      anonymous(`<g id="${group}">\n      <title>Disegno</title><style>#${group} .a { fill: red }</style><g id="ID">\n      <title>Livello 1</title><rect class="a" id="ID" width="1" height="1"/></g></g>`),
    );
  });
});

describe("incollare molto", () => {
  it("10 MiB rendono l'avanzamento e sono un passo solo", { timeout: 60_000 }, () => {
    // Un tracciato di 40 lati: 10 MiB sono circa 25 000 elementi, dentro il
    // limite del disegno.
    const d = Array.from({ length: 40 }, (_, i) => `L ${i * 10} ${(i % 2) * 10}`).join(" ");
    const row = `<path d="M 0 0 ${d}" stroke="#000000"/>`;
    const count = Math.ceil((10 * 1024 * 1024) / (row.length + 3));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n${`  ${row}\n`.repeat(count)}</svg>\n`;
    expect(svg.length).toBeGreaterThan(10 * 1024 * 1024);
    const target = open(TARGET);
    const { plan: out, steps } = plan(target, svg);
    expect(steps.length).toBeGreaterThan(50);
    expect(steps.length).toBeLessThanOrEqual(100);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    expect(steps[steps.length - 1]!).toBeLessThanOrEqual(1);
    expect(out.ops.length).toBeGreaterThan(3);
    for (const op of out.ops) expect(JSON.stringify(op).length).toBeLessThanOrEqual(MAX_OP_BYTES);
    const before = target.engine.text;
    const outcome = target.engine.apply({ op: "batch", ops: out.ops });
    expect(outcome.outcome).toBe("applied");
    if (outcome.outcome !== "applied") return;
    const group = node(target, out.keys[0]!) as ContainerNode;
    expect(elementChildren(group)).toHaveLength(count);
    expect(target.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(target.engine.text).toBe(before);
  });
});

describe("incollare un gruppo grande", () => {
  it("si divide in più operazioni, e un gruppo bloccato si blocca dopo i figli", { timeout: 60_000 }, () => {
    // Circa 5 MiB: più di quanto sta in un `add`.
    const d = Array.from({ length: 30 }, (_, i) => `L ${i * 10} ${(i % 2) * 10}`).join(" ");
    const count = 18_000;
    const paths = Array.from({ length: count }, (_, i) => `\n    <path id="o${i.toString(36).padStart(8, "0")}" d="M 0 0 ${d}"/>`).join("");
    const svg = doc(`\n  <g id="ogggggggg" fub:locked="true">${paths}\n  </g>\n`);
    const target = open(TARGET);
    const out = paste(target, svg);
    expect(out.ops.length).toBeGreaterThan(3);
    for (const op of out.ops) expect(JSON.stringify(op).length).toBeLessThanOrEqual(MAX_OP_BYTES);
    expect(out.ops[out.ops.length - 1]).toEqual({ op: "set", id: out.keys[0], attrs: { "fub:locked": "true" } });
    const group = node(target, out.keys[0]!) as ContainerNode;
    expect(elementChildren(group)).toHaveLength(count);
    expect(anonymous(group.head)).toBe('<g id="ID" fub:locked="true">');
  });
});

describe("looksLikeSvg", () => {
  it("riconosce l'inizio di un SVG", () => {
    expect(looksLikeSvg('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true);
    expect(looksLikeSvg('\uFEFF  <svg:svg xmlns:svg="http://www.w3.org/2000/svg">')).toBe(true);
    expect(looksLikeSvg(`${HEAD}</svg>`)).toBe(true);
    expect(looksLikeSvg("un <svg> nel testo")).toBe(false);
    expect(looksLikeSvg("<html><body></body></html>")).toBe(false);
    expect(looksLikeSvg("")).toBe(false);
  });
});
