import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { doc } from "../scene/test-support";
import { transform as parseTransform } from "../scene/values";
import { NewIds } from "./edit";
import { labelledPair, labelOf } from "./label-hosts";
import { blockMiddle, followLabels, labelFrame, labelOps, LABEL_PAD } from "./labels";
import { textRich } from "./look";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";
import { applied, attrOf } from "./tip-support";

/// Il motore di `body`, dentro il primo livello, con le etichette che
/// seguono le forme, come lo installa l'editor.
function sheet(body: string): Opened {
  const opened = open(doc(`${LAYER}${body}</g>`));
  opened.engine.follow = (model, touched, op) => followLabels(model, touched, (id) => opened.engine.holder(id), estimate, op);
  return opened;
}

const node = (opened: Opened, id: string) => {
  const found = opened.engine.holder(id);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  return found;
};

const RECT = '<rect id="r" x="100" y="100" width="200" height="120" fill="#e69f00"/>';

/// Un'etichetta come la scrive l'editor, ancora da mettere al suo posto.
const LABEL = (text: string, inside = "r", id = "t"): string =>
  `<text id="${id}" fub:inside="${inside}" fub:wrap="188" x="0" y="0" font-size="16" text-anchor="middle" transform="matrix(1 0 0 1 0 0)"><tspan x="0" dy="0">${text}</tspan></text>`;

/// La trasformazione scritta dell'elemento `id`.
function matrixOf(opened: Opened, id: string): readonly number[] {
  const written = attrOf(opened, id, "transform");
  const m = written === null ? [1, 0, 0, 1, 0, 0] : parseTransform(written);
  if (m === null) throw new Error(`trasformazione illeggibile: ${written}`);
  return m;
}

/// Le righe del testo `id`.
const linesOf = (opened: Opened, id: string): string[] => textRich(node(opened, id))!.lines.map((line) => line.spans.map((span) => span.text).join(""));

describe("dove sta l'etichetta", () => {
  it("il riquadro gira con la forma e non si specchia", () => {
    const opened = open(doc(`${LAYER}${RECT}</g>`));
    const shape = node(opened, "r");
    const turned = labelFrame(shape, [0, 1, -1, 0, 0, 0])!;
    expect(turned.angle).toBeCloseTo(90, 9);
    expect(turned.centre[0]).toBeCloseTo(-160, 9);
    expect(turned.width).toBeCloseTo(200, 9);
    // Specchiato in orizzontale: le righe restano dritte.
    expect(labelFrame(shape, [-1, 0, 0, 1, 0, 0])!.angle).toBeCloseTo(0, 9);
    expect(labelFrame(shape, [2, 0, 0, 1, 0, 0])!.width).toBeCloseTo(400, 9);
  });

  it("il mezzo delle righe va dalla cima della prima al fondo dell'ultima", () => {
    const opened = open(doc(`${LAYER}<text id="t" x="0" y="0" font-size="20"><tspan x="0" dy="0">Uno</tspan><tspan x="0" dy="25">Due</tspan></text></g>`));
    expect(blockMiddle(textRich(node(opened, "t"))!)).toBeCloseTo((-16 + 25 + 5) / 2, 9);
    const empty = open(doc(`${LAYER}<text id="t" x="0" y="0" font-size="20"><tspan x="0" dy="0"></tspan></text></g>`));
    expect(blockMiddle(textRich(node(empty, "t"))!)).toBeCloseTo(-5.5, 9);
  });
});

describe("le etichette seguono le forme", () => {
  /// Il centro della prima riga di `t` nella scena, a metà fra la cima delle
  /// maiuscole e il fondo: per un testo di una riga, il centro del blocco.
  const centreOf = (opened: Opened): [number, number] => {
    const m = matrixOf(opened, "t");
    const mid = -4.4;
    return [m[2]! * mid + m[4]!, m[3]! * mid + m[5]!];
  };

  it("cambiata la forma, l'etichetta torna al centro, nello stesso passo", () => {
    const opened = sheet(`<g id="g">${RECT}${LABEL("Processo")}</g>`);
    applied(opened, { op: "set", id: "r", attrs: { fill: "#56b4e9" } });
    const [x, y] = centreOf(opened);
    expect(x).toBeCloseTo(200, 3);
    expect(y).toBeCloseTo(160, 3);
    expect(attrOf(opened, "t", "fub:wrap")).toBe(String(200 - 2 * LABEL_PAD));
  });

  it("spostando il gruppo l'etichetta non si riscrive", () => {
    const opened = sheet(`<g id="g">${RECT}${LABEL("Processo")}</g>`);
    applied(opened, { op: "set", id: "r", attrs: { fill: "#56b4e9" } });
    const before = attrOf(opened, "t", "transform");
    const out = opened.engine.apply({ op: "set", id: "g", attrs: { transform: "matrix(1 0 0 1 40 30)" } });
    expect(out.outcome).toBe("applied");
    expect(attrOf(opened, "t", "transform")).toBe(before);
  });

  it("la forma spostata o girata da sola porta con sé l'etichetta, dritta", () => {
    const opened = sheet(`<g id="g">${RECT}${LABEL("Processo")}</g>`);
    applied(opened, { op: "set", id: "r", attrs: { transform: "matrix(0 1 -1 0 400 0)" } });
    // Il centro (200, 160) girato di un quarto: (240, 200).
    const m = matrixOf(opened, "t");
    expect(m[0]).toBeCloseTo(0, 4);
    expect(m[1]).toBeCloseTo(1, 4);
    expect(m[4]! - 4.4 * m[2]!).toBeCloseTo(240, 3);
    expect(m[5]! - 4.4 * m[3]!).toBeCloseTo(200, 3);
    // Largo quanto il lato che le righe seguono.
    expect(attrOf(opened, "t", "fub:wrap")).toBe("188");
  });

  it("una forma più stretta fa andare a capo l'etichetta, e il blocco resta al centro", () => {
    const opened = sheet(`<g id="g">${RECT}${LABEL("uno due tre quattro")}</g>`);
    applied(opened, { op: "set", id: "r", attrs: { width: "96" } });
    expect(attrOf(opened, "t", "fub:wrap")).toBe("84");
    const lines = linesOf(opened, "t");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("uno due tre quattro");
    const rich = textRich(node(opened, "t"))!;
    const m = matrixOf(opened, "t");
    expect(m[5]! + blockMiddle(rich)).toBeCloseTo(160, 3);
    expect(m[4]!).toBeCloseTo(148, 3);
  });

  it("l'etichetta spostata da sola si stacca; tolta la forma, anche", () => {
    const moved = sheet(`<g id="g">${RECT}${LABEL("Processo")}</g>`);
    applied(moved, { op: "set", id: "t", attrs: { transform: "matrix(1 0 0 1 10 10)" } });
    expect(attrOf(moved, "t", "fub:inside")).toBeNull();
    expect(attrOf(moved, "t", "transform")).toBe("matrix(1 0 0 1 10 10)");
    const removed = sheet(`<g id="g">${RECT}${LABEL("Processo")}</g>`);
    applied(removed, { op: "remove", target: "r" });
    expect(attrOf(removed, "t", "fub:inside")).toBeNull();
  });

  it("le etichette della scena del banco di fedeltà sono già dove le mette FubDraw", () => {
    const opened = open(FIDELITY.find((scene) => scene.id === "etichette")!.text);
    const shapes = ["r1", "e1", "r2", "p1"];
    for (const id of shapes) expect(labelOf(node(opened, id))).not.toBeNull();
    expect(followLabels(opened.engine.model!, new Set(shapes), (id) => opened.engine.holder(id), estimate)).toBeNull();
  });

  it("un testo che nomina una forma senza esserne l'etichetta resta com'è, se nessuno lo tocca", () => {
    const opened = sheet(`${RECT}${LABEL("Fuori")}<rect id="o" x="0" y="0" width="5" height="5"/>`);
    applied(opened, { op: "set", id: "o", attrs: { fill: "#000000" } });
    expect(attrOf(opened, "t", "fub:inside")).toBe("r");
    expect(followLabels(opened.engine.model!, new Set(["o"]), (id) => opened.engine.holder(id), estimate)).toBeNull();
  });

  it("un'etichetta in un livello o in un gruppo bloccato non si riscrive, per quanto la forma sia cambiata", () => {
    // Come lo installa l'editor, ma il livello (o il gruppo) è bloccato.
    const closed = (layer: string, group: string): Opened => {
      const opened = open(doc(`<g id="l1" fub:layer="Livello 1"${layer}><g id="g"${group}>${RECT}${LABEL("Processo")}</g></g>`));
      opened.engine.follow = (model, touched, op) => followLabels(model, touched, (id) => opened.engine.holder(id), estimate, op);
      return opened;
    };
    const follows = (opened: Opened): unknown => followLabels(opened.engine.model!, new Set(["r"]), (id) => opened.engine.holder(id), estimate);
    // L'etichetta scritta ha ancora la trasformazione di prima: nessuno l'ha messa al centro.
    const stale = 'transform="matrix(1 0 0 1 0 0)"';
    // Senza blocco il seguito la riscriverebbe: il confronto che dà senso agli altri.
    expect(follows(closed("", ""))).not.toBeNull();
    for (const [layer, group] of [[' fub:locked="true"', ""], ["", ' fub:locked="true"']] as const) {
      const opened = closed(layer, group);
      expect(follows(opened), `${layer}${group}`).toBeNull();
      // Il motore non scrive la forma, e l'etichetta resta com'era scritta.
      const before = opened.engine.text;
      const out = opened.engine.apply({ op: "set", id: "r", attrs: { width: "96" } });
      expect(out.outcome, `${layer}${group}`).toBe("rejected");
      expect(opened.engine.text).toBe(before);
      expect(opened.engine.text).toContain(stale);
      expect(attrOf(opened, "t", "fub:wrap")).toBe("188");
    }
    // Sbloccato il livello e cambiata la forma nello stesso passo, l'etichetta la segue.
    const opened = closed(' fub:locked="true"', "");
    applied(opened, [{ op: "set", id: "l1", attrs: { "fub:locked": null } }, { op: "set", id: "r", attrs: { width: "96" } }]);
    expect(attrOf(opened, "t", "fub:wrap")).toBe("84");
  });
});

describe("dare un'etichetta", () => {
  it("una forma del livello entra in un gruppo nuovo con la sua etichetta, al centro", () => {
    const opened = sheet(RECT);
    const unit = opened.index.units.find((each) => each.id === "r")!;
    const draft = { attrs: { fill: "#000000", "font-size": "16" }, inherited: {}, lines: [{ attrs: { dy: "0" }, spans: [{ text: "Inizio", attrs: null }] }] };
    const made = labelOps(opened.engine.model!, unit, draft, estimate, new NewIds((id) => opened.engine.holder(id) !== null))!;
    applied(opened, made.ops);
    const group = node(opened, made.keys[0]!);
    const pair = labelledPair(group)!;
    expect(pair.shape).toBe(node(opened, "r"));
    expect(textRich(pair.label)!.attrs["text-anchor"]).toBe("middle");
    expect(textRich(pair.label)!.attrs["fub:wrap"]).toBe("188");
    const m = parseTransform(textRich(pair.label)!.attrs.transform!)!;
    expect(m[4]).toBeCloseTo(200, 3);
    expect(m[5]! - 4.4).toBeCloseTo(160, 3);
    // Una forma che ha già la sua etichetta non ne riceve un'altra.
    const again = opened.reindex().units.find((each) => each.key === made.keys[0])!;
    expect(labelOps(opened.engine.model!, again, draft, estimate, new NewIds(() => false))).toBeNull();
  });

  it("una forma che sta già in un gruppo la riceve accanto, e resta scelta", () => {
    const opened = sheet(`<g id="g">${RECT}<rect id="o" x="0" y="0" width="5" height="5"/></g>`);
    const scoped = opened.reindex(node(opened, "g") as never);
    const unit = scoped.units.find((each) => each.id === "r")!;
    const draft = { attrs: { "font-size": "16" }, inherited: {}, lines: [{ attrs: { dy: "0" }, spans: [{ text: "Sì", attrs: null }] }] };
    const made = labelOps(opened.engine.model!, unit, draft, estimate, new NewIds((id) => opened.engine.holder(id) !== null))!;
    applied(opened, made.ops);
    expect(made.keys).toEqual(["r"]);
    const label = labelOf(node(opened, "r"))!;
    expect(label.parent).toBe(node(opened, "g"));
    expect(opened.engine.text.indexOf('id="r"')).toBeLessThan(opened.engine.text.indexOf("fub:inside"));
    expect(opened.engine.text.indexOf("fub:inside")).toBeLessThan(opened.engine.text.indexOf('id="o"'));
  });
});
