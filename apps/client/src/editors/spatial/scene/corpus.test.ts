// SVG veri, scritti da altri programmi: si leggono senza perdere un byte. Sono
// i casi di `crates/fub-scene/tests/corpus.rs`, sugli stessi file: quelli di
// `crates/fub-scene/tests/corpus/` (Mermaid, Chromium, Inkscape, Illustrator)
// e l'icona di `apps/clipper`. Si leggono da dove stanno, col `?raw` di Vite,
// senza copiarli: una copia potrebbe divergere dall'originale che Rust legge.

import { describe, expect, it } from "vitest";
import type { Scene } from "./read";
import { load } from "./test-support";
import ICON from "../../../../../../apps/clipper/icons/icon.svg?raw";
import FLOWCHART from "../../../../../../crates/fub-scene/tests/corpus/mermaid-flowchart.svg?raw";
import SEQUENCE from "../../../../../../crates/fub-scene/tests/corpus/mermaid-sequence.svg?raw";
import CHROMIUM from "../../../../../../crates/fub-scene/tests/corpus/chromium.svg?raw";
import INKSCAPE from "../../../../../../crates/fub-scene/tests/corpus/inkscape.svg?raw";
import ILLUSTRATOR from "../../../../../../crates/fub-scene/tests/corpus/illustrator.svg?raw";

const CORPUS: ReadonlyArray<[string, string]> = [
  ["icon", ICON],
  ["mermaid-flowchart", FLOWCHART],
  ["mermaid-sequence", SEQUENCE],
  ["chromium", CHROMIUM],
  ["inkscape", INKSCAPE],
  ["illustrator", ILLUSTRATOR],
];

/// Un percorso come lo scrive `{:?}` di Rust: `[0, 1]`.
function debug(path: readonly number[]): string {
  return `[${path.join(", ")}]`;
}

/// Una riga per voce: il tipo, dove sta e che cosa è.
function describeScene(scene: Scene): string[] {
  return scene.items.map((item) => {
    switch (item.kind) {
      case "root":
        return "root";
      case "element":
        return `${debug(item.path)} ${item.role}`;
      case "foreign":
        return item.parentPath === null
          ? `document foreign ${debug(item.elements)}`
          : `${debug(item.parentPath)} foreign ${debug(item.elements)}`;
    }
  });
}

/// I testi dell'indice di un file.
function texts(scene: Scene): string[] {
  return scene.index.texts.map((t) => t.text);
}

describe("il corpus di SVG scritti da altri", () => {
  it("i file arrivano coi loro byte, senza BOM né CRLF", () => {
    for (const [name, source] of CORPUS) {
      expect(source.length, name).toBeGreaterThan(0);
      expect(source.charCodeAt(0), name).not.toBe(0xfeff);
      expect(source.includes("\r"), name).toBe(false);
    }
  });

  it("ogni file si legge senza perdite, anche col BOM e con CRLF", () => {
    for (const [name, source] of CORPUS) {
      const scene = load(source);
      const shape = describeScene(scene);
      // Lo stesso file con il BOM e con CRLF: stesse voci, altri byte.
      for (const variant of [`\u{feff}${source}`, source.replaceAll("\n", "\r\n")]) {
        const other = load(variant);
        expect(describeScene(other), name).toEqual(shape);
        expect(other.readOnly, name).toEqual(scene.readOnly);
      }
    }
  });

  it("l'icona è tutta modificabile", () => {
    const scene = load(ICON);
    expect(scene.status).toBe("foreign");
    expect(scene.readOnly).toEqual([]);
    expect(describeScene(scene)).toEqual(["root", "[0] rect", "[1] path", "[2] circle"]);
    // Non ha un titolo: l'icona di un'estensione non ne ha bisogno, un
    // disegno sì.
    expect(scene.diagnostics.map((d) => d.code)).toEqual(["S001"]);
    // Il rettangolo arrotondato contiene il resto.
    const summary = scene.summary;
    expect(summary.counts.shapes).toBe(3);
    const bbox = summary.bbox!;
    expect([bbox.x, bbox.y, bbox.width, bbox.height]).toEqual([14, 14, 100, 100]);
  });

  it("un'esportazione del browser tiene ciò che si può modificare", () => {
    const scene = load(CHROMIUM);
    expect(scene.status).toBe("foreign");
    expect(scene.readOnly).toEqual([]);
    expect(describeScene(scene)).toEqual([
      "root",
      "[0] title",
      "[1] desc",
      "[] foreign [2, 5]",
      "[5] group",
      "[5] foreign [0, 1]",
      "[5, 1] polyline",
      // Il `text` ha un `dy` in `em`: estraneo, insieme ai due `use`,
      // all'`a` verso un sito e al `foreignObject`.
      "[] foreign [6, 11]",
      "[11] image",
      "[] foreign [12, 13]",
      "[13] circle",
    ]);
  });

  it("un file di Inkscape tiene i livelli come gruppi", () => {
    const scene = load(INKSCAPE);
    expect(scene.status).toBe("foreign");
    expect(scene.readOnly).toEqual([]);
    expect(describeScene(scene)).toEqual([
      "document foreign [0, 0]",
      "root",
      "[0] title",
      "[] foreign [1, 3]",
      "[3] group",
      "[3] foreign [0, 1]",
      "[4] group",
      "[4] foreign [0, 1]",
      "[4, 1] circle",
      "[4] foreign [2, 4]",
      "[4, 4] group",
      "[4, 4, 0] rect",
      "[4, 4] foreign [1, 2]",
      "[4] foreign [5, 6]",
      "[4, 6] image",
      "[] foreign [5, 7]",
    ]);
  });

  it("un file di Illustrator risolve le sue entità e resta in sola lettura", () => {
    const scene = load(ILLUSTRATOR);
    expect(scene.status).toBe("foreign");
    expect(scene.readOnly).toEqual(["doctype"]);
    expect(describeScene(scene)).toEqual([
      "document foreign [0, 0]",
      "root",
      "[] foreign [0, 3]",
      "[3] group",
      "[3] foreign [0, 1]",
      "[3, 1] rect",
    ]);
    expect(scene.diagnostics.some((d) => d.code === "S008")).toBe(true);
  });

  it("i diagrammi di Mermaid sono per lo più estranei, e interi", () => {
    for (const source of [FLOWCHART, SEQUENCE]) {
      const scene = load(source);
      expect(scene.status).toBe("foreign");
      expect(scene.readOnly).toEqual([]);
    }
    // Il diagramma di flusso: lo stile, un gruppo di soli estranei (nodi,
    // archi, etichette in XHTML), poi i marcatori.
    expect(describeScene(load(FLOWCHART))).toEqual([
      "root",
      "[] foreign [0, 1]",
      "[1] group",
      "[1] foreign [0, 13]",
      "[] foreign [2, 4]",
    ]);
    // Il diagramma di sequenza: i riquadri dei partecipanti, ognuno un gruppo
    // senza attributi con un rettangolo e un testo che usano `class`, poi
    // linee di vita, frecce e messaggi.
    const expected = ["root"];
    for (let i = 0; i < 10; i++) expected.push(`[${i}] group`, `[${i}] foreign [0, 2]`);
    expected.push("[] foreign [10, 11]", "[11] group", "[] foreign [12, 39]");
    expect(describeScene(load(SEQUENCE))).toEqual(expected);
  });

  it("l'indice legge anche i file estranei", () => {
    // Ciò che FubDraw non modifica si cerca lo stesso.
    let scene = load(CHROMIUM);
    expect(scene.index.title!.text).toBe("Pianta del giardino");
    expect(scene.index.desc!.text).toBe("Aiuole & sentieri, disegnati a mano");
    // Lo spazio indivisibile resta: non è uno spazio XML.
    expect(texts(scene)).toEqual(["Giardini <pubblici>  — “guida”", "Riga uno Riga due"]);
    // Le righe di Inkscape sono `tspan` con `sodipodi:role="line"`.
    scene = load(INKSCAPE);
    expect(scene.index.title!.text).toBe("Giardino");
    expect(texts(scene)).toEqual(["Aiuola delle rose e dei gerani", "Da potare in marzo"]);
    // Illustrator: il riferimento a carattere è risolto, il titolo manca.
    scene = load(ILLUSTRATOR);
    expect(scene.index.title).toBeNull();
    expect(texts(scene)).toEqual(["Etichetta — prova"]);
    expect(scene.diagnostics.some((d) => d.code === "S001")).toBe(true);
    // Le etichette del diagramma di flusso sono XHTML, non `text`; quelle
    // del diagramma di sequenza sì: i partecipanti due volte, poi i messaggi.
    expect(load(FLOWCHART).index.texts).toEqual([]);
    const found = texts(load(SEQUENCE));
    expect(found).toHaveLength(18);
    expect(found[0]).toBe("Provider");
    expect(found[17]).toBe("payload IPC");
  });
});
