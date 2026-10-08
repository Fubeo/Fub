import { describe, expect, it } from "vitest";
import {
  ALONG_DECIMALS,
  ANCHORS,
  CONNECTOR_KINDS,
  MAX_ELBOW_POINTS,
  SIDES,
  connectorAttrs,
  connectorPath,
  connectorSegments,
  parseConnectorKind,
  readConnectorEnd,
  readConnectorGeom,
  readLabelPlace,
  writeConnectorEnd,
  writeConnectorGeom,
  writeLabelPlace,
  type ConnectorGeom,
} from "./connectors";
import { escapeAttribute } from "./serialize";
import { at, doc, load, role } from "./test-support";
import cases from "../../../__fixtures__/scene-connectors/cases.json";

/// Il valore di un attributo scritto con gli escape di §7: tabulazioni e a
/// capo restano quelli che sono, e non diventano spazi.
const attribute = escapeAttribute;

/// Un percorso di `cases.json` come `ConnectorGeom`.
const geomOf = (value: { readonly kind: string; readonly points: readonly (readonly number[])[] }): ConnectorGeom => {
  const kind = parseConnectorKind(value.kind);
  if (kind === null) throw new Error(`tipo sconosciuto: ${value.kind}`);
  return { kind, points: value.points.map(([x, y]) => [x!, y!] as const) };
};

describe("la geometria dei connettori", () => {
  it("i casi sono tanti quanti il formato ne chiede", () => {
    const valid = (rows: readonly { readonly read: unknown }[]): number => rows.filter((row) => row.read !== null).length;
    expect(valid(cases.geom)).toBeGreaterThanOrEqual(12);
    expect(cases.geom.length - valid(cases.geom)).toBeGreaterThanOrEqual(15);
    expect(valid(cases.end)).toBeGreaterThanOrEqual(6);
    expect(cases.end.length - valid(cases.end)).toBeGreaterThanOrEqual(8);
    expect(valid(cases.along)).toBeGreaterThanOrEqual(6);
    expect(cases.along.length - valid(cases.along)).toBeGreaterThanOrEqual(12);
  });

  for (const { text, read } of cases.geom) {
    const shown = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    it(`fub:geom=${JSON.stringify(shown)} ${read === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readConnectorGeom(text)).toEqual(read);
    });
  }

  it("un gomito ha da due a sessantaquattro vertici", () => {
    const elbow = (count: number): string => `elbow${Array.from({ length: count }, (_, i) => ` ${i} ${i % 2}`).join("")}`;
    expect(MAX_ELBOW_POINTS).toBe(64);
    expect(readConnectorGeom(elbow(1))).toBeNull();
    expect(readConnectorGeom(elbow(2))!.points).toHaveLength(2);
    expect(readConnectorGeom(elbow(MAX_ELBOW_POINTS))!.points).toHaveLength(64);
    expect(readConnectorGeom(elbow(MAX_ELBOW_POINTS + 1))).toBeNull();
  });

  it("il tipo si scrive esatto", () => {
    expect(CONNECTOR_KINDS).toEqual(["straight", "elbow", "curved"]);
    for (const kind of CONNECTOR_KINDS) expect(parseConnectorKind(kind)).toBe(kind);
    for (const refused of ["", "Elbow", "elbow ", "arrow", "line", "constructor", "toString"]) {
      expect(parseConnectorKind(refused), refused).toBeNull();
    }
  });

  for (const { geom, text, d } of cases.write) {
    it(`si scrive ${JSON.stringify(text)}`, () => {
      const input = geomOf(geom);
      expect(writeConnectorGeom(input)).toBe(text);
      // Scritta a due decimali, la geometria si rilegge uguale a sé stessa.
      const again = readConnectorGeom(text)!;
      expect(again.kind).toBe(input.kind);
      expect(again.points).toHaveLength(input.points.length);
      expect(writeConnectorGeom(again)).toBe(text);
      expect(connectorPath(input)).toBe(d);
      // Il `d` si rigenera uguale da `fub:geom`.
      expect(connectorAttrs(input)).toEqual({ "fub:geom": text, d });
      expect(connectorPath(again)).toBe(d);
    });
  }

  it("il d di una linea dritta o a gomito è M e L, quello di una curva M e C", () => {
    expect(connectorPath({ kind: "straight", points: [[0, 0], [100, 50]] })).toBe("M0 0 L100 50");
    expect(connectorPath({ kind: "elbow", points: [[0, 0], [50, 0], [50, 80], [120, 80]] })).toBe("M0 0 L50 0 L50 80 L120 80");
    expect(connectorPath({ kind: "curved", points: [[0, 0], [40, 0], [60, 100], [100, 100]] })).toBe("M0 0 C40 0 60 100 100 100");
    expect(connectorSegments({ kind: "curved", points: [[0, 0], [40, 0], [60, 100], [100, 100]] })).toEqual([
      { kind: "move", to: [0, 0] },
      { kind: "cubic", c1: [40, 0], c2: [60, 100], to: [100, 100] },
    ]);
  });

  it("il d si calcola dalla geometria com'è scritta, non da quella in memoria", () => {
    // 0,004 si scrive 0: il `d` è quello che si rigenera da `fub:geom`.
    const geom: ConnectorGeom = { kind: "straight", points: [[0.004, 0.004], [10.006, 5]] };
    const attrs = connectorAttrs(geom);
    expect(attrs).toEqual({ "fub:geom": "straight 0 0 10.01 5", d: "M0 0 L10.01 5" });
    expect(connectorPath(readConnectorGeom(attrs["fub:geom"])!)).toBe(attrs.d);
  });
});

describe("gli agganci dei connettori", () => {
  for (const { text, read } of cases.end) {
    it(`l'aggancio ${JSON.stringify(text)} ${read === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readConnectorEnd(text)).toEqual(read);
    });
  }

  it("ogni aggancio si scrive e si rilegge", () => {
    expect(ANCHORS).toEqual(["auto", "center", "top", "right", "bottom", "left"]);
    expect(SIDES).toEqual(["top", "right", "bottom", "left"]);
    for (const anchor of ANCHORS) {
      const end = { id: "o3c4d5e6f", anchor };
      expect(writeConnectorEnd(end)).toBe(`o3c4d5e6f ${anchor}`);
      expect(readConnectorEnd(writeConnectorEnd(end))).toEqual(end);
    }
  });
});

describe("l'etichetta di un connettore", () => {
  for (const { text, read } of cases.along) {
    it(`fub:along=${JSON.stringify(text)} ${read === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readLabelPlace(text)).toEqual(read);
    });
  }

  it("t si scrive con quattro decimali e sta fra 0 e 1", () => {
    expect(ALONG_DECIMALS).toBe(4);
    expect(writeLabelPlace({ id: "c1", t: 0.123456, offset: 3.456 })).toBe("c1 0.1235 3.46");
    expect(writeLabelPlace({ id: "c1", t: 0.5, offset: -12 })).toBe("c1 0.5 -12");
    expect(writeLabelPlace({ id: "c1", t: 1.5, offset: 0 })).toBe("c1 1 0");
    expect(writeLabelPlace({ id: "c1", t: -0.2, offset: 0 })).toBe("c1 0 0");
    expect(writeLabelPlace({ id: "c1", t: 0.99996, offset: 0 })).toBe("c1 1 0");
    // Quel che si scrive si rilegge.
    for (const t of [0, 0.00004, 0.3333333, 0.5, 0.99996, 1, 7, -3]) {
      const written = writeLabelPlace({ id: "c1", t, offset: 1.005 });
      const place = readLabelPlace(written);
      expect(place, written).not.toBeNull();
      expect(place!.t).toBeGreaterThanOrEqual(0);
      expect(place!.t).toBeLessThanOrEqual(1);
    }
  });
});

describe("i connettori nella scena", () => {
  it("un connettore vuole la grammatica intera o è un tracciato", () => {
    for (const { text, read } of cases.geom) {
      const scene = load(doc(`<path fub:shape="connector" fub:geom="${attribute(text)}" d="M0 0 L10 10"/>`));
      const item = at(scene, [0])!;
      if (read === null) {
        expect(item.role, text).toBe("path");
        expect(item.connector, text).toBeUndefined();
      } else {
        expect(item.role, text).toBe("connector");
        expect(item.connector!.geom, text).toEqual(read);
        expect(item.connector!.from).toBeNull();
        expect(item.connector!.to).toBeNull();
      }
    }
  });

  it("senza la forma, o con un'altra, è un tracciato", () => {
    const scene = load(
      doc(
        '<path fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>' +
          '<path fub:shape="Connector" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>' +
          '<path fub:shape="connector" d="M0 0 L10 10"/>' +
          '<path fub:shape="arrow" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>' +
          '<path fub:shape="connector" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>',
      ),
    );
    for (const index of [0, 1, 2, 3]) {
      expect(role(scene, [index]), String(index)).toBe("path");
      expect(at(scene, [index])!.connector).toBeUndefined();
    }
    expect(role(scene, [4])).toBe("connector");
  });

  it("un capo fuori grammatica resta libero, l'altro si legge", () => {
    for (const { text, read } of cases.end) {
      const scene = load(
        doc(`<path fub:shape="connector" fub:geom="straight 0 0 10 10" fub:from="${attribute(text)}" fub:to="r2 left" d="M0 0 L10 10"/>`),
      );
      const item = at(scene, [0])!;
      expect(item.role, text).toBe("connector");
      expect(item.connector!.from, text).toEqual(read);
      expect(item.connector!.to).toEqual({ id: "r2", anchor: "left" });
    }
  });

  it("un'etichetta fuori grammatica non si usa", () => {
    for (const { text, read } of cases.along) {
      const scene = load(doc(`<text fub:along="${attribute(text)}" x="5" y="5"><tspan x="5" dy="0">Sì</tspan></text>`));
      const item = at(scene, [0])!;
      expect(item.role, text).toBe("text");
      expect(item.along, text).toEqual(read === null ? undefined : read);
    }
    // Un testo su tracciato può essere l'etichetta di un connettore.
    const along = load(
      doc('<defs id="d"><path id="r1" d="M0 0 L50 0"/></defs><text fub:along="c1 0.5 4"><textPath href="#r1">Su</textPath></text>'),
    );
    expect(at(along, [1])!.along).toEqual({ id: "c1", t: 0.5, offset: 4 });
  });

  it("il connettore conta fra le forme e ha il riquadro di d", () => {
    const scene = load(
      doc(
        '<rect id="a" x="0" y="0" width="10" height="10" fill="#cccccc"/>' +
          '<path id="c" fub:shape="connector" fub:geom="elbow 10 5 60 5 60 90 100 90" fub:from="a right" d="M10 5 L60 5 L60 90 L100 90" fill="none" stroke="#000000" stroke-width="2"/>' +
          '<path id="p" fub:shape="connector" fub:geom="straight 0 0" d="M0 0 L5 5"/>',
      ),
    );
    expect(scene.summary.counts.shapes).toBe(3);
    expect(role(scene, [1])).toBe("connector");
    expect(role(scene, [2])).toBe("path");
    expect(scene.summary.bbox).toEqual({ x: 0, y: 0, width: 100, height: 90 });
  });
});
