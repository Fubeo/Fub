// Il testo su tracciato: i comandi che ce lo mettono, lo tolgono e lo
// rovesciano, che il motore li accetta come sono, che il testo resta dov'era
// e che un annulla riporta il testo identico. Si misura con la stima: ogni
// grafema 0,6 volte il corpo.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import { elementChildren, rawOf, type ContainerNode } from "../scene/model";
import { pathData } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { type Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import { estimate } from "./measure";
import { backward, flipOps, oneLine, putOnPathOps, releaseOps, type TextPathRefused } from "./text-path";
import { LAYER, open, type Opened } from "./test-support";
import type { Rich } from "./rich";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged`, verifica che un annulla riporti il testo di prima e
/// che rifarlo riporti quello di dopo.
function applied(opened: Opened, arranged: Arranged | TextPathRefused): Arranged {
  if ("reason" in arranged) throw new Error(`rifiutato: ${arranged.reason}`);
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return arranged;
}

/// L'elemento di id `id` com'è scritto, senza gli a capo e i rientri.
const raw = (opened: Opened, id: string): string => rawOf(opened.engine.holder(id)!).replace(/\n\s*/g, "");
const resources = (opened: Opened): string[] => elementChildren(opened.engine.holder("fub-defs") as ContainerNode).map(rawOf);

describe("mettere un testo sul tracciato", () => {
  // «Sul colle», corpo 10: largo 54.
  const TEXT = '<text id="otttttttt" x="20" y="40" font-size="10"><tspan x="20" dy="0">Sul colle</tspan></text>';
  const LINE = '<path id="opppppppp" d="M 0 50 L 200 50" stroke="#000000"/>';

  it("la forma diventa il tracciato del testo, che comincia dove cominciava", () => {
    const opened = open(doc(`${LAYER}${TEXT}${LINE}</g>`));
    const out = applied(opened, putOnPathOps(opened.engine.model!, opened.index.units, estimate, ids(opened)));
    expect(out.keys).toEqual(["otttttttt"]);
    const [path] = elementChildren(opened.engine.holder("fub-defs") as ContainerNode);
    const id = path!.facts.id!;
    expect(rawOf(path!)).toBe(`<path id="${id}" fub:role="private" d="M0 50 L200 50"/>`);
    expect(raw(opened, "otttttttt")).toBe(`<text id="otttttttt" font-size="10"><textPath startOffset="20" href="#${id}">Sul colle</textPath></text>`);
    // La forma non c'è più.
    expect(opened.engine.holder("opppppppp")).toBeNull();
  });

  it("il tracciato si scrive nelle coordinate del testo", () => {
    const opened = open(doc(`${LAYER}${TEXT.replace('<text id="otttttttt"', '<text id="otttttttt" transform="translate(10 0)"')}<g id="ogggggggg" transform="translate(0 30)">${LINE}</g></g>`));
    const units = [opened.index.units[0]!, opened.index.children(opened.index.units[1]!)[0]!];
    applied(opened, putOnPathOps(opened.engine.model!, units, estimate, ids(opened)));
    expect(resources(opened)[0]).toContain('d="M-10 80 L190 80"');
    // In un gruppo che resta vuoto: il gruppo resta.
    expect(raw(opened, "ogggggggg")).toBe('<g id="ogggggggg" transform="translate(0 30)"></g>');
  });

  it("il testo ci sta tutto se può, o ne occupa l'inizio, il centro o la fine", () => {
    const at = (text: string, d: string): string => {
      const opened = open(doc(`${LAYER}${text}<path id="opppppppp" d="${d}"/></g>`));
      applied(opened, putOnPathOps(opened.engine.model!, opened.index.units, estimate, ids(opened)));
      return /<textPath[^>]*>/.exec(raw(opened, "otttttttt"))![0];
    };
    // Vicino alla fine: torna indietro quanto basta, 100 − 54.
    expect(at(TEXT.replace(/x="20"/g, 'x="90"'), "M 0 50 L 100 50")).toMatch(/startOffset="46"/);
    // Prima dell'inizio: comincia dall'inizio, che non si scrive.
    expect(at(TEXT.replace(/x="20"/g, 'x="-30"'), "M 0 50 L 100 50")).not.toMatch(/startOffset/);
    // Al centro, metà prima e metà dopo; più lungo del tracciato, al centro.
    const middle = TEXT.replace('font-size="10"', 'font-size="10" text-anchor="middle"');
    expect(at(middle.replace(/x="20"/g, 'x="10"'), "M 0 50 L 100 50")).toMatch(/startOffset="27"/);
    expect(at(middle, "M 0 50 L 40 50")).toMatch(/startOffset="20"/);
  });

  it("le righe diventano una, e lo stile di una riga passa ai suoi pezzi", () => {
    const rich: Rich = {
      attrs: {},
      inherited: {},
      lines: [
        { attrs: { x: "0", dy: "0" }, spans: [{ text: "Il testo", attrs: null }] },
        { attrs: { x: "0", dy: "14", "fub:join": "word" }, spans: [{ text: "ne", attrs: null }] },
        { attrs: { x: "0", dy: "14" }, spans: [] },
        { attrs: { x: "0", dy: "14", "font-style": "italic" }, spans: [{ text: "segue", attrs: null }, { text: " uno", attrs: { "font-weight": "bold" } }] },
      ],
    };
    expect(oneLine(rich).lines).toEqual([
      {
        attrs: {},
        spans: [
          { text: "Il testone ", attrs: null },
          { text: "segue", attrs: { "font-style": "italic" } },
          { text: " uno", attrs: { "font-style": "italic", "font-weight": "bold" } },
        ],
      },
    ]);
  });

  it("vuole un testo e una forma da seguire, e solo loro", () => {
    const refused = (body: string): string => {
      const opened = open(doc(`${LAYER}${body}</g>`));
      const out = putOnPathOps(opened.engine.model!, opened.index.units, estimate, ids(opened));
      return "reason" in out ? out.reason : "fatto";
    };
    expect(refused(TEXT)).toBe("pair");
    expect(refused(`${TEXT}${LINE}${LINE.replace("opppppppp", "oqqqqqqqq")}`)).toBe("pair");
    expect(refused(`${TEXT}<image id="oiiiiiiii" x="0" y="0" width="10" height="10" href="data:image/png;base64,AA=="/>`)).toBe("not_track");
    expect(refused(`${TEXT}<path id="opppppppp" d="M 5 5"/>`)).toBe("empty");
    expect(refused(`${TEXT}<rect id="orrrrrrrr" x="0" y="0" width="80" height="20"/>`)).toBe("fatto");
  });
});

describe("togliere e rovesciare", () => {
  const ALONG = (offset: string, extra = ""): string =>
    '<defs id="fub-defs"><path id="rpppppppp" fub:role="private" d="M 0 50 L 200 50"/></defs>' +
    `${LAYER}<text id="otttttttt" font-size="10"${extra}><textPath ${offset}href="#rpppppppp">Sul colle</textPath></text></g>`;

  it("tolto, il testo torna una riga dritta dove cominciava, e il tracciato se ne va", () => {
    const opened = open(doc(ALONG('startOffset="30" ')));
    applied(opened, releaseOps(opened.engine.model!, opened.index.units, ids(opened)));
    expect(raw(opened, "otttttttt")).toBe('<text id="otttttttt" x="30" y="50" font-size="10"><tspan x="30" dy="0">Sul colle</tspan></text>');
    expect(opened.engine.holder("rpppppppp")).toBeNull();
  });

  it("rovesciato, il tracciato va al contrario e il testo resta dov'era", () => {
    const opened = open(doc(ALONG('startOffset="30" ')));
    applied(opened, flipOps(opened.engine.model!, opened.index.units, estimate, ids(opened)));
    // Da 30 a 84 sul tracciato di prima: da 116 a 170 su quello rovesciato.
    expect(resources(opened)).toEqual(['<path id="rpppppppp" fub:role="private" d="M200 50 L0 50"/>']);
    expect(raw(opened, "otttttttt")).toContain('<textPath startOffset="116" href="#rpppppppp">');
    // Con una percentuale, e al centro.
    const share = open(doc(ALONG('startOffset="25%" ', ' text-anchor="middle"')));
    applied(share, flipOps(share.engine.model!, share.index.units, estimate, ids(share)));
    expect(raw(share, "otttttttt")).toContain('<textPath startOffset="75%" href="#rpppppppp">');
  });

  it("un tracciato che segue anche un altro testo resta com'è: il testo rovesciato ne ha uno suo", () => {
    const opened = open(
      doc(ALONG('startOffset="30" ').replace("</g>", '<text id="ouuuuuuuu"><textPath xlink:href="#rpppppppp">Altro</textPath></text></g>')),
    );
    const units = opened.index.units.filter((unit) => unit.key === "otttttttt");
    applied(opened, flipOps(opened.engine.model!, units, estimate, ids(opened)));
    const [kept, copy] = elementChildren(opened.engine.holder("fub-defs") as ContainerNode);
    expect(rawOf(kept!)).toBe('<path id="rpppppppp" fub:role="private" d="M 0 50 L 200 50"/>');
    expect(rawOf(copy!)).toBe(`<path id="${copy!.facts.id!}" fub:role="private" d="M200 50 L0 50"/>`);
    expect(raw(opened, "otttttttt")).toContain(`href="#${copy!.facts.id!}"`);
    expect(raw(opened, "ouuuuuuuu")).toContain('xlink:href="#rpppppppp"');
  });

  it("senza un testo su tracciato non c'è niente da fare", () => {
    const opened = open(doc(`${LAYER}<text id="otttttttt" x="0" y="10">Dritto</text></g>`));
    expect(releaseOps(opened.engine.model!, opened.index.units, ids(opened))).toEqual({ reason: "none" });
    expect(flipOps(opened.engine.model!, opened.index.units, estimate, ids(opened))).toEqual({ reason: "none" });
  });
});

describe("un tracciato al contrario", () => {
  const back = (d: string): string => pathData(backward(parsePath(d)!));

  it("aperto, dalla fine all'inizio; chiuso, dallo stesso punto nell'altro verso", () => {
    expect(back("M0 0 L10 0 C20 0 30 10 30 20")).toBe("M30 20 C30 10 20 0 10 0 L0 0");
    expect(back("M0 0 L10 0 L10 10 Z")).toBe("M0 0 L10 10 L10 0 L0 0 Z");
    expect(back("M0 0 L10 0 L0 0 Z")).toBe("M0 0 L10 0 L0 0 Z");
    expect(back("M0 0 A5 5 0 0 1 10 0")).toBe("M10 0 A5 5 0 0 0 0 0");
    // Più sottotracciati: dall'ultimo al primo.
    expect(back("M0 0 L1 0 M5 5 L6 5")).toBe("M6 5 L5 5 M1 0 L0 0");
  });
});
