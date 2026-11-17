// @vitest-environment happy-dom
//
// La rinomina dal titolo riscrive l'H1 ripiegato solo nella superficie della
// nota rinominata (T7, revisione #421): superfici vere, montate nello stesso
// riquadro come le schede di una lavagna, di altri documenti restano intatte.
import { afterEach, describe, expect, it } from "vitest";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";
import { retitleIn } from "./page/title";

const mounted: MarkdownSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
  document.body.replaceChildren();
});

function surfaceIn(pane: HTMLElement, documentId: string, text: string): MarkdownSurface {
  const parent = document.createElement("div");
  pane.append(parent);
  const surface = mountMarkdownSurface({ paneId: `riquadro-${mounted.length}`, documentId, parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  surface.buffer.setDoc(text);
  mounted.push(surface);
  return surface;
}

describe("la rinomina dal titolo e le altre superfici del riquadro", () => {
  it("rinominata una nota, solo la sua superficie riscrive l'H1; una scheda-file di un'altra nota no", () => {
    const pane = document.createElement("div");
    document.body.append(pane);
    const renamed = surfaceIn(pane, "Progetto.md", "# Progetto\n\nIl testo.\n");
    const card = surfaceIn(pane, "Riunioni.md", "# Progetto\n\nLe riunioni.\n");
    retitleIn(pane, { from: "Progetto.md", to: "Piano.md" }, "Progetto", "Piano");
    expect(renamed.buffer.getDoc()).toBe("# Piano\n\nIl testo.\n");
    expect(card.buffer.getDoc()).toBe("# Progetto\n\nLe riunioni.\n");
  });

  it("rinominata una lavagna, le sue schede non si toccano: né una scheda-file né una scheda di testo", () => {
    const pane = document.createElement("div");
    document.body.append(pane);
    const file = surfaceIn(pane, "Riunioni.md", "# Progetto\n\nLe riunioni.\n");
    const text = surfaceIn(pane, "Progetto.canvas#card-surface-1", "# Progetto\n\nUna scheda.\n");
    retitleIn(pane, { from: "Progetto.canvas", to: "Piano.canvas" }, "Progetto", "Piano");
    expect(file.buffer.getDoc()).toBe("# Progetto\n\nLe riunioni.\n");
    expect(text.buffer.getDoc()).toBe("# Progetto\n\nUna scheda.\n");
  });
});
