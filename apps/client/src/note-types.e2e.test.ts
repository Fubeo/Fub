// @vitest-environment happy-dom
//
// **I tipi di nota, fino al file** (T33, E5), sulla shell vera contro l'host
// finto: «Nuova nota» chiede il tipo, la nota nasce dal tipo e si rilegge con
// le sue proprietà; «In evidenza» in una nota con un tipo scrive nel tipo, con
// «Annulla»; un errore di scrittura lascia il disco com'era. Il cablaggio è
// quello di `properties.e2e.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import { waiter } from "./test-wait";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

/// Il tipo dei test del core (`note_types.rs`, `LIBRO`).
const LIBRO = "---\nicon: book\nproperties:\n  autore: testo\n  letto: casella\n  generi: elenco\nfeatured: [autore]\nfolder: Biblioteca\n---\n# {{title}}\n\nNote di lettura.\n";
const DUNE = "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Herbert\nletto: true\ngeneri: [fantascienza]\n---\nIl deserto.\n";

async function start(files: Record<string, string>): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({ file: files });
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const waitFor = waiter(3000);

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
  await waitFor("la testata si disegna", () => document.querySelector(".cm-fub-page-prop") !== null);
}

function stopShell(): void {
  (document.activeElement as HTMLElement | null)?.blur();
  document.getSelection()?.removeAllRanges();
  activeStop?.();
  activeStop = null;
}

const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const menuRows = () => [...document.querySelectorAll<HTMLElement>(".note-type-popover .note-type-menu-item")];
const shown = () => [...document.querySelectorAll<HTMLElement>(".cm-fub-page .cm-fub-page-prop")].map((row) => row.dataset.key);
const keyButton = (key: string) => document.querySelector<HTMLElement>(`.cm-fub-page-prop[data-key="${key}"] .cm-fub-page-prop-key`)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>(".cm-fub-prop-menu [role^=menuitem]")].find((row) => row.textContent?.includes(label));

/// «Nuova nota» dal «+» dell'albero: il «+» apre il menu «Nuovo» (S34), e la
/// sua voce «Nota» è il gesto della nota nuova, che coi tipi chiede il tipo.
async function newNoteFromPlus(): Promise<void> {
  document.querySelector<HTMLButtonElement>("#new-note")!.click();
  await waitFor("il menu «Nuovo» si apre", () => document.getElementById("context-menu") !== null);
  const note = [...document.getElementById("context-menu")!.querySelectorAll<HTMLElement>("button")]
    .find((b) => (b.querySelector(".menu-label")?.textContent ?? b.textContent) === "Nota");
  if (!note) throw new Error("nel menu «Nuovo» non c'è «Nota»");
  note.click();
  await settle();
}

beforeEach(() => {
  stopShell();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("«Nuova nota» coi tipi", () => {
  it("chiede il tipo; la nota nasce dal tipo nella sua cartella, e riletta dice le sue proprietà", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO, "Leggere.md": "Da leggere.\n" });
    await newNoteFromPlus();
    await waitFor("il menu dei tipi si apre", () => menuRows().length === 2);
    const rows = menuRows();
    expect(rows.map((row) => row.querySelector(".note-type-menu-name")?.textContent)).toEqual(["Nota", "Libro"]);
    expect(rows[1]!.querySelector(".note-type-menu-sub")?.textContent).toBe("autore");
    expect(document.querySelector(".note-type-popover .note-type-menu-foot")?.textContent).toContain("Tipi");
    // Da tastiera: giù sul tipo, Invio.
    press(document.activeElement!, "ArrowDown");
    press(document.activeElement!, "Enter");

    const born = "Biblioteca/Senza titolo.md";
    await waitFor("la nota nasce dal tipo", () => host.files()[born] !== undefined);
    expect(host.files()[born]).toBe("---\ntipo: \"[[Tipi/Libro]]\"\nautore:\nletto: false\ngeneri: []\n---\n# Senza titolo\n\nNote di lettura.\n");
    // Il tipo non è cambiato, e nessun altro file.
    expect(host.files()["Tipi/Libro.md"]).toBe(LIBRO);
    expect(Object.keys(host.files()).sort()).toEqual([born, "Leggere.md", "Tipi/Libro.md"].sort());

    // Una shell nuova, sullo stesso disco: la nota riletta ha il tipo, la sua
    // icona e le sue proprietà in evidenza.
    stopShell();
    await start(host.files());
    await open(born);
    await waitFor("la testata sa il tipo", () => document.querySelector(".cm-fub-page-icon[data-from-type]") !== null);
    expect(shown()).toEqual(["tipo", "autore"]);
    expect(document.querySelector(".cm-fub-page-type-notice")).toBeNull();
  });

  it("Invio a menu appena aperto tiene la nota semplice; Esc non crea niente", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO });
    const before = Object.keys(host.files()).length;
    await newNoteFromPlus();
    await waitFor("il menu dei tipi si apre", () => menuRows().length === 2);
    press(document.activeElement!, "Escape");
    await waitFor("il menu si chiude", () => menuRows().length === 0);
    await settle();
    expect(Object.keys(host.files())).toHaveLength(before);

    await newNoteFromPlus();
    await waitFor("il menu dei tipi si riapre", () => menuRows().length === 2);
    press(document.activeElement!, "Enter");
    await waitFor("nasce una nota semplice", () => Object.keys(host.files()).length === before + 1);
    const plain = Object.keys(host.files()).find((doc) => doc !== "Tipi/Libro.md")!;
    expect(host.files()[plain]).not.toContain("tipo:");
  });

  it("senza tipi nel vault la domanda non c'è", async () => {
    const host = await start({ "Leggere.md": "Da leggere.\n" });
    await newNoteFromPlus();
    await waitFor("la nota nasce subito", () => Object.keys(host.files()).length === 2);
    expect(document.querySelector(".note-type-popover")).toBeNull();
  });

  it("una nota che non nasce lascia il disco com'era e lo dice", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO });
    const before = host.files();
    await newNoteFromPlus();
    await waitFor("il menu dei tipi si apre", () => menuRows().length === 2);
    const release = host.fault("invokeCommand", { kind: "permission_denied", message: "La cartella Biblioteca è di sola lettura" });
    menuRows()[1]!.click();
    await waitFor("l'avviso dice perché", () => document.querySelector(".toast-text")?.textContent?.includes("sola lettura") === true);
    release();
    expect(host.files()).toEqual(before);
  });
});

describe("la sezione «Tipi» del cassetto", () => {
  it("elenca i tipi coi conteggi, e il clic apre la nota del tipo", async () => {
    await start({ "Tipi/Libro.md": LIBRO, "Biblioteca/Dune.md": DUNE, "Leggere.md": "Da leggere.\n" });
    await waitFor("la sezione c'è", () => document.querySelector<HTMLElement>("#types-list")?.hidden === false);
    expect(document.querySelector("#types-title")?.textContent).toBe("Tipi1");
    const row = document.querySelector<HTMLElement>("#types-list .type-row")!;
    expect(row.querySelector(".row-name")?.textContent).toBe("Libro");
    expect(row.querySelector(".row-count")?.textContent).toBe("1");
    row.click();
    const { state } = await import("./state/store");
    await waitFor("si apre il tipo", () => state.currentDoc === "Tipi/Libro.md");
  });

  it("senza tipi la sezione non c'è", async () => {
    await start({ "Leggere.md": "Da leggere.\n" });
    await settle();
    expect(document.querySelector<HTMLElement>("#types-list")?.hidden ?? true).toBe(true);
    expect(document.querySelector<HTMLElement>("#types-title")?.hidden ?? true).toBe(true);
  });
});

describe("la pagina del tipo", () => {
  it("la nota di un tipo ha il posto della pagina in fondo, una nota col tipo no", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO, "Biblioteca/Dune.md": DUNE });
    await open("Tipi/Libro.md");
    await waitFor("il posto della pagina c'è", () => document.querySelector(".pane.focus .pane-editor .cm-day-page[data-type-page]") !== null);
    // Il tipo, che è il modello delle note nuove, non è cambiato.
    expect(host.files()["Tipi/Libro.md"]).toBe(LIBRO);
    await open("Biblioteca/Dune.md");
    await settle();
    // L'editor attivo è quello di Dune (quello di Libro resta a riposo).
    expect(document.querySelector(".pane.focus .pane-editor .cm-content")?.textContent).toContain("Il deserto.");
    expect(document.querySelector(".pane.focus .pane-editor .cm-day-page[data-type-page]")).toBeNull();
  });
});

describe("«In evidenza» in una nota con un tipo", () => {
  it("scrive nel tipo, la testata lo segue, e «Annulla» lo rimette", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO, "Biblioteca/Dune.md": DUNE });
    await open("Biblioteca/Dune.md");
    await waitFor("la testata sa il tipo", () => shown().join() === "tipo,autore");
    document.querySelector<HTMLElement>(".cm-fub-page-props-more")!.click();
    keyButton("letto").click();
    menuItem("Metti in evidenza")!.click();

    await waitFor("il tipo ha letto in evidenza", () => host.files()["Tipi/Libro.md"]!.includes("featured: [autore, letto]"));
    expect(host.files()["Biblioteca/Dune.md"]).toBe(DUNE);
    await waitFor("la testata lo segue", () => shown().slice(0, 3).join() === "tipo,autore,letto");

    const undo = () => [...document.querySelectorAll<HTMLButtonElement>(".toast-action")].find((button) => button.textContent === "Annulla");
    await waitFor("l'avviso offre «Annulla»", () => undo() !== undefined);
    expect([...document.querySelectorAll(".toast-text")].map((text) => text.textContent)).toContain("«letto» è in evidenza nelle note di tipo Libro");
    undo()!.click();
    await waitFor("il tipo torna com'era", () => host.files()["Tipi/Libro.md"] === LIBRO);
  });

  it("un tipo che non si scrive resta com'era, e l'avviso dice perché", async () => {
    const host = await start({ "Tipi/Libro.md": LIBRO, "Biblioteca/Dune.md": DUNE });
    await open("Biblioteca/Dune.md");
    await waitFor("la testata sa il tipo", () => shown().join() === "tipo,autore");
    const before = host.files();
    const release = host.fault("invokeCommand", { kind: "permission_denied", message: "sola lettura" });
    document.querySelector<HTMLElement>(".cm-fub-page-props-more")!.click();
    keyButton("letto").click();
    menuItem("Metti in evidenza")!.click();
    await waitFor("l'avviso lo dice", () => [...document.querySelectorAll(".toast-text")].some((text) => text.textContent?.includes("non si può modificare")));
    release();
    expect(host.files()).toEqual(before);
  });
});
