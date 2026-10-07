// I vettori di prova delle operazioni (`__fixtures__/scene-ops/`): oracoli
// scritti a mano, non generati dal motore che verificano. Ogni vettore dà il
// testo di partenza, le operazioni e l'esito atteso dell'ultima; il test
// controlla l'esito e le invarianti di §6 di
// `docs/reference/scene-operations.md`, la pagina dei `§` qui sotto:
//
// 1. la `TextOperation` porta il testo di prima, a LF, in quello di dopo;
// 2. il testo di dopo, riletto, dà la scena che il motore ha in memoria;
// 3. il testo grezzo è quello atteso, byte per byte, terminatori compresi;
//
// e in più che la `DocumentSession` accetta la modifica, che l'undo torna al
// testo di prima byte per byte, che il redo torna a quello di dopo e che
// l'inversa si applica anche su un motore aperto dal solo testo di dopo.

import { describe, expect, it, vi } from "vitest";
import { tryApplyOperation, type TextEdit } from "../../core/text-operation";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import type { DocumentSource } from "../../../host/contract";
import { SceneEngine, type Applied, type Outcome } from "./engine";
import { parseWireOp, type Op, type Reason } from "./ops";
import { readScene } from "./read";
import { normalizeEol } from "./text";

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly input: string;
  readonly ops: readonly Op[];
  readonly expect: {
    readonly outcome: "applied" | "rejected";
    /// Il testo grezzo di dopo.
    readonly text?: string;
    readonly reason?: Reason;
    readonly index?: number;
    readonly duplicate?: boolean;
    readonly inverse?: Op;
    /// Le modifiche sul testo a LF, dove §6 ne fissa la forma.
    readonly edits?: readonly TextEdit[];
    /// Il testo che l'inversa dà su un motore aperto dal testo di dopo, se
    /// non è quello di partenza.
    readonly inverseText?: string;
  };
}

const files = import.meta.glob("../../../__fixtures__/scene-ops/*.json", {
  import: "default",
  eager: true,
}) as Record<string, Vector>;

const vectors = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, vector]) => vector);

function applied(outcome: Outcome): Applied {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.reason} (${outcome.detail})`);
  return outcome;
}

/// Una collezione di sessioni che legge `text` per ogni documento.
function sessionsWith(text: string): DocumentSessionCollection {
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (): Promise<DocumentSource> => ({ text, revision: "rev-1", format_id: "svg", source_kind: "text" })),
    writeDocument: vi.fn(async () => "rev-2"),
    resourceWrite: vi.fn(async () => ({ revision: "rev-byte" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
  };
  return new DocumentSessionCollection(api);
}

describe("i vettori delle operazioni", () => {
  it("ci sono i 49 vettori di §9, in ordine", () => {
    expect(vectors.map((v) => v.name)).toEqual([
      "add-first-stroke",
      "add-last-in-layer",
      "add-after-anchor",
      "add-to-self-closing-group",
      "remove-middle",
      "remove-last-line",
      "remove-with-foreign-neighbors",
      "set-transform",
      "set-null-removes-attr",
      "set-on-foreign",
      "text-lines-emoji",
      "move-z-order",
      "move-to-other-layer",
      "move-into-descendant",
      "batch-group",
      "batch-partial-failure",
      "duplicate-id-identical",
      "duplicate-id-different",
      "locked-layer",
      "crlf-input",
      "bom-input",
      "paper-is-locked",
      "unknown-fub-attr-preserved",
      "inkscape-attr-preserved",
      "network-stroke-d-recomputed",
      "mixed-eol",
      "page-grow",
      "meta-title",
      "adopt-foreign",
      "ident-then-set",
      "remove-foreign-by-path",
      "set-self-closing-group",
      "first-under-root",
      "text-inherited-size",
      "root-units-guides",
      "root-guides-remove",
      "root-guides-invalid",
      "root-units-other-prefix",
      "root-other-attr",
      "locked-group",
      "locked-group-add",
      "locked-object-unlock",
      "add-raw-foreign",
      "add-raw-sequence",
      "add-raw-duplicate-id",
      "text-runs",
      "text-runs-canonical",
      "text-runs-foreign-piece",
      "add-text-runs",
    ]);
  });

  for (const vector of vectors) {
    describe(vector.name, () => {
      it("le operazioni hanno la forma della rete", () => {
        for (const op of vector.ops) expect(parseWireOp(op)).toEqual({ op });
      });

      it(vector.description, () => {
        const engine = SceneEngine.open(vector.input);
        for (const op of vector.ops.slice(0, -1)) applied(engine.apply(op));
        const before = engine.text;
        const outcome = engine.apply(vector.ops[vector.ops.length - 1]!);

        if (vector.expect.outcome === "rejected") {
          expect(outcome).toMatchObject({ outcome: "rejected", reason: vector.expect.reason });
          expect(outcome.outcome === "rejected" ? outcome.index : undefined).toBe(vector.expect.index);
          expect(engine.text).toBe(before);
          expect(engine.scene()).toEqual(readScene(before).items);
          return;
        }

        const out = applied(outcome);
        expect(out.text).toBe(vector.expect.text);
        expect(engine.text).toBe(out.text);
        expect(out.duplicate).toBe(vector.expect.duplicate ?? false);
        if (vector.expect.inverse !== undefined) expect(out.inverse).toEqual(vector.expect.inverse);
        if (vector.expect.edits !== undefined) expect(out.operation.edits).toEqual(vector.expect.edits);

        // 1: la `TextOperation` sul testo a LF.
        expect(tryApplyOperation(normalizeEol(before), out.operation)).toEqual({ kind: "applied", text: normalizeEol(out.text) });
        expect(engine.normalized).toBe(normalizeEol(out.text));
        // 2: la scena in memoria è quella che il lettore ricava dal testo.
        expect(engine.scene()).toEqual(readScene(out.text).items);

        // L'undo esatto torna ai byte di prima, il redo a quelli di dopo.
        const undone = applied(engine.undo(out.undo));
        expect(undone.text).toBe(before);
        expect(tryApplyOperation(normalizeEol(out.text), undone.operation)).toEqual({ kind: "applied", text: normalizeEol(before) });
        expect(engine.scene()).toEqual(readScene(before).items);
        const redone = applied(engine.undo(undone.undo));
        expect(redone.text).toBe(out.text);
        expect(engine.scene()).toEqual(readScene(out.text).items);

        // L'inversa vale anche su un motore che conosce solo il testo di dopo.
        const fresh = SceneEngine.open(out.text);
        const inverse = applied(fresh.apply(out.inverse));
        expect(inverse.text).toBe(vector.expect.inverseText ?? before);
        expect(fresh.scene()).toEqual(readScene(inverse.text).items);
      });

      if (vector.expect.outcome === "applied") {
        it("la DocumentSession accetta la modifica e conserva il testo grezzo", async () => {
          const engine = SceneEngine.open(vector.input);
          let out: Applied | null = null;
          for (const op of vector.ops) out = applied(engine.apply(op));
          const sessions = sessionsWith(vector.input);
          await sessions.read("disegno.svg");
          // Fra le operazioni il testo intermedio non passa dalla sessione:
          // ogni vettore ha un'operazione sola, o un `batch`.
          expect(vector.ops).toHaveLength(1);
          expect(sessions.acceptSurfaceChange("disegno.svg", "scena", { text: out!.text, operation: out!.operation })).toEqual({
            kind: "accepted",
          });
          expect(sessions.text("disegno.svg")).toBe(vector.expect.text);
        });
      }
    });
  }
});
