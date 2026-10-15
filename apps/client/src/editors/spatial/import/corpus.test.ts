// L'importazione sui file veri: i disegni di Excalidraw e di draw.io di
// `__fixtures__/import/` (da dove vengono e con che licenza, nel suo
// NOTICE) diventano disegni che si aprono, si modificano e si leggono come
// gli altri, e ognuno diventa quello che dice il suo `.atteso.txt`: quanti
// oggetti per genere, le note di ciò che non entra e gli oggetti a parole,
// come li dice l'albero degli oggetti.
//
// Le prove non hanno il browser che disegna le immagini: un'immagine che va
// ridisegnata, come un SVG, qui resta fuori e il file atteso ne ha la nota,
// mentre nell'app entra.
//
// Riscrivere i file attesi dopo aver cambiato l'importazione:
//
//   npx vitest run src/editors/spatial/import/corpus -u
//
// e poi si guarda il diff: è il disegno che cambia.

import { describe, expect, it } from "vitest";
import { describe as say, outline, type OutlineNode } from "../describe";
import { SceneEngine } from "../scene/engine";
import { isNewId, type IdKind } from "../scene/ids";
import { auditScene, isEditable, readScene } from "../scene/read";
import { boardsOf } from "../tools/boards";
import { NewIds } from "../tools/edit";
import { followEffects } from "../tools/effects";
import { followLabels } from "../tools/labels";
import { estimate } from "../tools/measure";
import { followTips } from "../tools/tips";
import { readDiagram, sourceOf, writeImported, type Imported } from "./index";
import { testSetup } from "./test-support";

const FILES = import.meta.glob(["../../../__fixtures__/import/*.excalidraw", "../../../__fixtures__/import/*.drawio", "../../../__fixtures__/import/*.xml"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// I file del corpus, per nome.
const CORPUS: ReadonlyArray<readonly [name: string, text: string]> = Object.entries(FILES)
  .map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text] as const)
  .sort(([a], [b]) => (a < b ? -1 : 1));

/// Il genere di un id nuovo dalla sua prima lettera.
const KIND: Readonly<Record<string, IdKind>> = { o: "object", l: "layer", r: "resource", b: "board", c: "paper" };

/// Gli id di tutti gli elementi di un file.
const idsOf = (text: string): string[] => [...text.matchAll(/ id="([^"]+)"/g)].map((found) => found[1]!);

/// L'albero degli oggetti a parole, un oggetto per riga, rientrato per livello.
function words(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth)}${say(node, { parts: true })}`, ...words(node.children, depth + 1)]);
}

/// Il disegno che `name` diventa, scritto come lo scrive l'editor.
async function importOnce(name: string, text: string): Promise<Imported> {
  const diagram = await readDiagram(name, new TextEncoder().encode(text));
  return writeImported(diagram, testSetup(name), null);
}

const DONE = new Map<string, Promise<Imported>>();

/// Il disegno che `name` diventa, scritto una volta per tutte le prove.
function imported(name: string, text: string): Promise<Imported> {
  let done = DONE.get(name);
  if (done === undefined) {
    done = importOnce(name, text);
    DONE.set(name, done);
  }
  return done;
}

/// Ciò che dice il file atteso: i conteggi, le note e il disegno a parole.
function summary(name: string, done: Imported): string {
  const engine = SceneEngine.open(done.text);
  const { count, notes } = done;
  const boards = boardsOf(engine.model!).map((board) => board.name);
  return [
    `File: ${name}`,
    `Oggetti: ${count.objects} (forme ${count.shapes}, testi ${count.texts}, linee ${count.lines}, tratti ${count.ink}, immagini ${count.images})`,
    `Livelli: ${count.layers}, tavole: ${count.boards}`,
    `Note: ${notes.length === 0 ? "nessuna" : notes.map((note) => `${note.kind} ×${note.count}${note.sample === "" ? "" : ` (${note.sample})`}`).join("; ")}`,
    "",
    ...words(outline(readScene(engine.text).items)),
    ...(boards.length === 0 ? [] : ["", ...boards.map((board) => `Tavola «${board}»`)]),
    "",
  ].join("\n");
}

describe("il corpus dell'importazione", () => {
  it("ha file di tutti e due i programmi, almeno otto per ciascuno", () => {
    const excalidraw = CORPUS.filter(([name]) => sourceOf(name) === "excalidraw");
    const drawio = CORPUS.filter(([name]) => sourceOf(name) !== "excalidraw");
    expect(excalidraw.length).toBeGreaterThanOrEqual(8);
    expect(drawio.length).toBeGreaterThanOrEqual(8);
  });

  for (const [name, text] of CORPUS) {
    describe(name, () => {
      it("diventa quello che dice il suo file atteso", async () => {
        const done = await imported(name, text);
        await expect(summary(name, done)).toMatchFileSnapshot(`../../../__fixtures__/import/${name}.atteso.txt`);
      });

      it("si apre come un disegno modificabile, e il motore non ne cambia il testo", async () => {
        const { text: drawing } = await imported(name, text);
        expect(isEditable(readScene(drawing))).toBe(true);
        const engine = SceneEngine.open(drawing);
        expect(engine.status).toBe("fubdraw");
        expect(engine.text).toBe(drawing);
        expect(drawing.endsWith("\n")).toBe(true);
        expect(drawing).not.toContain("\r");
      });

      it("ha id nuovi senza doppi, e ogni riferimento porta a un id che c'è", async () => {
        const { text: drawing } = await imported(name, text);
        const ids = idsOf(drawing).filter((found) => found !== "fub-paper" && found !== "fub-defs");
        expect(new Set(ids).size).toBe(ids.length);
        for (const found of ids) {
          const kind = KIND[found.slice(0, 1)];
          expect(kind === undefined ? false : isNewId(found, kind), found).toBe(true);
        }
        const known = new Set(idsOf(drawing));
        const references = [
          ...[...drawing.matchAll(/fub:(?:from|to)="(\S+) \S+"/g)].map((found) => found[1]!),
          ...[...drawing.matchAll(/fub:(?:inside|along)="(\S+?)(?: [^"]*)?"/g)].map((found) => found[1]!),
          ...[...drawing.matchAll(/url\(#([^)]+)\)/g)].map((found) => found[1]!),
        ];
        for (const reference of references) expect(known.has(reference), reference).toBe(true);
      });

      it("non lascia niente da rimettere a posto alle etichette, alle punte e agli effetti", async () => {
        const { text: drawing } = await imported(name, text);
        const engine = SceneEngine.open(drawing);
        const model = engine.model!;
        const find = (found: string) => engine.holder(found);
        const touched = new Set(idsOf(drawing));
        expect(followLabels(model, touched, find, estimate)).toBeNull();
        expect(followTips(model, touched, new NewIds((found) => find(found) !== null), find)).toBeNull();
        expect(followEffects(model, touched, find, estimate)).toBeNull();
      });

      it("la lettura del disegno non trova errori né avvisi", async () => {
        const { text: drawing } = await imported(name, text);
        const { scene } = auditScene(drawing);
        expect(scene.diagnostics.filter((diagnostic) => diagnostic.severity !== "info")).toEqual([]);
      });

      it("importato due volte, è lo stesso testo", async () => {
        const first = await imported(name, text);
        const second = await importOnce(name, text);
        expect(second.text).toBe(first.text);
      });
    });
  }
});
