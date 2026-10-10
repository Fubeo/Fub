// Gli stili del documento: come si leggono, i nomi, e le operazioni che li
// fanno, li danno, li aggiornano, tornano allo stile, scollegano e li
// tolgono, che il motore accetta così come sono e che un annulla disfa al
// byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import type { Arranged } from "./arrange";
import { estimate } from "./measure";
import {
  applyStyleOps,
  arrivingStyleName,
  deleteStyleOps,
  deleteStyleProblem,
  differingFollowers,
  documentStyles,
  freshStyleName,
  newStyleOps,
  renameStyleOps,
  revertStyleOps,
  styleNameProblem,
  styleRow,
  unlinkStyleOps,
  updateStyleOps,
  type DocumentStyle,
} from "./styles";
import { LAYER, open, type Opened } from "./test-support";
import { followed, MARKER, RED } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RECT = (id: string, extra = ' fill="#0072b2" stroke="#000000" stroke-width="2"'): string => `<rect id="${id}" x="0" y="0" width="10" height="10"${extra}/>`;
const TEXT = (id: string, body: string, extra = ' fill="#000000" font-family="Inter, sans-serif" font-size="32"'): string => `<text id="${id}" x="10" y="40"${extra}><tspan x="10" dy="0">${body}</tspan></text>`;
const BOX = '<polyline id="rbox00000" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#e69f00" stroke="#000000" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="none"/>';
const TITLE = '<text id="rtitle000" fub:role="style" fub:name="Titolo" fill="#1a1a1a" font-family="Inter, sans-serif" font-size="48" font-weight="600"/>';

/// Il documento coi `defs` e il livello dati.
const drawing = (defs: string, layer: string): Opened => open(doc(`<defs id="fub-defs">${defs}</defs>${LAYER}${layer}</g>`));

/// Applica `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo, col motore dopo il cambio.
function applied(opened: Opened, change: Arranged): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// L'elemento di id `id` nel testo `text`, com'è scritto.
function element(text: string, id: string): string {
  const at = text.indexOf(`id="${id}"`);
  if (at < 0) throw new Error(`nessun elemento ${id}`);
  const start = text.lastIndexOf("<", at);
  const end = text.indexOf(">", at);
  return text.slice(start, end + 1);
}

const styles = (opened: Opened): DocumentStyle[] => documentStyles(opened.engine.model!);
const styleNamed = (opened: Opened, name: string): DocumentStyle => styles(opened).find((style) => style.name === name)!;
const units = (opened: Opened, ...keys: string[]) => {
  const index = opened.reindex();
  return keys.map((key) => index.get(key)!);
};

describe("gli stili del documento", () => {
  it("si leggono nell'ordine del file, ciascuno coi suoi seguaci del suo tipo", () => {
    const opened = drawing(BOX + TITLE, `${RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#e69f00"')}${RECT("obbbbbbbb", ' fub:style="rbox00000"')}${TEXT("occcccccc", "Ciao", ' fub:style="rbox00000"')}${TEXT("odddddddd", "Capo", ' fub:style="rtitle000"')}`);
    expect(styles(opened).map(({ id, name, kind, followers }) => ({ id, name, kind, followers }))).toEqual([
      { id: "rbox00000", name: "Riquadro", kind: "graphic", followers: 2 },
      { id: "rtitle000", name: "Titolo", kind: "text", followers: 1 },
    ]);
  });

  it("la riga «Stile» dice chi seguono gli oggetti scelti, e in che cosa ne sono diversi", () => {
    const opened = drawing(BOX + TITLE, `${RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="2"')}${RECT("obbbbbbbb", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="4"')}${RECT("occcccccc")}`);
    const all = styles(opened);
    const model = opened.engine.model!;
    const same = styleRow(model, units(opened, "oaaaaaaaa"), "graphic", all, estimate)!;
    expect(same.style?.name).toBe("Riquadro");
    expect([...same.differs]).toEqual([]);
    const two = styleRow(model, units(opened, "oaaaaaaaa", "obbbbbbbb"), "graphic", all, estimate)!;
    expect(two.style?.name).toBe("Riquadro");
    expect([...two.differs]).toEqual(["width"]);
    expect(two.differing).toBe(1);
    const mixed = styleRow(model, units(opened, "oaaaaaaaa", "occcccccc"), "graphic", all, estimate)!;
    expect(mixed).toMatchObject({ style: null, mixed: true, count: 2 });
    expect(styleRow(model, units(opened, "oaaaaaaaa"), "text", all, estimate)).toBeNull();
  });
});

describe("i nomi", () => {
  const list: DocumentStyle[] = [
    { id: "r1", name: "Titolo", kind: "text", node: null!, followers: 0 },
    { id: "r2", name: "Stile grafico 1", kind: "graphic", node: null!, followers: 0 },
  ];

  it("sono di un tipo: uno stile di testo e uno grafico possono chiamarsi uguali", () => {
    expect(styleNameProblem(list, "text", "titolo")).toBe("taken");
    expect(styleNameProblem(list, "graphic", "Titolo")).toBeNull();
    expect(styleNameProblem(list, "text", "Titolo", "r1")).toBeNull();
    expect(styleNameProblem(list, "text", "")).toBe("empty");
    expect(styleNameProblem(list, "text", "#ff0000")).toBe("color");
  });

  it("di uno stile nuovo contano da 1, di uno che arriva dagli appunti da 2", () => {
    expect(freshStyleName(list, "graphic", "Stile grafico")).toBe("Stile grafico 2");
    expect(freshStyleName(list, "text", "Stile di testo")).toBe("Stile di testo 1");
    expect(arrivingStyleName(list, "text", "Titolo")).toBe("Titolo 2");
    expect(arrivingStyleName(list, "graphic", "Titolo")).toBe("Titolo");
  });
});

describe("uno stile nuovo", () => {
  it("prende l'aspetto del primo oggetto, e lo danno tutti gli oggetti scelti", () => {
    const opened = drawing("", `${RECT("oaaaaaaaa", ' fill="#e69f00" stroke="#000000" stroke-width="3" stroke-dasharray="6 3"')}${RECT("obbbbbbbb")}`);
    const done = newStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa", "obbbbbbbb"), "graphic", "Riquadro", estimate, ids(opened))!;
    expect(done).toMatchObject({ changed: 2, kept: 0 });
    const after = applied(opened, done);
    expect(element(after, done.id)).toBe(
      `<polyline id="${done.id}" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#e69f00" stroke="#000000" stroke-width="3" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="6 3"/>`,
    );
    expect(element(after, "oaaaaaaaa")).toContain(`fub:style="${done.id}"`);
    expect(element(after, "obbbbbbbb")).toContain(`fub:style="${done.id}"`);
    expect(element(after, "obbbbbbbb")).toContain('fill="#e69f00"');
    expect(element(after, "obbbbbbbb")).toContain('stroke-width="3"');
    const style = styleNamed(opened, "Riquadro");
    expect(style.followers).toBe(2);
    expect(differingFollowers(opened.engine.model!, style, estimate)).toBe(0);
  });

  it("di testo prende ciò che ha tutto il testo, e chi lo segue tiene le sue parole in grassetto", () => {
    const opened = drawing("", `${TEXT("oaaaaaaaa", "Capitolo", ' font-family="Inter, sans-serif" font-size="48" font-weight="600"')}${TEXT("obbbbbbbb", 'Un <tspan font-weight="700">grande</tspan> passo', ' font-family="Inter, sans-serif" font-size="16"')}`);
    const done = newStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa", "obbbbbbbb"), "text", "Titolo", estimate, ids(opened))!;
    const after = applied(opened, done);
    expect(element(after, done.id)).toBe(
      `<text id="${done.id}" fub:role="style" fub:name="Titolo" fill="#000000" font-family="Inter, sans-serif" font-size="48" font-weight="600" font-style="normal" letter-spacing="0" text-decoration="none"/>`,
    );
    const b = after.slice(after.indexOf('id="obbbbbbbb"'), after.indexOf("</text>", after.indexOf('id="obbbbbbbb"')));
    expect(b).toContain('font-size="48"');
    expect(b).toContain('font-weight="600"');
    expect(b).toContain('font-weight="700">grande');
  });

  it("di un gruppo scelto lo segue il gruppo, e di testo i suoi testi", () => {
    const opened = drawing("", `<g id="ogroup000">${RECT("oaaaaaaaa", ' fill="#e69f00"')}${TEXT("obbbbbbbb", "Ciao")}</g>`);
    const graphic = newStyleOps(opened.engine.model!, units(opened, "ogroup000"), "graphic", "Gruppo", estimate, ids(opened))!;
    expect(graphic.changed).toBe(1);
    const after = applied(opened, graphic);
    expect(element(after, "ogroup000")).toContain(`fub:style="${graphic.id}"`);
    expect(element(after, graphic.id)).toContain('fill="#e69f00"');
    const text = newStyleOps(opened.engine.model!, units(opened, "ogroup000"), "text", "Testo", estimate, ids(opened))!;
    expect(text.changed).toBe(1);
    expect(element(applied(opened, text), "obbbbbbbb")).toContain(`fub:style="${text.id}"`);
  });

  it("con una sfumatura privata ne fa una copia sua, e ridarla a chi la mostra già non ne fa un'altra", () => {
    const gradient = '<linearGradient id="rgggggggg" fub:role="private" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>';
    const opened = drawing(gradient, `${RECT("oaaaaaaaa", ' fill="url(#rgggggggg) #808080"')}`);
    const done = newStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), "graphic", "Sfumato", estimate, ids(opened))!;
    const after = applied(opened, done);
    const proto = element(after, done.id);
    const copy = /fill="url\(#(r[0-9a-z]{8})\) #808080"/.exec(proto)?.[1];
    expect(copy).toBeDefined();
    expect(copy).not.toBe("rgggggggg");
    expect(element(after, "oaaaaaaaa")).toContain('fill="url(#rgggggggg) #808080"');
    const style = styleNamed(opened, "Sfumato");
    expect(differingFollowers(opened.engine.model!, style, estimate)).toBe(0);
    const again = revertStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), style, estimate, ids(opened));
    expect(again.ops).toEqual([]);
  });
});

describe("dare uno stile", () => {
  it("dà tutto lo stile e fub:style", () => {
    const opened = drawing(BOX, `${RECT("oaaaaaaaa", ' fill="#0072b2" stroke="#000000" stroke-width="2" opacity="0.5"')}`);
    const done = applyStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), styleNamed(opened, "Riquadro"), estimate, ids(opened));
    expect(done).toMatchObject({ changed: 1, kept: 0 });
    const after = applied(opened, done);
    expect(element(after, "oaaaaaaaa")).toBe('<rect id="oaaaaaaaa" fub:style="rbox00000" x="0" y="0" width="10" height="10" fill="#e69f00" stroke="#000000" stroke-width="2"/>');
  });

  it("lascia a chi lo segue ciò che lo stile non dice", () => {
    const opened = drawing('<text id="rsize0000" fub:role="style" fub:name="Grande" font-size="64"/>', TEXT("oaaaaaaaa", "Ciao", ' font-family="Georgia, serif" font-size="16" fill="#d55e00"'));
    const done = applyStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), styleNamed(opened, "Grande"), estimate, ids(opened));
    const after = applied(opened, done);
    const text = element(after, "oaaaaaaaa");
    expect(text).toContain('font-size="64"');
    expect(text).toContain('font-family="Georgia, serif"');
    expect(text).toContain('fill="#d55e00"');
  });
});

describe("aggiornare uno stile", () => {
  it("dà i campi cambiati a chi lo segue, ma non a chi ne aveva una differenza", () => {
    const opened = drawing(
      BOX,
      `${RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#cc79a7" stroke="#000000" stroke-width="5"')}${RECT("obbbbbbbb", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="4"')}${RECT("occcccccc", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="2"')}`,
    );
    const style = styleNamed(opened, "Riquadro");
    const done = updateStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), style, estimate, ids(opened))!;
    const after = applied(opened, done);
    expect(element(after, "rbox00000")).toBe('<polyline id="rbox00000" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#cc79a7" stroke="#000000" stroke-width="5" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="none"/>');
    expect(element(after, "obbbbbbbb")).toContain('fill="#cc79a7"');
    expect(element(after, "obbbbbbbb")).toContain('stroke-width="4"');
    expect(element(after, "occcccccc")).toContain('fill="#cc79a7"');
    expect(element(after, "occcccccc")).toContain('stroke-width="5"');
    expect(differingFollowers(opened.engine.model!, styleNamed(opened, "Riquadro"), estimate)).toBe(1);
  });

  it("lascia com'è chi è bloccato, e lo conta", () => {
    const opened = drawing(BOX, `${RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#cc79a7"')}${RECT("obbbbbbbb", ' fub:style="rbox00000" fill="#e69f00" fub:locked="true"')}${RECT("occcccccc", ' fub:style="rbox00000" fill="#e69f00"')}`);
    const done = updateStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), styleNamed(opened, "Riquadro"), estimate, ids(opened))!;
    expect(done).toMatchObject({ changed: 1, kept: 1 });
    const after = applied(opened, done);
    expect(element(after, "obbbbbbbb")).toContain('fill="#e69f00"');
    expect(element(after, "occcccccc")).toContain('fill="#cc79a7"');
  });

  it("non fa niente se lo stile è già così", () => {
    const opened = drawing(BOX, RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="2"'));
    const done = updateStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), styleNamed(opened, "Riquadro"), estimate, ids(opened))!;
    expect(done.ops).toEqual([]);
  });
});

describe("tornare allo stile, scollegare, rinominare", () => {
  it("tornare toglie le differenze", () => {
    const opened = drawing(BOX, RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="7" opacity="0.5"'));
    const style = styleNamed(opened, "Riquadro");
    const done = revertStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), style, estimate, ids(opened));
    expect(done.changed).toBe(1);
    const after = applied(opened, done);
    expect(element(after, "oaaaaaaaa")).toContain('stroke-width="2"');
    expect(element(after, "oaaaaaaaa")).not.toContain("opacity");
    expect(differingFollowers(opened.engine.model!, styleNamed(opened, "Riquadro"), estimate)).toBe(0);
  });

  it("scollegare toglie fub:style e lascia l'aspetto", () => {
    const opened = drawing(BOX, RECT("oaaaaaaaa", ' fub:style="rbox00000" fill="#e69f00"'));
    const done = unlinkStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), "graphic", styles(opened), ids(opened));
    const after = applied(opened, done);
    expect(element(after, "oaaaaaaaa")).toBe('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#e69f00"/>');
  });

  it("rinominare cambia soltanto fub:name", () => {
    const opened = drawing(BOX, RECT("oaaaaaaaa"));
    const done = renameStyleOps(opened.engine.model!, styleNamed(opened, "Riquadro"), "Avviso", units(opened, "oaaaaaaaa"), ids(opened));
    const after = applied(opened, done);
    expect(element(after, "rbox00000")).toContain('fub:name="Avviso"');
    expect(renameStyleOps(opened.engine.model!, styleNamed(opened, "Avviso"), "Avviso", [], ids(opened)).ops).toEqual([]);
  });
});

describe("eliminare uno stile", () => {
  it("toglie fub:style da tutti, anche bloccati o dell'altro tipo, e poi lo stile, in un passo", () => {
    const opened = drawing(BOX, `${RECT("oaaaaaaaa", ' fub:style="rbox00000"')}${RECT("obbbbbbbb", ' fub:style="rbox00000" fub:locked="true"')}${TEXT("occcccccc", "Ciao", ' fub:style="rbox00000"')}`);
    const style = styleNamed(opened, "Riquadro");
    expect(deleteStyleProblem(opened.engine.model!, style)).toBeNull();
    const done = deleteStyleOps(opened.engine.model!, style, [], ids(opened))!;
    expect(done.changed).toBe(2);
    const after = applied(opened, done);
    expect(after).not.toContain("fub:style");
    expect(after).not.toContain("rbox00000");
  });

  it("non si fa se chi lo segue sta in un gruppo bloccato", () => {
    const opened = drawing(BOX, `<g id="ogroup000" fub:locked="true">${RECT("oaaaaaaaa", ' fub:style="rbox00000"')}${RECT("obbbbbbbb")}</g>`);
    const style = styleNamed(opened, "Riquadro");
    expect(deleteStyleProblem(opened.engine.model!, style)).toBe("locked");
    expect(deleteStyleOps(opened.engine.model!, style, [], ids(opened))).toBeNull();
  });
});

describe("i campi che uno stile porta", () => {
  it("le punte passano per forma e misura, col colore di chi le riceve", () => {
    const opened = followed(
      doc(
        `<defs id="fub-defs">${MARKER("rmarker00", "triangle", "medium", "end")}</defs>${LAYER}` +
          `<line id="oaaaaaaaa" x1="0" y1="0" x2="100" y2="0" stroke="${RED}" stroke-width="2" marker-end="url(#rmarker00)"/>` +
          '<line id="obbbbbbbb" x1="0" y1="20" x2="100" y2="20" stroke="#0072b2" stroke-width="2"/></g>',
      ),
    );
    const done = newStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa", "obbbbbbbb"), "graphic", "Freccia", estimate, ids(opened))!;
    const after = applied(opened, done);
    expect(element(after, done.id)).toContain('marker-end="url(#rmarker00)"');
    expect(element(after, done.id)).toContain('marker-start="none"');
    expect(element(after, "obbbbbbbb")).toContain('marker-end="url(#rmarker00)"');
    expect(element(after, "obbbbbbbb")).toContain(`stroke="${RED}"`);
    expect(element(after, "obbbbbbbb")).not.toContain("marker-start");
  });

  it("un tratteggio del menu resta lo stesso in spessori, e chi ha un altro spessore ne ha soltanto quello di diverso", () => {
    const opened = drawing(
      '<polyline id="rdash0000" fub:role="style" fub:name="Tratteggio" points="0,0 100,0 100,100" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="butt" stroke-dasharray="8 6"/>',
      `${RECT("oaaaaaaaa", ' fub:style="rdash0000" fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="2 4"')}${RECT("obbbbbbbb", ' fub:style="rdash0000" fill="none" stroke="#000000" stroke-width="4" stroke-dasharray="16 12"')}`,
    );
    const model = opened.engine.model!;
    const style = styleNamed(opened, "Tratteggio");
    expect([...styleRow(model, units(opened, "obbbbbbbb"), "graphic", styles(opened), estimate)!.differs]).toEqual(["width"]);
    const done = updateStyleOps(model, units(opened, "oaaaaaaaa"), style, estimate, ids(opened))!;
    const after = applied(opened, done);
    expect(element(after, "rdash0000")).toContain('stroke-dasharray="2 4"');
    expect(element(after, "obbbbbbbb")).toContain('stroke-dasharray="4 8"');
    expect(element(after, "obbbbbbbb")).toContain('stroke-width="4"');
  });

  it("uno stile di serie prende il corpo e il peso suoi, e il resto dal testo", () => {
    const opened = drawing("", TEXT("oaaaaaaaa", "Capitolo", ' fill="#d55e00" font-family="Georgia, serif" font-size="16"'));
    const done = newStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), "text", "Titolo", estimate, ids(opened), { size: 40, weight: 700 })!;
    const after = applied(opened, done);
    const proto = element(after, done.id);
    expect(proto).toContain('font-size="40"');
    expect(proto).toContain('font-weight="bold"');
    expect(proto).toContain('font-family="Georgia, serif"');
    expect(proto).toContain('fill="#d55e00"');
    expect(element(after, "oaaaaaaaa")).toContain('font-size="40"');
  });

  it("aggiornare uno stile di testo lascia le parole in grassetto di chi lo segue", () => {
    const opened = drawing(
      TITLE,
      `${TEXT("oaaaaaaaa", "Primo", ' fub:style="rtitle000" fill="#0072b2" font-family="Inter, sans-serif" font-size="48" font-weight="600"')}${TEXT("obbbbbbbb", 'Un <tspan font-weight="800">grande</tspan> passo', ' fub:style="rtitle000" fill="#1a1a1a" font-family="Inter, sans-serif" font-size="48" font-weight="600"')}`,
    );
    const done = updateStyleOps(opened.engine.model!, units(opened, "oaaaaaaaa"), styleNamed(opened, "Titolo"), estimate, ids(opened))!;
    const after = applied(opened, done);
    expect(element(after, "rtitle000")).toContain('fill="#0072b2"');
    const b = after.slice(after.indexOf('id="obbbbbbbb"'), after.indexOf("</text>", after.indexOf('id="obbbbbbbb"')));
    expect(b).toContain('fill="#0072b2"');
    expect(b).toContain('font-weight="800">grande');
  });

  it("dare o aggiornare uno stile di testo rifà gli a capo dei testi in area che lo seguono", () => {
    // Corpo 10, a stima: ogni carattere largo 6, dieci per riga; a corpo 20
    // ne stanno cinque.
    const NOTE = (size: number): string => `<text id="rnote0000" fub:role="style" fub:name="Nota" font-size="${size}"/>`;
    const AREA = (extra = ""): string =>
      `<text id="oaaaaaaaa"${extra} fub:wrap="60" x="20" y="40" font-size="10"><tspan x="20" dy="0">Il testo</tspan><tspan fub:join="space" x="20" dy="12.5">va a capo</tspan></text>`;
    const FLOWED = '<tspan x="20" dy="0">Il</tspan><tspan fub:join="space" x="20" dy="25">testo</tspan><tspan fub:join="space" x="20" dy="25">va a</tspan><tspan fub:join="space" x="20" dy="25">capo</tspan>';
    const flat = (text: string): string => text.replace(/\n\s*/g, "");

    const given = drawing(NOTE(20), AREA());
    const applied20 = flat(applied(given, applyStyleOps(given.engine.model!, units(given, "oaaaaaaaa"), styleNamed(given, "Nota"), estimate, ids(given))));
    expect(element(applied20, "oaaaaaaaa")).toContain('fub:wrap="60"');
    expect(applied20).toContain(FLOWED);

    const following = drawing(NOTE(10), `${AREA(' fub:style="rnote0000"')}${TEXT("obbbbbbbb", "Nota", ' fub:style="rnote0000" font-size="20"')}`);
    const updated = flat(applied(following, updateStyleOps(following.engine.model!, units(following, "obbbbbbbb"), styleNamed(following, "Nota"), estimate, ids(following))!));
    expect(element(updated, "rnote0000")).toContain('font-size="20"');
    expect(element(updated, "oaaaaaaaa")).toContain('fub:wrap="60"');
    expect(updated).toContain(FLOWED);
  });
});

describe("mille oggetti che seguono uno stile", () => {
  it("la riga «Stile» si legge in fretta, e le operazioni non crescono col quadrato", () => {
    const time = (run: () => void): number => {
      let best = Infinity;
      for (let n = 0; n < 3; n++) {
        const start = performance.now();
        run();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    /// La riga e l'aggiornamento su `count` rettangoli che seguono lo stile,
    /// uno su dieci col contorno diverso.
    const measure = (count: number): { reading: number; updating: number } => {
      const rects = Array.from({ length: count }, (_, i) => RECT(`o${String(i).padStart(8, "0")}`, ` fub:style="rbox00000" fill="#e69f00" stroke="#000000" stroke-width="${i % 10 === 0 ? 4 : 2}"`)).join("");
      const opened = drawing(BOX, rects);
      const model = opened.engine.model!;
      const all = opened.index.units;
      expect(all).toHaveLength(count);
      const list = styles(opened);
      let row: ReturnType<typeof styleRow> = null;
      const reading = time(() => (row = styleRow(model, all, "graphic", list, estimate)));
      expect(row!.differing).toBe(count / 10);
      let update: ReturnType<typeof updateStyleOps> = null;
      const updating = time(() => (update = updateStyleOps(model, [all[0]!], list[0]!, estimate, ids(opened))));
      expect(update!.changed).toBe(count - count / 10);
      return { reading, updating };
    };
    const small = measure(250);
    const large = measure(1000);
    // Quattro volte gli oggetti: quattro volte il tempo se il conto è
    // lineare, sedici se cresce col quadrato. La soglia sta in mezzo, e
    // guarda il rapporto, non i millisecondi, che su una macchina carica di
    // altri test crescono tutti insieme; i due millisecondi di base tolgono il
    // rumore delle misure piccole. Con mille oggetti la riga costa una
    // ventina di millisecondi e l'aggiornamento una decina: oltre il mezzo
    // secondo qualcosa è andato storto comunque.
    expect(large.reading).toBeLessThan(10 * Math.max(small.reading, 2));
    expect(large.updating).toBeLessThan(10 * Math.max(small.updating, 2));
    expect(large.reading).toBeLessThan(500);
    expect(large.updating).toBeLessThan(500);
  });
});
