// @vitest-environment happy-dom
// La trasclusione viva (E14, T29): la nota riportata si scrive dove sta, nella
// sessione dell'origine, con un editor suo sul tratto. Qui con editor veri:
// due riquadri interi sulla stessa nota e la trasclusione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { DocumentSource, EmbedContent } from "../../../../host/contract";

const query = vi.hoisted(() => ({
  renderEmbed: vi.fn(),
  matchingDocuments: vi.fn(),
  searchExpression: vi.fn((input: string) => ({ text: input })),
}));
vi.mock("../../../../host/query", () => query);

import { createTextEngine, type TextEngine } from "../../engine";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import type { MarkdownResources, MarkdownResourceChange } from "../../../../ui/markdown-resources";
import { mountMarkdown, type HoldRender, type TranscludedEmbed } from "./mount";
import { Transclusions, transclusionSource, type TransclusionDeps } from "./transclusion";

const ORIGIN = "Riunioni/2026-11-04.md";
const NOTE = "# 4 novembre\n\n## Decisioni\n\n- Le didascalie le scrive Anna.\n- I prestiti passano da Luca.\n\n## Altro\n\nFine.\n";
const SECTION = "## Decisioni\n\n- Le didascalie le scrive Anna.\n- I prestiti passano da Luca.";

function fakeApi(text = NOTE): DocumentSessionApi {
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (): Promise<DocumentSource> => ({ text, revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" })),
    openDocument: vi.fn((id: string) => api.readDocument(id)),
    writeDocument: vi.fn(async () => "rev-2"),
    resourceWrite: vi.fn(async () => ({ revision: "rev-byte" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  return api;
}

interface Pane {
  readonly engine: TextEngine;
  readonly view: EditorView;
}

/// Una battuta come la fa la persona: una transazione che la cronologia registra.
function type(view: EditorView, at: number, insert: string): void {
  view.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });
}

const engines: TextEngine[] = [];
const lives: Lifetime[] = [];

function viewOf(parent: Element): EditorView {
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!);
  if (!view) throw new Error("editor non montato");
  return view;
}

/// Un riquadro intero sulla sessione, come lo attacca la shell.
function pane(sessions: DocumentSessionCollection, id: string): Pane {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange: (change) => {
      expect(sessions.acceptSurfaceChange(ORIGIN, id, change)).toEqual({ kind: "accepted" });
    },
    onSelectionChange: () => {},
  });
  engine.setDoc(sessions.text(ORIGIN)!);
  engines.push(engine);
  sessions.attachSurface(ORIGIN, {
    id,
    sync: (update) => engine.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text),
  });
  return { engine, view: viewOf(parent) };
}

/// La resa di una nota riportata, come la lascia `mount.ts`, vestita dalla
/// trasclusione viva.
function transclude(
  deps: TransclusionDeps | null,
  embed: Partial<TranscludedEmbed> = {},
  { hostDoc = "Mostra.md", hold = (() => () => {}) as HoldRender } = {},
) {
  const slot = document.createElement("div");
  slot.className = "embed embed-loaded";
  slot.innerHTML = "<h2>Decisioni</h2><ul><li>Le didascalie le scrive Anna.</li></ul>";
  document.body.append(slot);
  const life = openLifetime();
  lives.push(life);
  const opened: [string, string | null, string | null][] = [];
  const transclusions = new Transclusions({
    deps,
    hostDoc: () => hostDoc,
    editable: () => true,
    open: (page, heading, block) => opened.push([page, heading, block]),
    extensions: () => [],
  });
  transclusions.mount(slot, { doc: ORIGIN, page: "Riunioni/2026-11-04", heading: "Decisioni", block: null, ...embed }, life, hold);
  const live = transclusions.at(slot)!;
  return { slot, life, live, transclusions, opened };
}

function depsOf(sessions: DocumentSessionCollection, overrides: Partial<TransclusionDeps> = {}): TransclusionDeps {
  return {
    sessions,
    held: () => false,
    shownInPane: () => false,
    conflict: vi.fn((box: HTMLElement, path: string) => {
      box.hidden = sessions.saveState(path) !== "conflitto";
      box.textContent = box.hidden ? "" : "conflitto";
    }),
    ...overrides,
  };
}

beforeEach(() => {
  // I salvataggi partono soltanto con `flush` o con la chiusura.
  vi.stubGlobal("setTimeout", vi.fn(() => 1));
  vi.stubGlobal("clearTimeout", vi.fn());
});

afterEach(() => {
  for (const life of lives.splice(0)) life.close();
  for (const engine of engines.splice(0)) engine.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("la trasclusione viva", () => {
  it("in testata la provenienza, «Modifica qui» e «Apri»", () => {
    const { slot, opened } = transclude(depsOf(new DocumentSessionCollection(fakeApi())));
    expect(slot.querySelector(".transclusion-source")?.textContent).toBe("Riunioni / 2026-11-04 › Decisioni");
    expect(slot.getAttribute("role")).toBe("group");
    expect(slot.querySelector(".transclusion-edit")?.textContent).toBe("Modifica qui");
    // La resa resta sotto, intera.
    expect(slot.querySelector(".transclusion-body li")?.textContent).toBe("Le didascalie le scrive Anna.");
    slot.querySelector<HTMLButtonElement>(".transclusion-open")!.click();
    expect(opened).toEqual([["Riunioni/2026-11-04", "Decisioni", null]]);
    expect(transclusionSource(ORIGIN, { kind: "block", id: "decisioni" })).toBe("Riunioni / 2026-11-04 › ^decisioni");
  });

  it("due riquadri e la trasclusione si scambiano le modifiche; l'annulla è di ognuno", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    await sessions.read(ORIGIN);
    const a = pane(sessions, "riquadro-a");
    const b = pane(sessions, "riquadro-b");
    const { slot, live } = transclude(depsOf(sessions, { shownInPane: () => true }));

    expect(await live.edit()).toBe(true);
    expect(slot.classList.contains("transclusion-editing")).toBe(true);
    expect(slot.querySelector(".transclusion-band")?.textContent).toBe(
      "Scrivi in Riunioni/2026-11-04: si salva là, con la sua revisione. Esc esce.",
    );
    expect(slot.querySelector(".transclusion-band b")?.textContent).toBe("Riunioni/2026-11-04");
    expect(slot.querySelector(".transclusion-edit")?.textContent).toBe("Fatto");
    const inner = live.engine!;
    expect(inner.getDoc()).toBe(SECTION);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);

    type(innerView, innerView.state.doc.length, "\n- Le chiavi le tiene Sara.");
    type(a.view, a.view.state.doc.toString().indexOf("Le didascalie"), "Prima: ");
    type(b.view, b.view.state.doc.length, "Coda.\n");

    const all = "# 4 novembre\n\n## Decisioni\n\n- Prima: Le didascalie le scrive Anna.\n- I prestiti passano da Luca.\n- Le chiavi le tiene Sara.\n\n## Altro\n\nFine.\nCoda.\n";
    expect(sessions.text(ORIGIN)).toBe(all);
    expect(a.engine.getDoc()).toBe(all);
    expect(b.engine.getDoc()).toBe(all);
    expect(inner.getDoc()).toBe("## Decisioni\n\n- Prima: Le didascalie le scrive Anna.\n- I prestiti passano da Luca.\n- Le chiavi le tiene Sara.");

    // L'annulla della trasclusione toglie soltanto la sua battuta.
    expect(inner.undo()).toBe(true);
    expect(inner.undo()).toBe(false);
    const undone = all.replace("\n- Le chiavi le tiene Sara.", "");
    expect(sessions.text(ORIGIN)).toBe(undone);
    expect(a.engine.getDoc()).toBe(undone);
    expect(b.engine.getDoc()).toBe(undone);
  });

  it("l'origine aperta altrove con modifiche non salvate: si scrive su quelle", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    await sessions.read(ORIGIN);
    const a = pane(sessions, "riquadro-a");
    type(a.view, a.view.state.doc.toString().indexOf("- I prestiti"), "- Non salvato.\n");
    expect(sessions.isDirty(ORIGIN)).toBe(true);

    const { live } = transclude(depsOf(sessions, { shownInPane: () => true }));
    expect(await live.edit()).toBe(true);
    expect(live.engine!.getDoc()).toContain("- Non salvato.");
  });

  it("Esc salva ed esce; la resa ferma riparte", async () => {
    const api = fakeApi();
    const sessions = new DocumentSessionCollection(api);
    const holds: string[] = [];
    const hold: HoldRender = () => {
      holds.push("tenuta");
      return () => holds.push("lasciata");
    };
    const { slot, live } = transclude(depsOf(sessions), {}, { hold });
    expect(await live.edit()).toBe(true);
    expect(holds).toEqual(["tenuta"]);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, innerView.state.doc.length, " Detto qui.");

    innerView.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(live.phase).toBe("idle"));
    expect(api.writeDocument).toHaveBeenCalledWith(ORIGIN, NOTE.replace("da Luca.", "da Luca. Detto qui."), { kind: "descends_from", value: "rev-1" }, null, expect.any(String));
    expect(holds).toEqual(["tenuta", "lasciata"]);
    expect(slot.querySelector(".transclusion-editor")).toBeNull();
    expect(slot.querySelector<HTMLElement>(".transclusion-body ul")?.hidden).toBe(false);
    // Nessun riquadro la mostra: la sessione si è chiusa dopo il salvataggio.
    await vi.waitFor(() => expect(sessions.get(ORIGIN)).toBeUndefined());
  });

  it("la nota che ospita si chiude con la coda piena: si salva", async () => {
    const api = fakeApi();
    const sessions = new DocumentSessionCollection(api);
    const { slot, live, life } = transclude(depsOf(sessions));
    expect(await live.edit()).toBe(true);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, innerView.state.doc.length, " Ultima.");
    expect(sessions.isDirty(ORIGIN)).toBe(true);
    expect(api.writeDocument).not.toHaveBeenCalled();

    life.close();
    await vi.waitFor(() => expect(api.writeDocument).toHaveBeenCalledWith(
      ORIGIN, NOTE.replace("da Luca.", "da Luca. Ultima."), { kind: "descends_from", value: "rev-1" }, null, expect.any(String),
    ));
    await vi.waitFor(() => expect(sessions.get(ORIGIN)).toBeUndefined());
  });

  it("una revisione cambiata nel frattempo non si sovrascrive: il conflitto resta dentro", async () => {
    const api = fakeApi();
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    const unsaved = vi.fn(async () => {});
    const deps = depsOf(sessions, { unsaved });
    const { slot, live, life } = transclude(deps);
    expect(await live.edit()).toBe(true);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, innerView.state.doc.length, " Mio.");

    await live.leave();
    // Si resta a scrivere, con la scelta di un riquadro dentro la trasclusione.
    expect(live.phase).toBe("editing");
    expect(sessions.saveState(ORIGIN)).toBe("conflitto");
    expect(deps.conflict).toHaveBeenCalledWith(slot.querySelector(".transclusion-conflict"), ORIGIN);
    expect(slot.querySelector<HTMLElement>(".transclusion-conflict")?.hidden).toBe(false);
    expect(slot.querySelector(".transclusion-notice")?.textContent).toContain("non si è salvata");
    // La scrittura chiedeva la revisione letta, mai la propria a forza.
    expect(api.writeDocument).toHaveBeenCalledWith(ORIGIN, expect.any(String), { kind: "descends_from", value: "rev-1" }, null, expect.any(String));
    expect(api.writeDocument).not.toHaveBeenCalledWith(ORIGIN, expect.any(String), { kind: "dictated" }, expect.anything(), expect.anything());

    // Chiusa la nota che ospita, la sessione non si butta: la domanda di un riquadro.
    life.close();
    await vi.waitFor(() => expect(unsaved).toHaveBeenCalledWith(ORIGIN));
    expect(sessions.text(ORIGIN)).toContain("Mio.");
  });

  it("l'àncora che non c'è più lo dice, e non prende la sessione", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    const { slot, live } = transclude(depsOf(sessions), { heading: null, block: "sparito" });
    expect(await live.edit()).toBe(false);
    expect(live.phase).toBe("idle");
    expect(slot.querySelector(".transclusion-notice")?.textContent).toBe(
      "In Riunioni/2026-11-04 non c'è più #^sparito: apri la nota per vedere dov'è finito.",
    );
    await vi.waitFor(() => expect(sessions.get(ORIGIN)).toBeUndefined());
  });

  it("l'origine in sola lettura non si apre, e dice perché", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    const { slot, live } = transclude(depsOf(sessions, { held: () => true, heldWhy: () => "La nota è prestata a un'altra app." }));
    expect(await live.edit()).toBe(false);
    expect(slot.querySelector(".transclusion-editor")).toBeNull();
    expect(slot.querySelector(".transclusion-notice")?.textContent).toBe("La nota è prestata a un'altra app.");
  });

  it("la nota che riporta sé stessa non si scrive da qui, e lo dice", () => {
    const { slot, live } = transclude(depsOf(new DocumentSessionCollection(fakeApi())), {}, { hostDoc: ORIGIN });
    expect(live.editable).toBe(false);
    expect(slot.querySelector(".transclusion-edit")).toBeNull();
    expect(slot.querySelector(".transclusion-self")?.textContent).toBe("È questa stessa nota: si scrive nel testo, non qui.");
  });

  it("la nota intera, o senza sessioni, si legge soltanto", () => {
    const whole = transclude(depsOf(new DocumentSessionCollection(fakeApi())), { heading: null, block: null });
    expect(whole.live.editable).toBe(false);
    expect(whole.slot.querySelector(".transclusion-open")).not.toBeNull();
    expect(transclude(null).live.editable).toBe(false);
  });

  it("il tratto tolto da un riquadro ferma la trasclusione sull'ultimo testo", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    await sessions.read(ORIGIN);
    const a = pane(sessions, "riquadro-a");
    const { slot, live } = transclude(depsOf(sessions, { shownInPane: () => true }));
    expect(await live.edit()).toBe(true);
    const at = a.view.state.doc.toString().indexOf("Decisioni");
    a.view.dispatch({ changes: { from: at, to: at + "Decisioni".length, insert: "Scelte" }, userEvent: "input.type" });

    expect(live.range?.status()).toBe("lost");
    expect(live.engine?.isReadOnly()).toBe(true);
    expect(live.engine?.getDoc()).toBe(SECTION);
    expect(slot.querySelector(".transclusion-notice")?.textContent).toContain("è cambiato altrove");
  });

  it("l'origine cancellata mentre si scrive: si ferma e lo dice", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    const { slot, live } = transclude(depsOf(sessions));
    expect(await live.edit()).toBe(true);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, innerView.state.doc.length, " Ancora.");

    const removed = sessions.handleExternalRemoval(ORIGIN);
    expect(removed).toMatchObject({ kind: "removed", dirty: true });
    expect(live.range?.status()).toBe("closed");
    expect(live.engine?.isReadOnly()).toBe(true);
    expect(slot.querySelector(".transclusion-notice")?.textContent).toContain("non c'è più");
    await live.leave();
    expect(live.phase).toBe("idle");
  });

  it("l'origine rinominata mentre si scrive: la fascia dice il nome nuovo", async () => {
    const sessions = new DocumentSessionCollection(fakeApi());
    const { slot, live } = transclude(depsOf(sessions));
    expect(await live.edit()).toBe(true);
    expect(sessions.rename(ORIGIN, "Riunioni/Novembre.md").kind).toBe("renamed");
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, innerView.state.doc.length, " Dopo.");
    expect(sessions.text("Riunioni/Novembre.md")).toContain("da Luca. Dopo.");
    expect(slot.querySelector(".transclusion-band b")?.textContent).toBe("Riunioni/Novembre");
    expect(live.writingDoc).toBe("Riunioni/Novembre.md");
  });
});

describe("il blocco sincronizzato", () => {
  const SYNCED = "# 4 novembre\n\nLe chiavi le tiene Sara. ^chiavi\n\nFine.\n";
  const synced = (deps: TransclusionDeps | null, options: Parameters<typeof transclude>[2] = {}) =>
    transclude(deps, { heading: null, block: "chiavi" }, options);
  const click = (slot: HTMLElement) =>
    slot.querySelector(".transclusion-body")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));

  it("è un blocco della nota: senza «Modifica qui», con la provenienza al passaggio", () => {
    const { slot, live, opened } = synced(depsOf(new DocumentSessionCollection(fakeApi(SYNCED))));
    expect(live.synced).toBe(true);
    expect(live.editable).toBe(true);
    expect(slot.classList.contains("transclusion-synced")).toBe(true);
    expect(slot.hasAttribute("data-transclusion-direct")).toBe(true);
    expect(slot.querySelector(".transclusion-edit")).toBeNull();
    expect(slot.querySelector(".transclusion-source")?.textContent).toBe("Sincronizzato con Riunioni / 2026-11-04");
    expect(slot.getAttribute("aria-label")).toBe("Blocco sincronizzato con Riunioni / 2026-11-04");
    const open = slot.querySelector<HTMLButtonElement>(".transclusion-open")!;
    expect(open.getAttribute("aria-label")).toBe("Apri Riunioni/2026-11-04");
    open.click();
    expect(opened).toEqual([["Riunioni/2026-11-04", null, "chiavi"]]);
    // La trasclusione di una sezione resta quella di T29.
    const section = transclude(depsOf(new DocumentSessionCollection(fakeApi())));
    expect(section.live.synced).toBe(false);
    expect(section.slot.querySelector(".transclusion-edit")).not.toBeNull();
  });

  it("un clic lo scrive dove sta; due riquadri sull'origine vedono la stessa cosa; Esc salva ed esce", async () => {
    const api = fakeApi(SYNCED);
    const sessions = new DocumentSessionCollection(api);
    await sessions.read(ORIGIN);
    const a = pane(sessions, "riquadro-a");
    const { slot, live } = synced(depsOf(sessions, { shownInPane: () => true }));

    click(slot);
    await vi.waitFor(() => expect(live.phase).toBe("editing"));
    // Niente fascia né avviso d'apertura: si scrive come nella nota.
    expect(slot.querySelector<HTMLElement>(".transclusion-band")?.hidden).toBe(true);
    expect(slot.querySelector<HTMLElement>(".transclusion-notice")?.hidden).toBe(true);
    const inner = live.engine!;
    expect(inner.getDoc()).toBe("Le chiavi le tiene Sara. ^chiavi");
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, "Le chiavi".length, " di casa");
    expect(a.engine.getDoc()).toBe(SYNCED.replace("Le chiavi", "Le chiavi di casa"));
    type(a.view, a.view.state.doc.toString().indexOf("Sara."), "a ");
    expect(inner.getDoc()).toBe("Le chiavi di casa le tiene a Sara. ^chiavi");

    innerView.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(live.phase).toBe("idle"));
    expect(api.writeDocument).toHaveBeenCalledWith(
      ORIGIN, "# 4 novembre\n\nLe chiavi di casa le tiene a Sara. ^chiavi\n\nFine.\n", { kind: "descends_from", value: "rev-1" }, null, expect.any(String),
    );
  });

  it("il fuoco che esce dal blocco esce anche dalla scrittura", async () => {
    const sessions = new DocumentSessionCollection(fakeApi(SYNCED));
    const { slot, live } = synced(depsOf(sessions));
    expect(await live.edit()).toBe(true);
    const outside = document.createElement("button");
    document.body.append(outside);
    slot.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    await vi.waitFor(() => expect(live.phase).toBe("idle"));
  });

  it("dieci blocchi sincronizzati non leggono niente finché non si scrive in uno", async () => {
    const api = fakeApi(SYNCED);
    const sessions = new DocumentSessionCollection(api);
    const blocks = Array.from({ length: 10 }, () => synced(depsOf(sessions)));
    expect(blocks.every((each) => each.live.synced && each.live.phase === "idle")).toBe(true);
    // Nessun editor, nessuna sessione: la battuta nella nota che li ospita non
    // ha niente in più da aggiornare.
    expect(document.querySelectorAll(".transclusion-editor")).toHaveLength(0);
    expect(api.readDocument).not.toHaveBeenCalled();
    expect(sessions.get(ORIGIN)).toBeUndefined();
    click(blocks[3]!.slot);
    await vi.waitFor(() => expect(blocks[3]!.live.phase).toBe("editing"));
    expect(document.querySelectorAll(".transclusion-editor")).toHaveLength(1);
  });

  it("l'origine in sola lettura: il clic non apre niente e dice perché", async () => {
    const sessions = new DocumentSessionCollection(fakeApi(SYNCED));
    const { slot, live } = synced(depsOf(sessions, { held: () => true, heldWhy: () => "La nota è prestata a un'altra app." }));
    click(slot);
    await vi.waitFor(() => expect(slot.querySelector(".transclusion-notice")?.textContent).toBe("La nota è prestata a un'altra app."));
    expect(live.phase).toBe("idle");
    expect(slot.querySelector(".transclusion-editor")).toBeNull();
  });

  it("una revisione cambiata nel frattempo non si sovrascrive", async () => {
    const api = fakeApi(SYNCED);
    api.writeDocument = vi.fn(async () => {
      throw { kind: "conflict", message: "revisione superata" };
    });
    const sessions = new DocumentSessionCollection(api);
    const deps = depsOf(sessions);
    const { slot, live } = synced(deps);
    expect(await live.edit()).toBe(true);
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, 0, "Ora: ");
    await live.leave();
    expect(live.phase).toBe("editing");
    expect(sessions.saveState(ORIGIN)).toBe("conflitto");
    expect(slot.querySelector<HTMLElement>(".transclusion-conflict")?.hidden).toBe(false);
    expect(api.writeDocument).not.toHaveBeenCalledWith(ORIGIN, expect.any(String), { kind: "dictated" }, expect.anything(), expect.anything());
  });

  it("l'origine rinominata mentre si scrive: la provenienza dice il nome nuovo", async () => {
    const sessions = new DocumentSessionCollection(fakeApi(SYNCED));
    const { slot, live } = synced(depsOf(sessions));
    expect(await live.edit()).toBe(true);
    expect(sessions.rename(ORIGIN, "Riunioni/Novembre.md").kind).toBe("renamed");
    const innerView = viewOf(slot.querySelector(".transclusion-editor")!);
    type(innerView, 0, "Ora: ");
    expect(sessions.text("Riunioni/Novembre.md")).toContain("Ora: Le chiavi");
    expect(slot.getAttribute("aria-label")).toBe("Blocco sincronizzato con Riunioni / Novembre");
    expect(slot.querySelector(".transclusion-source")?.textContent).toBe("Sincronizzato con Riunioni / Novembre");
    expect(live.writingDoc).toBe("Riunioni/Novembre.md");
  });
});

describe("la resa che ospita", () => {
  function resources(contents: Record<string, EmbedContent>) {
    const listeners = new Set<(change: MarkdownResourceChange) => void>();
    const embed = vi.fn(async (page: string) => contents[page]!);
    const port: MarkdownResources = {
      documentId: "Mostra.md",
      match: () => undefined,
      embed,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      invalidate: () => {},
      release: () => {},
    };
    return { port, embed, emit: (change: MarkdownResourceChange) => { for (const listener of [...listeners]) listener(change); } };
  }

  it("si scrive un livello solo, e la resa aspetta chi scrive", async () => {
    const { port, embed, emit } = resources({
      Riunioni: { doc_id: ORIGIN, html: '<ul><li>Uno</li></ul><div class="embed" data-embed-page="Terza" data-embed-block="x">Terza</div>', parts: [] },
      Terza: { doc_id: "Terza.md", html: "<p>Annidata</p>", parts: [] },
    });
    const seen: string[] = [];
    let release: (() => void) | null = null;
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = mountMarkdown(container, '<div class="embed" data-embed-page="Riunioni" data-embed-heading="Decisioni">Riunioni</div>', {
      documentId: "Mostra.md",
      resources: port,
      transclude: (slot, found, _life, hold) => {
        seen.push(`${found.doc}#${found.heading}`);
        release = hold();
        slot.dataset.seen = "";
      },
    });
    await vi.waitFor(() => expect(container.querySelectorAll(".embed-loaded")).toHaveLength(2));
    // La nota riportata dentro quella riportata non riceve la trasclusione viva.
    expect(seen).toEqual([`${ORIGIN}#Decisioni`]);
    expect(container.querySelectorAll("[data-seen]")).toHaveLength(1);
    const calls = embed.mock.calls.length;

    // Mentre si scrive, una resa nuova aspetta.
    emit("embeds");
    await Promise.resolve();
    expect(embed.mock.calls.length).toBe(calls);
    expect(container.querySelector("[data-seen]")).not.toBeNull();
    release!();
    await vi.waitFor(() => expect(embed.mock.calls.length).toBeGreaterThan(calls));
    dispose();
  });

  it("il blocco d'origine cancellato: «Blocco non trovato», e niente trasclusione viva", async () => {
    const { port } = resources({});
    port.embed = vi.fn(async () => {
      throw { kind: "not_found", message: "^chiavi" };
    });
    const container = document.createElement("div");
    document.body.append(container);
    const transclude = vi.fn();
    const dispose = mountMarkdown(container, '<div class="embed" data-embed-page="Riunioni" data-embed-block="chiavi"></div>', {
      documentId: "Mostra.md",
      resources: port,
      transclude,
    });
    const slot = container.querySelector<HTMLElement>(".embed")!;
    await vi.waitFor(() => expect(slot.classList.contains("unresolved")).toBe(true));
    expect(slot.classList.contains("embed-missing")).toBe(true);
    expect(slot.dataset.embedNote).toBe("Blocco non trovato");
    expect(transclude).not.toHaveBeenCalled();
    dispose();
  });
});
