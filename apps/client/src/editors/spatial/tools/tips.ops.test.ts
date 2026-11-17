// Le punte delle linee, le operazioni: darle, toglierle, cambiarne la misura,
// scambiarle, darle a un gruppo, il loro colore e le punte con lo stile. Ogni
// operazione si applica al motore, e un annulla riporta il testo al byte.

import { describe, expect, it } from "vitest";
import type { AddOp, SetOp } from "../scene/ops";
import { doc } from "../scene/test-support";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";
import { BLUE, CUSTOM, DEFS, ENDS, ids, MARKER, markersIn, RED } from "./tip-support";
import { DEFAULT_TIP_SIZE, Shelf, Tipper, tipElem, tipsStyleOf, type MarkerTip } from "./tips";
import { adds, applied, BRUSH, given, INK, LINE, looks, PINK, RAMP, sets, shown, SWATCH, tip, tipped, usedBy } from "./tips/test-support";

// ---------------------------------------------------------------------------
// Dare le punte.
// ---------------------------------------------------------------------------

describe("dare una punta", () => {
  it("aggiunge il marcatore fra le risorse, e la linea lo nomina, nello stesso passo", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.changed).toBe(1);
    expect(made.keys).toEqual(["oa"]);
    expect(made.ops.map((op) => op.op)).toEqual(["add", "set"]);
    const add = made.ops[0] as AddOp;
    expect(add.parent).toBe("fub-defs");
    expect(add.pos).toEqual({ last: true });
    const id = add.elem.attrs.id!;
    expect(id).toMatch(/^r/);
    expect(add.elem).toEqual(tipElem(id, tip("triangle"), "end", RED, 1));
    expect(made.ops[1]).toEqual({ op: "set", id: "oa", attrs: { "marker-end": `url(#${id})` } });
    const text = applied(opened, made.ops);
    expect(text).toContain(`marker-end="url(#${id})"`);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle"), end: "end", paint: RED, opacity: 1, id });
    expect(looks(opened).end).toEqual({ shape: "triangle", size: DEFAULT_TIP_SIZE });
  });

  it("senza risorse nasce fub-defs, per prima, e poi il marcatore", () => {
    const opened = open(doc(LAYER + LINE("oa") + "</g>"));
    const made = tipped(opened, { end: "start", shape: "circle" });
    expect(made.ops.map((op) => op.op)).toEqual(["add", "add", "set"]);
    expect((made.ops[0] as AddOp).elem.tag).toBe("defs");
    const text = applied(opened, made.ops);
    expect(text.indexOf('<defs id="fub-defs">')).toBeLessThan(text.indexOf("<marker"));
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("circle"), end: "start" });
  });

  it("due linee dello stesso colore condividono il marcatore, e un colore diverso ne vuole un altro", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob", undefined, 20) + LINE("oc", ` stroke="${BLUE}" stroke-width="2"`, 30) + LINE("od", ` stroke="${RED}" stroke-opacity="0.5"`, 40) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.ops.map((op) => op.op)).toEqual(["add", "add", "add", "set", "set", "set", "set"]);
    expect(made.changed).toBe(4);
    applied(opened, made.ops);
    expect(markersIn(opened)).toHaveLength(3);
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(usedBy(opened, "oa", "end")).not.toBe(usedBy(opened, "oc", "end"));
    expect(shown(opened, "oc", "end")).toMatchObject({ paint: BLUE, opacity: 1 });
    expect(shown(opened, "od", "end")).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(usedBy(opened, "od", "end")).not.toBe(usedBy(opened, "oa", "end"));
  });

  it("riusa un marcatore uguale che il disegno ha già, anche se non è di una linea della selezione", () => {
    const opened = open(doc(DEFS(MARKER("mx", "square", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mx")}`) + LINE("ob", undefined, 20) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "square" }, opened.reindex().units.filter((unit) => unit.id === "ob"));
    // Non c'è una misura da tenere: la nuova è la medium, un altro marcatore.
    expect(adds(made.ops)).toHaveLength(1);
    const same = tipped(opened, { end: "end", size: "large" }, opened.reindex().units.filter((unit) => unit.id === "ob"));
    expect(same.ops).toEqual([]);
    const linked = open(doc(DEFS(MARKER("mx", "square", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mx")}`) + LINE("ob", undefined, 20) + "</g>"));
    const reused = tipped(linked, { end: "end", shape: "square" }, linked.reindex().units.filter((unit) => unit.id === "ob"));
    expect(reused.ops).toEqual([{ op: "set", id: "ob", attrs: { "marker-end": "url(#mx)" } }]);
    applied(linked, reused.ops);
    expect(markersIn(linked)).toEqual(["mx"]);
  });

  it("la punta nuova ha la misura di quella che c'era, o la media", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), CUSTOM("cm")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", undefined, 20) + LINE("oc", ` stroke="${RED}"${ENDS(null, "cm")}`, 30) + "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", shape: "circle" });
    expect(made.changed).toBe(3);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("circle", "large") });
    expect(shown(opened, "ob", "end")).toMatchObject({ tip: tip("circle", DEFAULT_TIP_SIZE) });
    expect(shown(opened, "oc", "end")).toMatchObject({ tip: tip("circle", DEFAULT_TIP_SIZE) });
    // Il marcatore custom non lo usa più nessuno, ma non è un'altra risorsa condivisa: resta.
    expect(markersIn(opened)).toContain("cm");
    expect(markersIn(opened)).not.toContain("ma");
  });

  it("il capo d'inizio e quello di fine sono indipendenti, e la misura non passa dall'uno all'altro", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "end", size: "large" });
    given(opened, { end: "start", shape: "bar" });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "large"), end: "end" });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "medium"), end: "start" });
  });

  it("una parte già come si chiede non cambia, e il motore non ha niente da fare", () => {
    const opened = open(doc(DEFS(MARKER("ma", "triangle", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    for (const change of [{ end: "end", shape: "triangle" }, { end: "end", size: "large" }, { end: "start", shape: "none" }] as const) {
      const made = tipped(opened, change);
      expect(made.ops).toEqual([]);
      expect(made.changed).toBe(0);
      expect(made.keys).toEqual(["oa"]);
    }
  });

  it("si può dare due volte senza che cambi niente la seconda", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob", ` stroke="${BLUE}"`, 20) + "</g>"));
    given(opened, { end: "end", shape: "diamond" });
    const text = opened.engine.text;
    expect(tipped(opened, { end: "end", shape: "diamond" }).changed).toBe(0);
    expect(opened.engine.text).toBe(text);
  });

  it("una linea senza id ne riceve uno, in testa, e la selezione la ritrova", () => {
    const opened = open(doc(DEFS() + LAYER + '<line x1="0" y1="10" x2="50" y2="10" stroke="#d55e00"/>' + "</g>"));
    const unit = opened.index.units[0]!;
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.ops.map((op) => op.op)).toEqual(["ident", "add", "set"]);
    const set = made.ops[2] as SetOp;
    expect(made.keys).toEqual([set.id]);
    expect(made.keys[0]).not.toBe(unit.key);
    applied(opened, made.ops);
    expect(shown(opened, set.id, "end")).toMatchObject({ tip: tip("triangle") });
  });

  it("non tocca marker-mid", () => {
    const opened = open(doc(DEFS(MARKER("mm", "circle", "small", "end")) + LAYER + LINE("oa", ` stroke="${RED}" marker-mid="url(#mm)"`) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "none" });
    expect(made.ops).toEqual([]);
    for (const change of [{ end: "end", shape: "triangle" }, { swap: true }, { end: "start", shape: "bar" }] as const) {
      const done = tipped(opened, change);
      expect(sets(done.ops).every((op) => !("marker-mid" in op.attrs))).toBe(true);
    }
    given(opened, { end: "end", shape: "triangle" });
    expect(opened.engine.text).toContain('marker-mid="url(#mm)"');
    given(opened, { end: "end", shape: "none" });
    expect(opened.engine.text).toContain('marker-mid="url(#mm)"');
    expect(markersIn(opened)).toEqual(["mm"]);
  });

  it("un tracciato chiuso non ne riceve, ma se ne ha una la toglie", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "triangle", "medium", "end")) +
          LAYER +
          `<path id="oc" d="M0 0 L10 0 L10 10 Z" fill="none" stroke="${RED}"/>` +
          `<path id="ok" d="M0 20 L10 20 L10 30 Z" fill="none" stroke="${RED}"${ENDS(null, "ma")}/>` +
          "</g>",
      ),
    );
    const none = tipped(opened, { end: "end", shape: "none" });
    expect(none.changed).toBe(1);
    expect(sets(none.ops)).toEqual([{ op: "set", id: "ok", attrs: { "marker-end": null } }]);
    expect(tipped(opened, { end: "start", shape: "bar" }).changed).toBe(1);
    applied(opened, none.ops);
    expect(markersIn(opened)).toEqual([]);
    expect(looks(opened).count).toBe(0);
  });

  it("le forme che non hanno punte restano com'erano", () => {
    const opened = open(
      doc(
        DEFS() +
          LAYER +
          `<rect id="or" x="0" y="0" width="10" height="10" fill="none" stroke="${RED}"/>` +
          `<path id="oa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="${RED}" stroke-width="2"/>` +
          `<path id="oi" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="${RED}" fub:ink="${INK}"/>` +
          "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made).toMatchObject({ ops: [], changed: 0 });
    expect(made.keys).toEqual(opened.index.units.map((unit) => unit.key));
  });
});

describe("togliere, cambiare la misura, scambiare", () => {
  it("none toglie il riferimento, e il motore toglie il marcatore che nessuno usa più", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "medium", "end"), MARKER("mb", "triangle", "medium", "start")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("mb", "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "ma")}`, 20) + "</g>"),
    );
    const made = tipped(opened, { end: "end", shape: "none" });
    expect(made.ops).toEqual([
      { op: "set", id: "oa", attrs: { "marker-end": null } },
      { op: "set", id: "ob", attrs: { "marker-end": null } },
    ]);
    const text = applied(opened, made.ops);
    expect(text).not.toContain('id="ma"');
    expect(text).toContain('id="mb"');
    expect(text).toContain('marker-start="url(#mb)"');
    expect(text).not.toContain("marker-end");
  });

  it("none su un capo senza punta non scrive niente, neanche per un marcatore custom nominato altrove", () => {
    const opened = open(doc(DEFS(CUSTOM("cm")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("cm", null)}`) + "</g>"));
    expect(tipped(opened, { end: "end", shape: "none" }).ops).toEqual([]);
    const cleared = tipped(opened, { end: "start", shape: "none" });
    expect(sets(cleared.ops)).toEqual([{ op: "set", id: "oa", attrs: { "marker-start": null } }]);
  });

  it("la misura cambia le sole punte della raccolta, di quel capo, e le altre restano", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "triangle", "medium", "end"), MARKER("mb", "bar", "small", "start"), CUSTOM("cm")) +
          LAYER +
          LINE("oa", ` stroke="${RED}"${ENDS("mb", "ma")}`) +
          LINE("ob", undefined, 20) +
          LINE("oc", ` stroke="${RED}"${ENDS(null, "cm")}`, 30) +
          "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", size: "large" });
    expect(made.changed).toBe(1);
    expect(made.ops.map((op) => op.op)).toEqual(["add", "set"]);
    const text = applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "large") });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "small") });
    expect(usedBy(opened, "oc", "end")).toBe("cm");
    expect(usedBy(opened, "ob", "end")).toBeNull();
    expect(text).not.toContain('id="ma"');
    expect(tipped(opened, { end: "start", size: "small" }).changed).toBe(0);
  });

  it("scambia le due punte: la stessa forma e misura va sull'altro capo, nel suo marcatore", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "small", "start"), MARKER("mb", "bar", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", "mb")}`) + "</g>"),
    );
    const made = tipped(opened, { swap: true });
    expect(made.changed).toBe(1);
    expect(adds(made.ops)).toHaveLength(2);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "large"), end: "start", paint: RED });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "small"), end: "end", paint: RED });
    expect(markersIn(opened)).toHaveLength(2);
    expect(markersIn(opened)).not.toContain("ma");
    expect(markersIn(opened)).not.toContain("mb");
  });

  it("scambiando, una punta sola passa all'altro capo e il suo capo resta senza", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    const made = tipped(opened, { swap: true });
    expect(sets(made.ops)).toHaveLength(1);
    expect(sets(made.ops)[0]!.attrs["marker-end"]).toBeNull();
    applied(opened, made.ops);
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("diamond"), end: "start" });
    expect(usedBy(opened, "oa", "end")).toBeNull();
    expect(looks(opened)).toMatchObject({ start: { shape: "diamond" }, end: { shape: "none" } });
  });

  it("scambiando, un marcatore custom passa com'è, e due uguali non cambiano", () => {
    const opened = open(
      doc(
        DEFS(CUSTOM("cm"), MARKER("mb", "circle", "large", "end"), MARKER("mc", "circle", "large", "start")) +
          LAYER +
          LINE("oa", ` stroke="${RED}"${ENDS("cm", "mb")}`) +
          LINE("ob", ` stroke="${RED}"${ENDS(null, "cm")}`, 20) +
          LINE("oc", ` stroke="${RED}"${ENDS("mc", "mb")}`, 30) +
          "</g>",
      ),
    );
    const made = tipped(opened, { swap: true });
    // Le punte di `oc` sono uguali ai due capi: scambiate, restano quelle.
    expect(made.changed).toBe(2);
    applied(opened, made.ops);
    expect(usedBy(opened, "oa", "end")).toBe("cm");
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("circle", "large"), end: "start" });
    expect(usedBy(opened, "ob", "start")).toBe("cm");
    expect(usedBy(opened, "ob", "end")).toBeNull();
    expect(usedBy(opened, "oc", "start")).toBe("mc");
    expect(usedBy(opened, "oc", "end")).toBe("mb");
  });

  it("scambiare due volte riporta le punte dove erano", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "small", "start"), MARKER("mb", "bar", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", "mb")}`) + LINE("ob", ` stroke="${RED}"`, 20) + "</g>"),
    );
    const before = looks(opened);
    given(opened, { swap: true });
    expect(looks(opened)).not.toEqual(before);
    given(opened, { swap: true });
    expect(looks(opened)).toEqual(before);
  });
});

describe("dare le punte a un gruppo", () => {
  const GROUP = (inner: string, extra = ""): string => `<g id="og"${extra}>${inner}</g>`;

  it("passa il cambio alle parti, a ogni profondità, e non a quelle bloccate", () => {
    const opened = open(
      doc(
        DEFS() +
          LAYER +
          GROUP(
            LINE("oa") + LINE("ob", ` stroke="${RED}" fub:locked="true"`, 20) + `<g id="oi">${LINE("oc", ` stroke="${BLUE}"`, 30)}<rect id="or" x="0" y="0" width="5" height="5" fill="${RED}"/></g>`,
          ) +
          "</g>",
      ),
    );
    const group = opened.index.units.filter((unit) => unit.id === "og");
    expect(group).toHaveLength(1);
    const made = tipped(opened, { end: "end", shape: "vee" }, group);
    expect(made.changed).toBe(2);
    expect(made.keys).toEqual(["og"]);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("vee"), paint: RED });
    expect(shown(opened, "oc", "end")).toMatchObject({ tip: tip("vee"), paint: BLUE });
    expect(usedBy(opened, "ob", "end")).toBeNull();
  });

  it("il colore di una parte è quello del suo gruppo, se non ne ha uno suo", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(LINE("oa", ` stroke-width="2"`) + LINE("ob", ` stroke="${BLUE}"`, 20), ` stroke="${PINK}"`) + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: BLUE });
  });

  it("l'opacità del contorno si legge dal gruppo come il colore, e l'opacità della linea non conta", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(LINE("oa", ` stroke-width="2" opacity="0.2"`) + LINE("ob", ` stroke-opacity="0.75"`, 20), ` stroke="${PINK}" stroke-opacity="0.5"`) + "</g>"));
    given(opened, { end: "end", shape: "square" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK, opacity: 0.5 });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: PINK, opacity: 0.75 });
  });

  it("le parti di due gruppi annidati con lo stesso colore usano un marcatore solo", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(`<g id="oi" stroke="${RED}">${LINE("oa", "")}</g>${LINE("ob")}`) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(adds(made.ops)).toHaveLength(1);
    applied(opened, made.ops);
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
  });
});

describe("il colore di una punta", () => {
  /// Il marcatore che `tipOps` darebbe alla linea `oa` di un documento con `extra` e `defs`.
  function colorOf(extra: string, defs = ""): MarkerTip | null {
    const opened = open(doc(DEFS(defs) + LAYER + LINE("oa", extra) + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    return shown(opened, "oa", "end");
  }

  it("è quello dello stroke della linea, scritto in minuscolo, e non cambia con il riempimento", () => {
    expect(colorOf(' stroke="#D55E00" fill="#0072b2"')).toMatchObject({ paint: RED, opacity: 1 });
    expect(colorOf(' stroke="#0f0"')).toMatchObject({ paint: "#00ff00" });
    expect(colorOf(' stroke="red"')).toMatchObject({ paint: "#ff0000" });
  });

  it("con stroke none la punta c'è ma non si vede, e l'opacità non conta", () => {
    expect(colorOf(' stroke="none" stroke-opacity="0.4"')).toMatchObject({ paint: "none", opacity: 1 });
    expect(colorOf("")).toMatchObject({ paint: "none", opacity: 1 });
  });

  it("l'opacità del contorno va sulla punta", () => {
    expect(colorOf(` stroke="${RED}" stroke-opacity="0.5"`)).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(colorOf(` stroke="${RED}" stroke-opacity="0"`)).toMatchObject({ paint: RED, opacity: 0 });
    expect(colorOf(` stroke="${RED}" stroke-opacity="0.33333"`)).toMatchObject({ paint: RED, opacity: 0.3333 });
  });

  it("un campione del documento si scrive col suo colore, e la punta lo segue", () => {
    expect(colorOf(' stroke="url(#rs) #0072b2"', SWATCH("rs", BLUE))).toMatchObject({ paint: "url(#rs) #0072b2" });
  });

  it("una sfumatura dà il colore del vertice dove sta la punta", () => {
    const opened = open(doc(DEFS(RAMP("rg")) + LAYER + `<line id="oa" x1="0" y1="10" x2="100" y2="10" stroke="url(#rg)" stroke-width="2"/>` + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "start", shape: "triangle" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "oa", "start")).toMatchObject({ paint: RED });
  });

  it("una sfumatura che svanisce dà alla punta l'opacità che ha sul capo, per quella del contorno", () => {
    // Come la «Dissolvenza»: dal pieno al trasparente, e a metà strada.
    const FADE = (id: string): string =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${RED}" stop-opacity="0"/></linearGradient>`;
    const opened = open(
      doc(
        DEFS(FADE("rg")) +
          LAYER +
          `<line id="oa" x1="0" y1="10" x2="100" y2="10" stroke="url(#rg)" stroke-width="2"/>` +
          `<line id="ob" x1="0" y1="20" x2="50" y2="20" stroke="url(#rg)" stroke-opacity="0.5" stroke-width="2"/>` +
          "</g>",
      ),
    );
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "start", shape: "triangle" });
    expect(shown(opened, "oa", "start")).toMatchObject({ paint: RED, opacity: 1 });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED, opacity: 0 });
    expect(shown(opened, "ob", "start")).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: RED, opacity: 0.25 });
    expect(opened.engine.text).toContain('fill-opacity="0.25"');
  });

  it("il vertice è quello del capo anche per spezzate e tracciati, e l'ultimo se il tracciato si ripiega", () => {
    const opened = open(
      doc(
        DEFS(RAMP("rg"), CUSTOM("cm")) +
          LAYER +
          `<polyline id="op" points="0,0 50,10 100,0" fill="none" stroke="url(#rg)" stroke-width="2"/>` +
          `<path id="oq" d="M0 20 L100 20 L0 20" fill="none" stroke="url(#rg)" stroke-width="2"/>` +
          // Un poligono è chiuso: la fine torna al primo punto, come in SVG.
          `<polygon id="or" points="100,40 50,45 0,40" fill="none" stroke="url(#rg)" stroke-width="2"${ENDS("cm", "cm")}/>` +
          "</g>",
      ),
    );
    given(opened, { end: "end", shape: "circle" });
    given(opened, { end: "start", shape: "circle" });
    expect(shown(opened, "op", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "op", "start")).toMatchObject({ paint: RED });
    expect(shown(opened, "oq", "end")).toMatchObject({ paint: RED });
    expect(shown(opened, "oq", "start")).toMatchObject({ paint: RED });
    expect(shown(opened, "or", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "or", "start")).toMatchObject({ paint: BLUE });
  });

  it("un motivo, che non si sa calcolare, dà il ripiego, o il nero", () => {
    const pattern = '<pattern id="rp" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#d55e00"/></pattern>';
    expect(colorOf(' stroke="url(#rp) #cc79a7"', pattern)).toMatchObject({ paint: PINK });
    expect(colorOf(' stroke="url(#rp)"', pattern)).toMatchObject({ paint: "#000000" });
    expect(colorOf(' stroke="url(#rp) none"', pattern)).toMatchObject({ paint: "#000000" });
  });

  it("una sfumatura che non si calcola, come quella sul riquadro di una linea orizzontale, dà il ripiego o il nero", () => {
    const flat = '<linearGradient id="rf"><stop offset="0" stop-color="#d55e00"/><stop offset="1" stop-color="#0072b2"/></linearGradient>';
    expect(colorOf(' stroke="url(#rf) #cc79a7"', flat)).toMatchObject({ paint: PINK });
    expect(colorOf(' stroke="url(#rf)"', flat)).toMatchObject({ paint: "#000000" });
    expect(colorOf(' stroke="url(#rf) none"', flat)).toMatchObject({ paint: "#000000" });
  });
});

describe("le punte con lo stile", () => {
  const SOURCE = doc(
    DEFS(MARKER("mt", "triangle", "medium", "end"), MARKER("mc", "circle", "medium", "start"), CUSTOM("mx")) +
      LAYER +
      LINE("oa", ` stroke="${RED}" stroke-width="2"${ENDS("mc", "mt")}`) +
      LINE("ob", ` stroke="${BLUE}" stroke-width="2"`, 30) +
      LINE("oc", ` stroke="${RED}" stroke-width="2" marker-end="url(#mx)"`, 50) +
      `<rect id="or" x="0" y="60" width="10" height="10" fill="none" stroke="${RED}"/>` +
      `<text id="ot" x="0" y="80">Ciao</text>` +
      `<g id="og">${LINE("od", "", 90)}</g>` +
      "</g>",
  );
  const node = (opened: Opened, id: string) => opened.engine.holder(id)!;

  it("quelle di una parte: capo per capo, la forma e la misura, o nessuna, o altro", () => {
    const opened = open(SOURCE);
    const model = opened.engine.model!;
    expect(tipsStyleOf(model, node(opened, "oa"))).toEqual({ start: tip("circle"), end: tip("triangle") });
    expect(tipsStyleOf(model, node(opened, "ob"))).toEqual({ start: "none", end: "none" });
    expect(tipsStyleOf(model, node(opened, "oc"))).toEqual({ start: "none", end: null });
  });

  it("una parte che non può averne, e un gruppo, non hanno niente da dire", () => {
    const opened = open(SOURCE);
    const model = opened.engine.model!;
    for (const id of ["or", "ot", "og"]) expect(tipsStyleOf(model, node(opened, id)), id).toBeNull();
  });

  it("il Tipper dà gli attributi dei capi che lo stile dice, e lascia quelli che non dice", () => {
    const opened = open(SOURCE);
    const tipper = new Tipper(opened.engine.model!, ids(opened));
    const given = tipper.give(node(opened, "ob"), { start: tip("circle"), end: null })!;
    expect(Object.keys(given)).toEqual(["marker-start"]);
    // Il cerchio rosso del disegno ha un altro colore del contorno blu: uno nuovo.
    expect(given["marker-start"]).not.toBe("url(#mc)");
    expect(adds(tipper.ops())).toHaveLength(1);
    // Lo stesso, a una linea rossa: il marcatore del disegno.
    expect(tipper.give(node(opened, "oc"), { start: tip("circle"), end: "none" })).toEqual({ "marker-start": "url(#mc)", "marker-end": null });
    expect(adds(tipper.ops())).toHaveLength(1);
  });

  it("togliere una punta che non c'è, o dare quella che c'è già, non cambia niente", () => {
    const opened = open(SOURCE);
    const tipper = new Tipper(opened.engine.model!, ids(opened));
    expect(tipper.give(node(opened, "ob"), { start: "none", end: "none" })).toBeNull();
    expect(tipper.give(node(opened, "oa"), { start: tip("circle"), end: tip("triangle") })).toBeNull();
    expect(tipper.give(node(opened, "oa"), { start: null, end: null })).toBeNull();
    expect(tipper.ops()).toEqual([]);
  });

  it("e le parti che non possono averne non le ricevono: un rettangolo, un testo, un gruppo", () => {
    const opened = open(SOURCE);
    const tipper = new Tipper(opened.engine.model!, ids(opened));
    for (const id of ["or", "ot", "og"]) expect(tipper.give(node(opened, id), { start: tip("vee"), end: tip("vee") }), id).toBeNull();
    expect(tipper.ops()).toEqual([]);
  });

  it("senza una defs, la prima punta la crea; il Tipper dopo un'altra aggiunta può chiedere di non rifarla", () => {
    const opened = open(doc(LAYER + LINE("oa", "", 10) + "</g>"));
    const tipper = new Tipper(opened.engine.model!, ids(opened));
    tipper.give(node(opened, "oa"), { start: tip("bar"), end: tip("vee", "large") });
    const full = tipper.ops();
    expect(adds(full).map((op) => op.elem.tag)).toEqual(["defs", "marker", "marker"]);
    expect(adds(tipper.ops(false)).map((op) => op.elem.tag)).toEqual(["marker", "marker"]);
  });

  it("il Shelf dà lo stesso marcatore a chi lo chiede due volte, e quello del disegno se c'è", () => {
    const opened = open(SOURCE);
    const shelf = new Shelf(opened.engine.model!, ids(opened));
    expect(shelf.idFor(tip("triangle"), "end", { paint: RED, opacity: 1 })).toBe("mt");
    expect(shelf.ops()).toEqual([]);
    const blue = shelf.idFor(tip("triangle"), "end", { paint: BLUE, opacity: 1 });
    expect(blue).not.toBe("mt");
    expect(shelf.idFor(tip("triangle"), "end", { paint: BLUE, opacity: 1 })).toBe(blue);
    expect(shelf.idFor(tip("triangle"), "end", { paint: BLUE, opacity: 0.5 })).not.toBe(blue);
    expect(adds(shelf.ops())).toHaveLength(2);
  });
});
