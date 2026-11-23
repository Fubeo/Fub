// @vitest-environment happy-dom
// La Struttura del finto del banco segue il documento davanti, con la regola
// del provider `outline` (`fub-features/src/outline.rs`, provata da
// `crates/fub-features/tests/outline_view_e2e.rs`): i titoli della nota, lo
// stato vuoto davanti a un PDF o alle sue annotazioni, mai i titoli di
// un'altra nota.
import { beforeAll, describe, expect, it } from "vitest";
import type { UiNode, ViewContext } from "../src/host/contract";

type FakeIpc = typeof import("./fake-ipc");

let ipc: FakeIpc;

beforeAll(async () => {
  // Il vault del PDF annotato: il contratto, le sue annotazioni e le note.
  window.history.replaceState(null, "", "/index.html?pdf-scena=annotato");
  ipc = await import("./fake-ipc");
});

const front = (doc: string | null): ViewContext => ({ pane: "main", doc, selections: null, mode: "live_preview" });

/// Le voci dell'albero, coi rientri dei figli.
function labels(node: UiNode, depth = 0): string[] {
  if (node.node === "tree_item") return [`${"  ".repeat(depth)}${node.label}`, ...node.children.flatMap((child) => labels(child, depth + 1))];
  if (node.node === "tree") return node.roots.flatMap((root) => labels(root, depth));
  if (node.node === "stack") return node.children.flatMap((child) => labels(child, depth));
  return [];
}

/// I titoli delle sezioni e degli stati vuoti.
function titles(node: UiNode): string[] {
  if (node.node === "empty_state" || node.node === "section") return [node.title];
  if (node.node === "stack") return node.children.flatMap(titles);
  return [];
}

const outline = () => ipc.api.renderView("outline");

describe("la Struttura del finto", () => {
  it("senza un documento davanti dice che nessuna nota è aperta", async () => {
    const tree = await outline();
    expect(tree).toEqual({ node: "empty_state", title: "Nessuna nota aperta.", detail: null, action: null });
  });

  it("mostra i titoli della nota davanti, annidati per livello, e chi la cita", async () => {
    expect(await ipc.api.setActiveContext(front("Guida/Sintassi di Fub.md"))).toContain("outline");
    const tree = await outline();
    expect(labels(tree).slice(0, 7)).toEqual([
      "Sintassi di Fub",
      "  Titoli",
      "    Terzo livello",
      "      Quarto livello",
      "        Quinto livello",
      "          Sesto livello",
      "  Testo",
    ]);
    expect(titles(tree)).toEqual(["In entrata · 2"]);
  });

  it("davanti a un PDF o alle sue annotazioni è lo stato vuoto, non i titoli della nota di prima", async () => {
    for (const doc of ["Casa/contratto-affitto.pdf", "Casa/contratto-affitto.pdf.fubann"]) {
      await ipc.api.setActiveContext(front("Benvenuto.md"));
      expect(labels(await outline())).toEqual(["Benvenuto in Fub"]);
      expect(await ipc.api.setActiveContext(front(doc)), doc).toContain("outline");
      expect(await outline(), doc).toEqual({ node: "empty_state", title: "Nessun heading.", detail: null, action: null });
    }
  });

  it("non si dichiara vecchia se il documento davanti resta lo stesso", async () => {
    await ipc.api.setActiveContext(front("Benvenuto.md"));
    expect(await ipc.api.setActiveContext(front("Benvenuto.md"))).not.toContain("outline");
  });
});
