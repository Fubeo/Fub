// @vitest-environment happy-dom
// La tela su file CRLF e con BOM (#97): le modifiche fatte sulla tela vera non
// spariscono, la sessione le accetta, il file tiene i suoi terminatori e il
// suo BOM, e l'annulla torna alla lavagna di prima. I byte esatti di ogni
// modifica sono nei vettori (`src/__fixtures__/canvas-patches/46-*`…`61-*`).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { CanvasEngine, type CanvasChange } from "./engine";
import type { CanvasDocument } from "./model";
import { canvasCoreReady, openCoreNow } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

const LF = '{\n  "nodes": [\n    {"id":"a","type":"text","x":0,"y":0,"width":200,"height":100,"text":"uno"},\n    {"id":"b","type":"text","x":300,"y":0,"width":200,"height":100,"text":"due"}\n  ],\n  "edges": [\n    {"id":"e","fromNode":"a","toNode":"b"}\n  ]\n}\n';
const VARIANTS: Record<string, string> = {
  LF,
  CRLF: LF.replace(/\n/g, "\r\n"),
  BOM: `﻿${LF}`,
  "BOM+CRLF": `﻿${LF.replace(/\n/g, "\r\n")}`,
};

/** La lavagna di un testo come la legge il nucleo, con le chiavi in ordine. */
function model(text: string): string {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return JSON.stringify(sorted(core.model()));
  } finally {
    core.close();
  }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function nodes(text: string): CanvasDocument["nodes"] {
  return (JSON.parse(model(text)) as CanvasDocument).nodes;
}

function mount(original: string): { engine: CanvasEngine; host: HTMLElement; changes: CanvasChange[] } {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "canvas-a",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "board.canvas",
    onChange: (change: CanvasChange) => changes.push(change),
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onCreateNote: () => {},
    media: { openExternal: () => {} },
    renderMarkdownForCard: () => () => {},
  } as never);
  engine.setDoc(original);
  return { engine, host, changes };
}

function key(host: HTMLElement, name: string): void {
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

// Ogni gesto sulla tela vera, e che cosa deve aver fatto.
const GESTURES: Record<string, { run: (host: HTMLElement) => void; check: (text: string) => void }> = {
  "sposta una card": {
    // Il primo ArrowRight sceglie la prima scheda, il secondo la sposta.
    run: (host) => { key(host, "ArrowRight"); key(host, "ArrowRight"); },
    check: (text) => expect(nodes(text)[0]!.x).toBe(8),
  },
  "aggiunge una card": {
    run: (host) => host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click(),
    check: (text) => expect(nodes(text)).toHaveLength(3),
  },
  "toglie un arco e una card": {
    run: (host) => { key(host, "ArrowRight"); key(host, "Delete"); },
    check: (text) => {
      expect(nodes(text).map((node) => node.id)).toEqual(["b"]);
      expect((JSON.parse(model(text)) as CanvasDocument).edges).toEqual([]);
    },
  },
};

async function session(original: string): Promise<DocumentSessionCollection> {
  const api: DocumentSessionApi = {
    readDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text", text_kind: "source" }),
    openDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text", text_kind: "source" }),
    documentClosed: async () => {},
    writeDocument: async () => ({ revision: "rev-2" }) as never,
    resourceWrite: async () => { throw new Error("non a byte"); },
    saveDraft: async () => {},
    discardDraft: async () => {},
  };
  const sessions = new DocumentSessionCollection(api);
  await sessions.read("board.canvas");
  return sessions;
}

/** Il file tiene il BOM e i terminatori di `original`, senza mescolarli. */
function keepsTheFile(text: string, original: string): void {
  expect(text.startsWith("﻿")).toBe(original.startsWith("﻿"));
  if (original.includes("\r\n")) expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  else expect(text).not.toContain("\r");
}

describe("la tela su CRLF e BOM", () => {
  for (const [variant, original] of Object.entries(VARIANTS)) {
    for (const [name, gesture] of Object.entries(GESTURES)) {
      it(`${variant}: ${name}, la sessione accetta e il file tiene terminatori e BOM; l'annulla torna al modello di prima`, async () => {
        const timer = vi.spyOn(window, "setTimeout").mockImplementation(() => 1);
        const { engine, host, changes } = mount(original);
        try {
          const sessions = await session(original);
          gesture.run(host);
          expect(changes).toHaveLength(1);
          const change = changes[0]!;
          gesture.check(change.text);
          expect(change.text).toBe(engine.getDoc());
          expect(sessions.acceptSurfaceChange("board.canvas", "canvas-a", change)).toEqual({ kind: "accepted" });
          expect(sessions.inspect("board.canvas")).toMatchObject({ text: change.text, dirty: true });
          keepsTheFile(change.text, original);
          // L'annulla: una card tolta torna come oggetto, non con gli spazi
          // che aveva; il modello è quello di prima, e il file non mescola
          // terminatori.
          expect(engine.undo()).toBe(true);
          expect(changes).toHaveLength(2);
          const back = changes[1]!;
          expect(model(back.text)).toBe(model(original));
          keepsTheFile(back.text, original);
          expect(sessions.acceptSurfaceChange("board.canvas", "canvas-a", back)).toEqual({ kind: "accepted" });
        } finally {
          engine.destroy();
          host.remove();
          timer.mockRestore();
        }
      });
    }

    it(`${variant}: una superficie pari riceve l'operazione e il testo`, () => {
      const left = mount(original);
      const right = mount(original);
      try {
        GESTURES["sposta una card"]!.run(left.host);
        const change = left.changes[0]!;
        right.engine.syncDoc(change);
        expect(right.engine.getDoc()).toBe(change.text);
        expect(nodes(right.engine.getDoc())[0]!.x).toBe(8);
      } finally {
        for (const side of [left, right]) {
          side.engine.destroy();
          side.host.remove();
        }
      }
    });
  }
});
