// @vitest-environment happy-dom
// Il blocco sincronizzato dal lato dell'editor (E14, T30): le domande, il
// comando e la trasclusione scritta al posto del «/». La porta è finta: il
// comando vero lo provano `fub-features` (`sync_block_tests.rs`) e
// `tests/commands_e2e.rs`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const dialogs = vi.hoisted(() => ({ pickFromList: vi.fn() }));
vi.mock("../../../../../ui/dialogs", () => dialogs);

import { parsed } from "../test-support";
import { buildBlocks } from "./model";
import { stateOfSource, syncCandidates, syncedBlockHere, syncReference, syncWithQuestions, type SyncBlockPort } from "./sync-to";

const OTHER = "---\ntitolo: Riunione\n---\n# Riunione\n\nLe chiavi le tiene Sara.\n\n- Prima voce ^voce\n- Seconda voce\n\n```\ncodice\n```\n";

function port(overrides: Partial<SyncBlockPort> = {}): SyncBlockPort {
  return {
    notes: vi.fn(async () => [
      { id: "Mostra.md", title: "Mostra" },
      { id: "Riunioni/Riunione.md", title: "Riunione" },
    ]),
    source: vi.fn(async () => OTHER),
    sync: vi.fn(async () => null),
    giveId: vi.fn(async () => null),
    ...overrides,
  };
}

/// La scelta della persona nei due elenchi, in ordine.
function choose(...labels: (string | null)[]): void {
  for (const label of labels) {
    dialogs.pickFromList.mockImplementationOnce(async (spec: { items: { label: string; value: unknown }[] }) =>
      label === null ? null : spec.items.find((item) => item.label === label)!.value);
  }
}

function editor(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({ parent, state: EditorState.create({ doc }) });
}

afterEach(() => {
  dialogs.pickFromList.mockReset();
  document.body.replaceChildren();
});

describe("i blocchi che si sincronizzano", () => {
  it("niente proprietà né titoli; le voci con la loro prima riga, senza id", () => {
    const state = parsed(stateOfSource(OTHER));
    const labels = syncCandidates(state, buildBlocks(state).blocks).map((candidate) => candidate.label);
    expect(labels).toEqual(["Le chiavi le tiene Sara.", "Prima voce", "Seconda voce", "```"]);
    expect(syncReference("Riunioni/Riunione.md")).toBe("Riunioni/Riunione");
    expect(syncReference("Diario.markdown")).toBe("Diario");
  });
});

describe("«Sincronizza in un'altra nota»", () => {
  it("la nota scelta, fra le altre, e il comando coi byte del blocco", async () => {
    const sync = port();
    choose("Riunione");
    const notify = vi.fn();
    await syncWithQuestions(sync, "Mostra.md", () => ({ at: [3, 9], text: "Testo" }), notify);
    const items = dialogs.pickFromList.mock.calls[0]![0].items as { label: string }[];
    expect(items.map((item) => item.label)).toEqual(["Riunione"]);
    expect(sync.sync).toHaveBeenCalledWith({ doc: "Mostra.md", at: [3, 9], text: "Testo", to: "Riunioni/Riunione.md" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("la nota cambiata mentre si sceglie: non si scrive niente, e lo dice", async () => {
    const sync = port();
    choose("Riunione");
    const notify = vi.fn();
    await syncWithQuestions(sync, "Mostra.md", () => null, notify);
    expect(sync.sync).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("La nota è cambiata mentre sceglievi: non si è scritto niente.", "guasto");
  });

  it("il comando che rifiuta lo dice con la sua frase", async () => {
    const sync = port({ sync: vi.fn(async () => "la nota «Riunione» è cambiata") });
    choose("Riunione");
    const notify = vi.fn();
    await syncWithQuestions(sync, "Mostra.md", () => ({ at: [0, 1], text: "x" }), notify);
    expect(notify).toHaveBeenCalledWith("Il blocco non si è sincronizzato: la nota «Riunione» è cambiata", "guasto");
  });
});

describe("«Blocco di un'altra nota» dal «/»", () => {
  const host = (notify = vi.fn()) => ({ doc: "Mostra.md", writable: () => true, notify });

  it("l'id al blocco nell'altra nota, poi la trasclusione al posto del «/»", async () => {
    const view = editor("Prima.\n\n/blocco\n\nDopo.\n");
    const sync = port();
    choose("Riunione", "Le chiavi le tiene Sara.");
    const from = "Prima.\n\n".length;
    expect(await syncedBlockHere(view, from, from + "/blocco".length, sync, host())).toBe(true);
    const giveId = vi.mocked(sync.giveId).mock.calls[0]![0];
    expect(giveId.doc).toBe("Riunioni/Riunione.md");
    expect(giveId.text).toBe("Le chiavi le tiene Sara.");
    expect(new TextEncoder().encode(OTHER).slice(giveId.at[0], giveId.at[1])).toEqual(new TextEncoder().encode(giveId.text));
    expect(view.state.doc.toString()).toBe(`Prima.\n\n![[Riunioni/Riunione#^${giveId.id}]]\n\nDopo.\n`);
  });

  it("il blocco che ha già il suo id lo tiene", async () => {
    const view = editor("/b");
    const sync = port();
    choose("Riunione", "Prima voce");
    expect(await syncedBlockHere(view, 0, 2, sync, host())).toBe(true);
    expect(vi.mocked(sync.giveId).mock.calls[0]![0].id).toBe("voce");
    expect(view.state.doc.toString()).toBe("![[Riunioni/Riunione#^voce]]\n\n");
  });

  it("l'id che non si scrive lascia la nota com'era, e lo dice", async () => {
    const view = editor("/b\n");
    const notify = vi.fn();
    const sync = port({ giveId: vi.fn(async () => "la nota «Riunione» è cambiata") });
    choose("Riunione", "Seconda voce");
    expect(await syncedBlockHere(view, 0, 2, sync, host(notify))).toBe(false);
    expect(view.state.doc.toString()).toBe("/b\n");
    expect(notify).toHaveBeenCalledWith("Il blocco non si è sincronizzato: la nota «Riunione» è cambiata");
  });

  it("il «/» segue il testo scritto mentre si sceglie", async () => {
    const view = editor("Testo\n\n/b\n");
    let release!: () => void;
    const sync = port({ giveId: vi.fn(() => new Promise<null>((resolve) => { release = () => resolve(null); })) });
    choose("Riunione", "Prima voce");
    const done = syncedBlockHere(view, 7, 9, sync, host());
    await vi.waitFor(() => expect(sync.giveId).toHaveBeenCalled());
    view.dispatch({ changes: { from: 0, insert: "Sopra.\n\n" } });
    release();
    expect(await done).toBe(true);
    expect(view.state.doc.toString()).toBe("Sopra.\n\nTesto\n\n![[Riunioni/Riunione#^voce]]\n\n");
  });

  it("la nota che non si scrive più alla fine: niente trasclusione, e lo dice", async () => {
    const view = editor("/b\n");
    const notify = vi.fn();
    let writable = true;
    let release!: () => void;
    const sync = port({ giveId: vi.fn(() => new Promise<null>((resolve) => { release = () => resolve(null); })) });
    choose("Riunione", "Seconda voce");
    const done = syncedBlockHere(view, 0, 2, sync, { doc: "Mostra.md", writable: () => writable, notify });
    await vi.waitFor(() => expect(sync.giveId).toHaveBeenCalled());
    writable = false;
    release();
    expect(await done).toBe(false);
    expect(view.state.doc.toString()).toBe("/b\n");
    expect(notify).toHaveBeenCalledWith("Questa nota ora si legge soltanto: il blocco di «Riunione» non è stato messo qui.");
  });

  it("una nota senza blocchi lo dice; chiudere la scelta non scrive niente", async () => {
    const notify = vi.fn();
    const empty = port({ source: vi.fn(async () => "# Solo un titolo\n") });
    choose("Riunione");
    expect(await syncedBlockHere(editor("/b"), 0, 2, empty, host(notify))).toBe(false);
    expect(notify).toHaveBeenCalledWith("«Riunione» non ha blocchi da sincronizzare: scegli un'altra nota.");
    const sync = port();
    choose("Riunione", null);
    const view = editor("/b");
    expect(await syncedBlockHere(view, 0, 2, sync, host())).toBe(false);
    expect(sync.giveId).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("/b");
  });
});
