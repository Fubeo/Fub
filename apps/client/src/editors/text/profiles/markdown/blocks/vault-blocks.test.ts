// @vitest-environment happy-dom
// `[[^^parole` (E13, T31) dopo la scelta: un blocco della nota aperta, una
// nota che si legge soltanto, un blocco cambiato, il punto sparito. La porta
// è finta; la scelta col menu vero la prova `completions.dom.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo, history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { blocksOfNotes, linkVaultBlock, type VaultBlockPort } from "./vault-blocks";

const RIUNIONE = "# Riunione\n\n## Chiavi\n\nLe chiavi le tiene Sara.\n\n- Chiavi di riserva ^riserva\n  - Nel cassetto\n- Altro\n";

function port(overrides: Partial<VaultBlockPort> = {}): VaultBlockPort {
  return {
    notes: vi.fn(async () => []),
    current: () => "Diario.md",
    source: vi.fn(async () => RIUNIONE),
    giveId: vi.fn(async () => null),
    notify: vi.fn(),
    ...overrides,
  };
}

function editor(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({ parent, state: EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), history()] }) });
}

const writable = { name: "Riunione", writable: () => true };

afterEach(() => document.body.replaceChildren());

describe("i blocchi trovati", () => {
  it("tutte le parole nel testo proprio del blocco, senza accenti né maiuscole; i figli no, l'id no", () => {
    const hits = blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "CHIAVI", 50);
    expect(hits.map((hit) => hit.label)).toEqual(["Le chiavi le tiene Sara.", "Chiavi di riserva"]);
    expect(blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "riserva cassetto", 50)).toEqual([]);
    expect(blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "riserva", 50)[0]!.own).toBe("- Chiavi di riserva");
    expect(blocksOfNotes([{ doc: "Città.md", text: "La città è là.\n" }], "citta LA", 50)).toHaveLength(1);
    expect(blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "chiavi", 1)).toHaveLength(1);
  });
});

describe("la scelta di un blocco", () => {
  it("un blocco della nota aperta: l'id e il link in un passo, annullati insieme", async () => {
    const here = "Le chiavi le tiene Sara.\n\nvedi [[^^sara";
    const view = editor(here);
    const [hit] = blocksOfNotes([{ doc: "Diario.md", text: here }], "sara", 50);
    const ports = port();
    const from = here.indexOf("^^");
    expect(await linkVaultBlock(view, ports, hit!, { from, to: here.length }, writable)).toBe(true);
    const text = view.state.doc.toString();
    const id = /\[\[#\^([a-z0-9]{6})\]\]$/.exec(text)![1];
    expect(text).toBe(`Le chiavi le tiene Sara. ^${id}\n\nvedi [[#^${id}]]`);
    expect(ports.giveId).not.toHaveBeenCalled();
    expect(ports.source).not.toHaveBeenCalled();
    undo(view);
    expect(view.state.doc.toString()).toBe(here);
  });

  it("una nota che si legge soltanto: l'id non entra, e si offre il link alla sezione", async () => {
    const view = editor("vedi [[^^sara");
    const [hit] = blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "sara", 50);
    const ports = port({ giveId: vi.fn(async () => ({ reason: "permesso negato", readOnly: true })) });
    expect(await linkVaultBlock(view, ports, hit!, { from: 7, to: 13 }, writable)).toBe(false);
    expect(view.state.doc.toString()).toBe("vedi [[^^sara");
    const notify = vi.mocked(ports.notify);
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, action] = notify.mock.calls[0]!;
    expect(message).toBe("«Riunione» si legge soltanto: il blocco non può ricevere l'id che serve al link.");
    expect(action!.label).toBe("Link alla sezione");
    action!.run();
    expect(view.state.doc.toString()).toBe("vedi [[Riunione#Chiavi]]");
  });

  it("un blocco prima di ogni titolo, in sola lettura: il link alla nota", async () => {
    const source = "Le chiavi le tiene Sara.\n";
    const view = editor("[[^^sara");
    const [hit] = blocksOfNotes([{ doc: "Riunione.md", text: source }], "sara", 50);
    const ports = port({ source: async () => source, giveId: async () => ({ reason: "no", readOnly: true }) });
    await linkVaultBlock(view, ports, hit!, { from: 2, to: 8 }, writable);
    const action = vi.mocked(ports.notify).mock.calls[0]![1]!;
    expect(action.label).toBe("Link alla nota");
    action.run();
    expect(view.state.doc.toString()).toBe("[[Riunione]]");
  });

  it("il blocco è cambiato su disco mentre si sceglieva: niente id, niente link", async () => {
    const view = editor("[[^^sara");
    const [hit] = blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "sara", 50);
    const ports = port({ source: async () => "Le chiavi le tiene Marco.\n" });
    expect(await linkVaultBlock(view, ports, hit!, { from: 2, to: 8 }, writable)).toBe(false);
    expect(ports.giveId).not.toHaveBeenCalled();
    expect(ports.notify).toHaveBeenCalledWith("Il blocco di «Riunione» è cambiato mentre sceglievi: il link non si è scritto.");
    expect(view.state.doc.toString()).toBe("[[^^sara");
  });

  it("il punto dove si scriveva è sparito mentre l'id si scriveva: lo si dice", async () => {
    const view = editor("[[^^sara");
    const [hit] = blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "sara", 50);
    const ports = port({
      giveId: vi.fn(async () => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "altro" } });
        return null;
      }),
    });
    expect(await linkVaultBlock(view, ports, hit!, { from: 2, to: 8 }, writable)).toBe(false);
    expect(view.state.doc.toString()).toBe("altro");
    expect(ports.notify).toHaveBeenCalledWith(expect.stringContaining("non è stato scritto"));
  });

  it("la nota in cui si scrive diventa di sola lettura: non si scrive l'id altrui", async () => {
    const view = editor("[[^^sara");
    const [hit] = blocksOfNotes([{ doc: "Riunione.md", text: RIUNIONE }], "sara", 50);
    const ports = port();
    expect(await linkVaultBlock(view, ports, hit!, { from: 2, to: 8 }, { name: "Riunione", writable: () => false })).toBe(false);
    expect(ports.giveId).not.toHaveBeenCalled();
  });
});
