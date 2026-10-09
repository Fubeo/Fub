// Gli appunti: la selezione copiata come SVG, e un SVG incollato come
// operazioni che il motore accetta in un passo solo. Un giro fra due disegni
// riporta gli stessi byte, id a parte.

import { describe, expect, it } from "vitest";
import { MAX_OP_BYTES, type Op } from "../scene/ops";
import { MAX_EDIT_BYTES, readScene } from "../scene/read";
import { elementChildren, pathOf, rawOf, type ContainerNode, type ElementPart } from "../scene/model";
import { doc, HEAD } from "../scene/test-support";
import type { Bounds } from "../scene/geometry";
import { boundsOf, duplicateOps, nodeOf } from "./arrange";
import { copySvg, looksLikeSvg, pasteFrame, planPaste, readPaste, type PastePlan, type PasteSource } from "./clipboard";
import { destinationIn, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";
import { applied, attrOf, BLUE, CUSTOM, DEFS, ids as newIds, followed, MARKER, markersIn, RED, tipOf } from "./tip-support";

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

  it("un campione resta quello del disegno con lo stesso id, o con lo stesso nome e colore; se no arriva con un nome libero", () => {
    const swatch = (id: string, name: string, color: string): string =>
      `<linearGradient id="${id}" fub:role="swatch" fub:name="${name}" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;
    const source = open(
      doc(
        `<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#0072b2")}${swatch("rs2s2s2s2", "Vermiglio", "#d55e00")}</defs>` +
          `${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" fill="url(#rs1s1s1s1) #0072b2" stroke="url(#rs2s2s2s2) #d55e00"/></g>`,
      ),
    );
    const svg = copy(source, ["oaaaaaaaa"]);
    const uses = 'fill="url(#rs1s1s1s1) #0072b2" stroke="url(#rs2s2s2s2) #d55e00"';
    // Nello stesso disegno restano gli stessi.
    const same = paste(source, svg);
    expect(source.engine.text.match(/<linearGradient/g)).toHaveLength(2);
    expect(rawOf(node(source, same.keys[0]!))).toContain(uses);
    // Con lo stesso id resta quello del disegno, col suo nome e il suo
    // colore, che chi lo usa prende come ripiego.
    const recolored = open(doc(`<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#56b4e9")}${swatch("rs2s2s2s2", "Arancio", "#d55e00")}</defs>${LAYER}</g>`));
    const kept = paste(recolored, svg);
    expect(recolored.engine.text.match(/<linearGradient/g)).toHaveLength(2);
    expect(rawOf(node(recolored, kept.keys[0]!))).toContain(uses.replace("#0072b2", "#56b4e9"));
    // In un altro disegno vale il campione con lo stesso nome, senza
    // maiuscole, e lo stesso colore; con lo stesso nome e un altro colore
    // arriva il suo, col primo nome libero.
    const other = open(doc(`<defs id="fub-defs">${swatch("rt1t1t1t1", "blu MARE", "#0072b2")}${swatch("rt2t2t2t2", "Vermiglio", "#e69f00")}</defs>${LAYER}</g>`));
    const there = paste(other, svg);
    const resources = elementChildren(node(other, "fub-defs") as ContainerNode);
    expect(resources).toHaveLength(3);
    const arrived = resources[2]!.facts.id!;
    expect(rawOf(resources[2]!)).toBe(swatch(arrived, "Vermiglio 2", "#d55e00"));
    expect(rawOf(node(other, there.keys[0]!))).toContain(`fill="url(#rt1t1t1t1) #0072b2" stroke="url(#${arrived}) #d55e00"`);
  });

  it("un campione col nome di un colore arriva con un altro nome, e due uguali diventano uno", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 20 10">',
      "  <defs>",
      '    <linearGradient id="a" fub:role="swatch" fub:name="#00ff00"><stop stop-color="#00ff00"/></linearGradient>',
      '    <linearGradient id="b" fub:role="swatch" fub:name="Prato"><stop stop-color="#00aa00"/></linearGradient>',
      '    <linearGradient id="c" fub:role="swatch" fub:name=" PRATO "><stop stop-color="#00AA00"/></linearGradient>',
      "  </defs>",
      '  <rect x="0" y="0" width="5" height="5" fill="url(#a) #00ff00"/>',
      '  <rect x="10" y="0" width="5" height="5" fill="url(#b) #00aa00" stroke="url(#c) #00aa00"/>',
      "</svg>",
    ].join("\n");
    const target = open(doc(`<defs id="fub-defs"/>${LAYER}</g>`));
    const out = paste(target, svg);
    const resources = elementChildren(node(target, "fub-defs") as ContainerNode);
    expect(resources.map((resource) => anonymous(rawOf(resource)))).toEqual([
      '<linearGradient id="ID" fub:role="swatch" fub:name="#00ff00 2"><stop stop-color="#00ff00"/></linearGradient>',
      '<linearGradient id="ID" fub:role="swatch" fub:name="Prato"><stop stop-color="#00aa00"/></linearGradient>',
    ]);
    const [green, meadow] = resources.map((resource) => resource.facts.id!);
    expect(rawOf(node(target, out.keys[0]!))).toContain(`fill="url(#${green}) #00ff00"`);
    expect(rawOf(node(target, out.keys[1]!))).toContain(`fill="url(#${meadow}) #00aa00" stroke="url(#${meadow}) #00aa00"`);
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

describe("gli stili negli appunti e nel duplica", () => {
  const BOX = (id: string, name = "Riquadro", fill = "#e69f00"): string =>
    `<polyline id="${id}" fub:role="style" fub:name="${name}" points="0,0 100,0 100,100" fill="${fill}" stroke="#000000" stroke-width="2"/>`;
  const TITLE = (id: string, name = "Titolo"): string => `<text id="${id}" fub:role="style" fub:name="${name}" fill="#1a1a1a" font-size="48" font-weight="600"/>`;
  const RECT = (id: string, style: string, extra = ""): string =>
    `<rect id="${id}" fub:style="${style}" x="0" y="0" width="5" height="5" fill="#e69f00" stroke="#000000" stroke-width="2"${extra}/>`;
  /// Il rettangolo `oaaaaaaaa` che segue «Riquadro», e lo stile «Titolo»
  /// che nessuno copiato segue.
  const SOURCE_STYLED = doc(`<defs id="fub-defs">${BOX("rbox00000")}${TITLE("rtitle000")}</defs>${LAYER}${RECT("oaaaaaaaa", "rbox00000")}</g>`);
  /// Gli stili del disegno, come sono scritti.
  const styles = (opened: Opened): string[] => elementChildren(node(opened, "fub-defs") as ContainerNode).map(rawOf);
  const follows = (opened: Opened, key: string): string | null => /fub:style="([^"]*)"/.exec(rawOf(node(opened, key)))?.[1] ?? null;

  it("la copia porta gli stili che gli oggetti seguono, e soltanto loro", () => {
    const svg = copy(open(SOURCE_STYLED), ["oaaaaaaaa"]);
    expect(svg).toContain(`<defs>\n    ${BOX("rbox00000")}\n  </defs>`);
    expect(svg).not.toContain("rtitle000");
    expect(svg).toContain(RECT("oaaaaaaaa", "rbox00000"));
  });

  it("nello stesso disegno chi entra segue lo stesso stile, e nessuno stile si duplica", () => {
    const opened = open(SOURCE_STYLED);
    const out = paste(opened, copy(opened, ["oaaaaaaaa"]));
    expect(follows(opened, out.keys[0]!)).toBe("rbox00000");
    expect(styles(opened)).toEqual([BOX("rbox00000"), TITLE("rtitle000")]);
  });

  it("in un altro disegno vale lo stile con lo stesso nome, tipo e aspetto; se no arriva, con un nome libero nel suo tipo", () => {
    const svg = copy(open(SOURCE_STYLED), ["oaaaaaaaa"]);
    // Senza stili, lo stile arriva col suo nome e un id nuovo.
    const bare = open(doc(`<defs id="fub-defs"/>${LAYER}</g>`));
    const first = paste(bare, svg).keys[0]!;
    expect(styles(bare).map(anonymous)).toEqual([BOX("ID")]);
    expect(follows(bare, first)).toBe(elementChildren(node(bare, "fub-defs") as ContainerNode)[0]!.facts.id);
    // Incollato di nuovo, è lo stesso.
    paste(bare, svg);
    expect(styles(bare)).toHaveLength(1);
    // Lo stesso nome, senza maiuscole, e lo stesso aspetto: quello del disegno.
    const same = open(doc(`<defs id="fub-defs">${BOX("rmine0000", "RIQUADRO")}</defs>${LAYER}</g>`));
    expect(follows(same, paste(same, svg).keys[0]!)).toBe("rmine0000");
    expect(styles(same)).toEqual([BOX("rmine0000", "RIQUADRO")]);
    // Lo stesso nome con un altro aspetto: arriva col primo nome libero;
    // uno stile di testo col suo nome non lo prende.
    const other = open(doc(`<defs id="fub-defs">${BOX("rmine0000", "Riquadro", "#56b4e9")}${TITLE("rtext0000", "Riquadro 2")}</defs>${LAYER}</g>`));
    const arrived = paste(other, svg).keys[0]!;
    expect(styles(other).map(anonymous)).toEqual([BOX("ID", "Riquadro", "#56b4e9"), TITLE("ID", "Riquadro 2"), BOX("ID", "Riquadro 2")]);
    expect(follows(other, arrived)).toBe(elementChildren(node(other, "fub-defs") as ContainerNode)[2]!.facts.id);
  });

  it("uno stile con una sfumatura privata la porta in copia, ma quello uguale del disegno non porta niente", () => {
    const gradient = (id: string): string =>
      `<linearGradient id="${id}" fub:role="private" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>`;
    const source = open(doc(`<defs id="fub-defs">${gradient("rgrad0000")}${BOX("rbox00000", "Alba", "url(#rgrad0000)")}</defs>${LAYER}${RECT("oaaaaaaaa", "rbox00000", ' fill-opacity="0.5"')}</g>`));
    const svg = copy(source, ["oaaaaaaaa"]);
    expect(svg).toContain(gradient("rgrad0000"));
    const bare = open(doc(`<defs id="fub-defs"/>${LAYER}</g>`));
    paste(bare, svg);
    const [copied, style] = elementChildren(node(bare, "fub-defs") as ContainerNode);
    expect(rawOf(copied!)).toBe(gradient(copied!.facts.id!));
    expect(rawOf(style!)).toBe(BOX(style!.facts.id!, "Alba", `url(#${copied!.facts.id!})`));
    // Lo stesso stile, con la sua sfumatura dal suo id: nessuna copia.
    const same = open(doc(`<defs id="fub-defs">${gradient("rmygrad00")}${BOX("rmine0000", "Alba", "url(#rmygrad00)")}</defs>${LAYER}</g>`));
    const key = paste(same, svg).keys[0]!;
    expect(follows(same, key)).toBe("rmine0000");
    expect(elementChildren(node(same, "fub-defs") as ContainerNode)).toHaveLength(2);
  });

  it("chi segue uno stile che non entra e che il disegno non ha lo lascia", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 20 10">',
      `  ${RECT("oaaaaaaaa", "rbox00000")}`,
      `  ${RECT("obbbbbbbb", "rmissing0")}`,
      "</svg>",
    ].join("\n");
    const opened = open(SOURCE_STYLED);
    const out = paste(opened, svg);
    expect(follows(opened, out.keys[0]!)).toBe("rbox00000");
    expect(follows(opened, out.keys[1]!)).toBeNull();
    expect(readScene(opened.engine.text).diagnostics.map((each) => each.code)).not.toContain("S018");
  });

  it("duplicare un oggetto lo fa seguire lo stesso stile", () => {
    const opened = open(SOURCE_STYLED);
    const made = duplicateOps(opened.engine.model!, [opened.index.get("oaaaaaaaa")!], 10, 10, newIds(opened))!;
    applied(opened, made.ops);
    expect(follows(opened, made.keys[0]!)).toBe("rbox00000");
    expect(styles(opened)).toEqual([BOX("rbox00000"), TITLE("rtitle000")]);
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

describe("le punte negli appunti e nel duplica", () => {
  const MS = (id: string, paint = RED): string => MARKER(id, "circle", "small", "start", paint);
  const ME = (id: string, paint = RED): string => MARKER(id, "triangle", "large", "end", paint);
  const START = "circle small start #d55e00";
  const END = "triangle large end #d55e00";
  const LINE = (id: string, start: string | null, end: string | null, extra = ""): string =>
    `<line id="${id}" x1="0" y1="0" x2="50" y2="0" stroke="${RED}" stroke-width="2"${start === null ? "" : ` marker-start="url(#${start})"`}${end === null ? "" : ` marker-end="url(#${end})"`}${extra}/>`;
  /// Un disegno con la linea `oaaaaaaaa` che ha le punte `rs0000001` e `re0000001`.
  const source = (): Opened => followed(doc(DEFS(MS("rs0000001"), ME("re0000001")) + LAYER + LINE("oaaaaaaaa", "rs0000001", "re0000001") + "</g>"));
  const empty = (): Opened => followed(doc(`<defs id="fub-defs"/>${LAYER}</g>`));
  const only = (opened: Opened): string => paste(opened, copy(source(), ["oaaaaaaaa"])).keys[0]!;

  it("copia la linea con le sue punte: i marcatori vanno con lei, una volta sola", () => {
    const svg = copy(source(), ["oaaaaaaaa"]);
    expect(svg).toContain('marker-start="url(#rs0000001)"');
    expect(svg).toContain('marker-end="url(#re0000001)"');
    expect(svg.match(/<marker /g)).toHaveLength(2);
    expect(svg).toContain('fub:role="shared"');
    expect(svg).toContain('fub:marker="circle small start"');
    // Una linea senza punte non porta marcatori.
    const bare = followed(doc(DEFS(MS("rs0000001")) + LAYER + LINE("oaaaaaaaa", null, null) + "</g>"));
    expect(copy(bare, ["oaaaaaaaa"])).not.toContain("<marker");
  });

  it("nello stesso disegno la copia nomina gli stessi marcatori, e nessuno si duplica", () => {
    const opened = source();
    const out = paste(opened, copy(opened, ["oaaaaaaaa"]));
    const key = out.keys[0]!;
    expect(attrOf(opened, key, "marker-start")).toBe("url(#rs0000001)");
    expect(attrOf(opened, key, "marker-end")).toBe("url(#re0000001)");
    expect([tipOf(opened, key, "start"), tipOf(opened, key, "end")]).toEqual([START, END]);
    expect(markersIn(opened)).toEqual(["rs0000001", "re0000001"]);
  });

  it("in un altro disegno le punte arrivano con la linea, e restano due marcatori", () => {
    const target = empty();
    const key = only(target);
    expect([tipOf(target, key, "start"), tipOf(target, key, "end")]).toEqual([START, END]);
    expect(markersIn(target)).toHaveLength(2);
    // Il disegno senza `defs` se ne fa una.
    const bare = followed(TARGET);
    const there = only(bare);
    expect([tipOf(bare, there, "start"), tipOf(bare, there, "end")]).toEqual([START, END]);
    expect(markersIn(bare)).toHaveLength(2);
  });

  it("incollata due volte nello stesso altro disegno, la linea non duplica i marcatori", () => {
    const target = empty();
    const svg = copy(source(), ["oaaaaaaaa"]);
    const first = paste(target, svg).keys[0]!;
    const second = paste(target, svg).keys[0]!;
    expect(second).not.toBe(first);
    expect(markersIn(target)).toHaveLength(2);
    expect(markersIn(target)).toEqual(expect.arrayContaining([attrOf(target, second, "marker-start")!.slice(5, -1), attrOf(target, second, "marker-end")!.slice(5, -1)]));
    expect([tipOf(target, second, "start"), tipOf(target, second, "end")]).toEqual([START, END]);
  });

  it("un marcatore uguale che il disegno ha già, con un altro id, è quello che la linea usa", () => {
    const target = followed(doc(DEFS(MS("rt0000001"), ME("rt0000002")) + LAYER + LINE("ozzzzzzzz", "rt0000001", "rt0000002") + "</g>"));
    const key = only(target);
    expect(attrOf(target, key, "marker-start")).toBe("url(#rt0000001)");
    expect(attrOf(target, key, "marker-end")).toBe("url(#rt0000002)");
    expect(markersIn(target)).toEqual(["rt0000001", "rt0000002"]);
  });

  it("una punta di un campione usa quella del campione uguale che il disegno ha con un altro id", () => {
    const SWATCH = (id: string): string =>
      `<linearGradient id="${id}" fub:role="swatch" fub:name="Rosso" gradientUnits="userSpaceOnUse"><stop stop-color="${RED}"/></linearGradient>`;
    const swatched = (swatch: string, marker: string, line: string, y: number): Opened => {
      const paint = `url(#${swatch}) ${RED}`;
      return followed(
        doc(
          DEFS(SWATCH(swatch), MARKER(marker, "triangle", "large", "end", paint)) +
            LAYER +
            `<line id="${line}" x1="0" y1="${y}" x2="50" y2="${y}" stroke="${paint}" stroke-width="2" marker-end="url(#${marker})"/></g>`,
        ),
      );
    };
    const target = swatched("rt2t2t2t2", "rm0000002", "ozzzzzzzz", 9);
    const key = paste(target, copy(swatched("rs1s1s1s1", "rm0000001", "oaaaaaaaa", 0), ["oaaaaaaaa"])).keys[0]!;
    expect(attrOf(target, key, "stroke")).toBe(`url(#rt2t2t2t2) ${RED}`);
    expect(attrOf(target, key, "marker-end")).toBe("url(#rm0000002)");
    expect(markersIn(target)).toEqual(["rm0000002"]);
  });

  it("uno solo dei due uguali, l'altro arriva", () => {
    const target = followed(doc(DEFS(MS("rt0000001")) + LAYER + LINE("ozzzzzzzz", "rt0000001", null) + "</g>"));
    const key = only(target);
    expect(attrOf(target, key, "marker-start")).toBe("url(#rt0000001)");
    const end = attrOf(target, key, "marker-end")!.slice(5, -1);
    expect(end).not.toBe("rt0000001");
    expect(markersIn(target)).toEqual(["rt0000001", end]);
    expect(tipOf(target, key, "end")).toBe(END);
  });

  it("un marcatore dello stesso aspetto ma di un altro colore, o di un'altra forma, arriva col suo", () => {
    const target = followed(doc(DEFS(MS("rt0000001", BLUE), MARKER("rt0000002", "square", "large", "end")) + LAYER + LINE("ozzzzzzzz", "rt0000001", "rt0000002", "") + "</g>"));
    const key = only(target);
    expect(markersIn(target)).toHaveLength(4);
    expect([tipOf(target, key, "start"), tipOf(target, key, "end")]).toEqual([START, END]);
  });

  it("con lo stesso id e un altro contenuto, il marcatore che arriva ha un id nuovo", () => {
    const target = followed(doc(DEFS(MARKER("rs0000001", "square", "large", "start")) + LAYER + LINE("ozzzzzzzz", "rs0000001", null) + "</g>"));
    const key = only(target);
    expect(attrOf(target, key, "marker-start")).not.toBe("url(#rs0000001)");
    expect(tipOf(target, "ozzzzzzzz", "start")).toBe("square large start #d55e00");
    expect([tipOf(target, key, "start"), tipOf(target, key, "end")]).toEqual([START, END]);
    expect(markersIn(target)).toHaveLength(3);
  });

  it("un marcatore che non è della raccolta viaggia come una risorsa qualunque", () => {
    const opened = followed(doc(DEFS(CUSTOM("rc0000001")) + LAYER + LINE("oaaaaaaaa", null, "rc0000001") + "</g>"));
    const svg = copy(opened, ["oaaaaaaaa"]);
    expect(svg).toContain("<marker ");
    // Nello stesso disegno resta il suo.
    const same = paste(opened, svg).keys[0]!;
    expect(attrOf(opened, same, "marker-end")).toBe("url(#rc0000001)");
    expect(markersIn(opened)).toEqual(["rc0000001"]);
    // In un altro arriva con la linea.
    const target = empty();
    const there = paste(target, svg).keys[0]!;
    expect(tipOf(target, there, "end")).toBe("custom");
    expect(markersIn(target)).toHaveLength(1);
  });

  it("marker-mid viaggia com'è", () => {
    const opened = followed(doc(DEFS(MS("rs0000001")) + LAYER + `<path id="oaaaaaaaa" d="M0 0 L25 0 L50 0" fill="none" stroke="${RED}" marker-mid="url(#rs0000001)"/></g>`));
    const key = paste(opened, copy(opened, ["oaaaaaaaa"])).keys[0]!;
    expect(attrOf(opened, key, "marker-mid")).toBe("url(#rs0000001)");
    expect(markersIn(opened)).toEqual(["rs0000001"]);
  });

  it("duplicare la linea ne copia le punte senza copiare i marcatori", () => {
    const opened = source();
    const made = duplicateOps(opened.engine.model!, [opened.index.get("oaaaaaaaa")!], 10, 10, newIds(opened));
    expect(made).not.toBeNull();
    const text = applied(opened, made!.ops);
    const key = made!.keys[0]!;
    expect(text).toContain(`<line id="${key}"`);
    expect(attrOf(opened, key, "marker-start")).toBe("url(#rs0000001)");
    expect(attrOf(opened, key, "marker-end")).toBe("url(#re0000001)");
    expect([tipOf(opened, key, "start"), tipOf(opened, key, "end")]).toEqual([START, END]);
    expect(markersIn(opened)).toEqual(["rs0000001", "re0000001"]);
    expect(JSON.stringify(made!.ops)).not.toContain("<marker");
  });

  it("duplicare un tracciato con un marcatore non della raccolta tiene il marcatore", () => {
    const opened = followed(doc(DEFS(CUSTOM("rc0000001")) + LAYER + LINE("oaaaaaaaa", "rc0000001", "rc0000001") + "</g>"));
    const made = duplicateOps(opened.engine.model!, [opened.index.get("oaaaaaaaa")!], 5, 0, newIds(opened))!;
    applied(opened, made.ops);
    expect(attrOf(opened, made.keys[0]!, "marker-end")).toBe("url(#rc0000001)");
    expect(markersIn(opened)).toEqual(["rc0000001"]);
  });
});

describe("i connettori negli appunti", () => {
  const ENDS = ' fub:from="oaaaaaaaa right" fub:to="obbbbbbbb left"';
  /// Un connettore dritto fra due rettangoli messi l'uno accanto all'altro.
  const CONNECTOR = (id: string, ends = ENDS): string =>
    `<path id="${id}" fub:shape="connector" fub:geom="straight 10 5 40 5"${ends} d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2"/>`;
  /// Un'etichetta del connettore `occcccccc`, a metà della linea.
  const LABEL = (id: string, along = "occcccccc 0.5000 4.00"): string =>
    `<text id="${id}" fub:along="${along}" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 25 1)"><tspan x="0" dy="0">sì</tspan></text>`;
  const RECTS = '<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10"/><rect id="obbbbbbbb" x="40" y="0" width="10" height="10"/>';
  const ALL = ["oaaaaaaaa", "obbbbbbbb", "occcccccc", "odddddddd"];
  const source = (ends?: string, along?: string): Opened => open(doc(`${LAYER}${RECTS}${CONNECTOR("occcccccc", ends)}${LABEL("odddddddd", along)}</g>`));
  /// Un disegno che riceve, con un oggetto che non c'entra.
  const target = (): Opened => open(TARGET);

  it("copiare scrive i riferimenti com'erano, con gli id di prima", () => {
    const svg = copy(source(), ALL);
    expect(svg).toContain('fub:from="oaaaaaaaa right"');
    expect(svg).toContain('fub:to="obbbbbbbb left"');
    expect(svg).toContain('fub:along="occcccccc 0.5000 4.00"');
    // Anche il connettore o l'etichetta da soli: è l'incolla che decide.
    expect(copy(source(), ["occcccccc"])).toContain('fub:from="oaaaaaaaa right"');
    expect(copy(source(), ["odddddddd"])).toContain('fub:along="occcccccc 0.5000 4.00"');
  });

  it("incollati con i loro oggetti nominano le copie, nello stesso disegno e in un altro", () => {
    for (const opened of [source(), target()]) {
      const out = paste(opened, copy(source(), ALL));
      const [a, b, c, label] = out.keys as [string, string, string, string];
      expect(new Set([a, b, c, label, ...ALL]).size).toBe(8);
      expect(attrOf(opened, c, "fub:from")).toBe(`${a} right`);
      expect(attrOf(opened, c, "fub:to")).toBe(`${b} left`);
      expect(attrOf(opened, label, "fub:along")).toBe(`${c} 0.5000 4.00`);
      // La geometria e il posto dell'etichetta restano quelli di prima.
      expect(attrOf(opened, c, "fub:geom")).toBe("straight 10 5 40 5");
      expect(attrOf(opened, c, "d")).toBe("M10 5 L40 5");
      expect(attrOf(opened, label, "transform")).toBe("matrix(1 0 0 1 25 1)");
    }
  });

  it("nello stesso disegno gli originali restano agganciati fra loro", () => {
    const opened = source();
    paste(opened, copy(opened, ALL));
    expect(attrOf(opened, "occcccccc", "fub:from")).toBe("oaaaaaaaa right");
    expect(attrOf(opened, "occcccccc", "fub:to")).toBe("obbbbbbbb left");
    expect(attrOf(opened, "odddddddd", "fub:along")).toBe("occcccccc 0.5000 4.00");
  });

  it("il connettore da solo ha i due capi liberi, anche dove gli stessi id ci sono", () => {
    for (const opened of [source(), target(), open(doc(`${LAYER}${RECTS}</g>`))]) {
      const [c] = paste(opened, copy(source(), ["occcccccc"])).keys as [string];
      expect(attrOf(opened, c, "fub:from")).toBeNull();
      expect(attrOf(opened, c, "fub:to")).toBeNull();
      expect(attrOf(opened, c, "fub:shape")).toBe("connector");
      expect(attrOf(opened, c, "fub:geom")).toBe("straight 10 5 40 5");
      expect(rawOf(node(opened, c))).not.toContain("fub:from");
    }
  });

  it("con uno solo dei due oggetti, l'altro capo è libero", () => {
    const opened = source();
    const [a, c] = paste(opened, copy(opened, ["oaaaaaaaa", "occcccccc"])).keys as [string, string];
    expect(attrOf(opened, c, "fub:from")).toBe(`${a} right`);
    expect(attrOf(opened, c, "fub:to")).toBeNull();
    const other = target();
    const [b, d] = paste(other, copy(source(), ["obbbbbbbb", "occcccccc"])).keys as [string, string];
    expect(attrOf(other, d, "fub:from")).toBeNull();
    expect(attrOf(other, d, "fub:to")).toBe(`${b} left`);
  });

  it("l'etichetta senza il suo connettore è un testo qualunque, col suo posto", () => {
    for (const opened of [source(), target()]) {
      const [label] = paste(opened, copy(source(), ["odddddddd"])).keys as [string];
      expect(attrOf(opened, label, "fub:along")).toBeNull();
      expect(attrOf(opened, label, "transform")).toBe("matrix(1 0 0 1 25 1)");
      expect(rawOf(node(opened, label))).toContain("<tspan");
    }
  });

  it("l'etichetta con il connettore, senza gli oggetti, nomina il connettore", () => {
    const opened = target();
    const [c, label] = paste(opened, copy(source(), ["occcccccc", "odddddddd"])).keys as [string, string];
    expect(attrOf(opened, label, "fub:along")).toBe(`${c} 0.5000 4.00`);
    expect(attrOf(opened, c, "fub:from")).toBeNull();
    expect(attrOf(opened, c, "fub:to")).toBeNull();
  });

  it("un valore fuori grammatica resta com'è", () => {
    const odd = source(' fub:from="oaaaaaaaa sopra" fub:to="obbbbbbbb"', "occcccccc 2 4");
    const opened = target();
    const [, , c, label] = paste(opened, copy(odd, ALL)).keys as [string, string, string, string];
    expect(attrOf(opened, c, "fub:from")).toBe("oaaaaaaaa sopra");
    expect(attrOf(opened, c, "fub:to")).toBe("obbbbbbbb");
    expect(attrOf(opened, label, "fub:along")).toBe("occcccccc 2 4");
  });

  it("gli id nominati che l'SVG non ha non diventano quelli di un oggetto del disegno", () => {
    // `ozzzzzzzz` è del disegno che riceve, e non fa parte di ciò che si incolla.
    const odd = source(' fub:from="ozzzzzzzz right" fub:to="obbbbbbbb left"', "ozzzzzzzz 0.5000 4.00");
    const opened = target();
    const [b, c, label] = paste(opened, copy(odd, ["obbbbbbbb", "occcccccc", "odddddddd"])).keys as [string, string, string];
    expect(attrOf(opened, c, "fub:from")).toBeNull();
    expect(attrOf(opened, c, "fub:to")).toBe(`${b} left`);
    expect(attrOf(opened, label, "fub:along")).toBeNull();
  });

  it("un SVG scritto a mano con gli oggetti: i riferimenti seguono gli id nuovi in ogni posto del tag", () => {
    // I capi sono il primo attributo, uno fra apici singoli, l'ultimo prima di `/>`.
    const svg = doc(
      `${LAYER}<g id="ogggggggg">${RECTS}` +
        '<path fub:from="oaaaaaaaa right" id="occcccccc" fub:shape="connector" fub:geom="straight 10 5 40 5" fub:to=\'obbbbbbbb left\' d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2"/>' +
        '<path id="oeeeeeeee" fub:shape="connector" fub:geom="straight 10 5 40 5" d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2" fub:from="obbbbbbbb top"/>' +
        '<path\n    fub:to="oaaaaaaaa left"\n    fub:shape="connector" fub:geom="straight 10 5 40 5"\n    d="M10 5 L40 5" fill="none" stroke="#000000"/>' +
        "</g></g>",
    );
    const opened = target();
    const [group] = paste(opened, svg).keys as [string];
    const raw = rawOf(node(opened, group));
    const [a, b] = [...raw.matchAll(/<rect id="([^"]+)"/g)].map((match) => match[1]!) as [string, string];
    const paths = [...raw.matchAll(/<path\b[^>]*>/g)].map((match) => match[0]);
    expect(paths).toHaveLength(3);
    // Chi nomina oggetti incollati insieme li nomina per i loro id nuovi.
    expect(paths[0]).toContain(`fub:from="${a} right"`);
    expect(paths[0]).toContain(`fub:to='${b} left'`);
    expect(paths[1]).toContain(`fub:from="${b} top"`);
    expect(paths[2]).toContain(`fub:to="${a} left"`);
    expect(paths.join("")).not.toContain("oaaaaaaaa");
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("un SVG scritto a mano senza gli oggetti toglie i capi, in ogni posto del tag e anche dove il connettore non ha id", () => {
    const svg = doc(
      `${LAYER}` +
        '<path fub:from="oaaaaaaaa right" fub:shape="connector" fub:geom="straight 10 5 40 5" fub:to=\'obbbbbbbb left\' d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2"/>' +
        '<path\n    fub:to="oaaaaaaaa left"\n    fub:shape="connector" fub:geom="straight 10 5 40 5"\n    d="M10 5 L40 5" fill="none" stroke="#000000"/>' +
        '<path id="oeeeeeeee" fub:shape="connector" fub:geom="straight 10 5 40 5" d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2" fub:from="obbbbbbbb top"/>' +
        "</g>",
    );
    const opened = target();
    const [group] = paste(opened, svg).keys as [string];
    const raw = rawOf(node(opened, group));
    const paths = [...raw.matchAll(/<path\b[^>]*>/g)].map((match) => anonymous(match[0]));
    // Il tag resta com'era scritto, senza i capi e senza gli spazi che li precedevano.
    expect(paths).toEqual([
      '<path id="ID" fub:shape="connector" fub:geom="straight 10 5 40 5" d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2"/>',
      '<path id="ID"\n    fub:shape="connector" fub:geom="straight 10 5 40 5"\n    d="M10 5 L40 5" fill="none" stroke="#000000"/>',
      '<path id="ID" fub:shape="connector" fub:geom="straight 10 5 40 5" d="M10 5 L40 5" fill="none" stroke="#000000" stroke-width="2"/>',
    ]);
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  });

  it("anche un SVG che entra in un gruppo, per un foglio di stile, segue gli id nuovi", () => {
    const svg = doc(`<style>.nota { fill: #cc0000; }</style>${LAYER}${RECTS}${CONNECTOR("occcccccc")}${LABEL("odddddddd")}</g>`);
    const opened = target();
    const [group] = paste(opened, svg).keys as [string];
    const raw = rawOf(node(opened, group));
    const found = [...raw.matchAll(/<(rect|path|text) id="([^"]+)"/g)].map((match) => match[2]!);
    const [a, b, c, label] = found as [string, string, string, string];
    expect(found).toHaveLength(4);
    expect(attrOf(opened, c, "fub:from")).toBe(`${a} right`);
    expect(attrOf(opened, c, "fub:to")).toBe(`${b} left`);
    expect(attrOf(opened, label, "fub:along")).toBe(`${c} 0.5000 4.00`);
  });

  it("un giro di copia e incolla riporta gli stessi byte, id e riferimenti a parte", () => {
    const from = source();
    const into = open(doc(`${LAYER}</g>`));
    const out = paste(into, copy(from, ALL));
    const pasted = out.keys.map((key) => rawOf(node(into, key)));
    const original = ALL.map((key) => rawOf(node(from, key)));
    const refs = (text: string): string => anonymous(text).replace(/ fub:(from|to|along)="ID [^"]*"/g, "");
    expect(pasted.map(refs)).toEqual(original.map(refs));
  });
});

describe("le etichette nelle forme negli appunti", () => {
  /// Un rettangolo con la sua etichetta, nel loro gruppo.
  const LABELLED =
    '<g id="ogggggggg"><rect id="oaaaaaaaa" x="0" y="0" width="40" height="20"/>' +
    '<text id="odddddddd" fub:inside="oaaaaaaaa" fub:wrap="28" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 20 14)"><tspan x="0" dy="0">sì</tspan></text></g>';
  const source = (): Opened => open(doc(`${LAYER}${LABELLED}</g>`));

  it("il gruppo incollato porta l'etichetta, che nomina la forma incollata, nello stesso disegno e in un altro", () => {
    for (const opened of [source(), open(TARGET)]) {
      const [group] = paste(opened, copy(source(), ["ogggggggg"])).keys as [string];
      const [shape, label] = [...rawOf(node(opened, group)).matchAll(/<(?:rect|text) id="([^"]+)"/g)].map((match) => match[1]!) as [string, string];
      expect(shape).not.toBe("oaaaaaaaa");
      expect(attrOf(opened, label, "fub:inside")).toBe(shape);
      expect(attrOf(opened, label, "transform")).toBe("matrix(1 0 0 1 20 14)");
    }
    // Gli originali restano legati fra loro.
    const same = source();
    paste(same, copy(same, ["ogggggggg"]));
    expect(attrOf(same, "odddddddd", "fub:inside")).toBe("oaaaaaaaa");
  });

  it("l'etichetta senza la sua forma è un testo qualunque, col suo posto", () => {
    const opened = open(TARGET);
    const from = source();
    const inside = copy(from, ["odddddddd"]);
    const [label] = paste(opened, inside).keys as [string];
    expect(attrOf(opened, label, "fub:inside")).toBeNull();
    expect(attrOf(opened, label, "fub:wrap")).toBe("28");
  });
});
