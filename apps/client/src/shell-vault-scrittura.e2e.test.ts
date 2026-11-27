// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): aprire un vault e scriverci.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import {
  appendToTextEditor as typeInEditor,
  findTextEditor,
  isDarkTheme,
  mountedTextEditors as editorViews,
  undoDepth,
} from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { KnownVault } from "./host/contract";
import { withoutTypeReads } from "./state/note-type-commands";
import { mount, start, settle, waitFor, documentReads, rowsOfNote, row, contextMenu, textToVideo, VAULT, editorTexts, splitRight, useShellHarness } from "./shell-e2e-support";

// Ogni gesto monta la shell vera: qui un giro sta fra 0,5 e 3 s, sul runner CI
// è circa tre volte più lento e i 5 s del default li superava ora un gesto ora
// un altro. Il tetto vale per il file intero; un blocco vero resta fermo ben
// oltre.
vi.setConfig({ testTimeout: 20_000 });

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Cosa si risponde a una conferma, che sia quella del sistema o quella che
  /// lo Scrittoio disegna dentro la finestra. Negli e2e è un `true`.
  confirm: true,
  /// Quante volte una conferma è stata chiesta.
  asked: 0,
  /// I vault che la macchina ricorda, per la schermata senza vault.
  known: [] as KnownVault[],
}));

// Il modulo mimato è **uno solo per tutto il file**, e delega all'host di
// adesso a ogni chiamata. Non è un vezzo: `vi.resetModules()` svuota il
// registro dei moduli ma **non** quello dei mock, quindi una factory che
// restituisse `scatola.host.module` verrebbe eseguita una volta sola e ogni
// prova dalla seconda in poi parlerebbe col vault della prima — con la shell
// rimontata a dovere, che è il modo migliore per non accorgersene. È costato
// due giri di misura, e sta scritto qui perché al terzo nessuno lo rifaccia.
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
    onKernelEvent: (handler: (n: unknown) => void) =>
      now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
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
  confirm: () => {
    box.asked++;
    return Promise.resolve(box.confirm);
  },
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

useShellHarness(box);

describe("apri un vault", () => {
  it("la finestra parte sul vault iniziale, con l'albero e la prima nota aperta", async () => {
    // **Le domande che nessun dato lega partono insieme.** Aprire un vault
    // costava otto andate e ritorno sull'IPC in fila — quattro caricatori di
    // stato (`loadLayout` ne fa due di suo) e tre elenchi del kernel — per
    // otto risposte che non si leggono a vicenda. Adesso sono due attese.
    //
    // Il conto delle chiamate non lo vedrebbe: sono le stesse otto in tutti e
    // due i casi. Il predicato è l'**attesa**, e si costruisce coi freni
    // dell'host finto invece di sperarla: si tiene in volo la risposta di una
    // porta e si guarda chi è già partito. Rosso con la forma di prima:
    // `viewState` era chiesta una volta sola, e `listCommands` mai.
    const { host, startup, unlock } = await mount(VAULT, [], undefined, [
      "viewState",
      "listViews",
    ]);
    await settle();
    expect(host.atGate("viewState").map((c) => c.args[0])).toEqual(expect.arrayContaining([
      "layout",
      "mode",
      "expanded",
      "activeSpace",
    ]));

    unlock.get("viewState")!();
    await settle();
    expect(host.atGate("listViews")).toHaveLength(1);
    expect(host.atGate("listCommands")).toHaveLength(1);

    unlock.get("listViews")!();
    await startup;
    await settle();

    // Il vault che l'host propone all'avvio, non uno scelto da qui: la barra
    // ne mostra il nome (il percorso intero sta nel suggerimento), e il titolo
    // della finestra dice nota e vault.
    expect(document.querySelector("#vault-path")?.textContent).toBe("vault");
    expect(rowsOfNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);
    expect(textToVideo()).toContain("Il primo documento");
    expect(document.title).toBe("Benvenuto — vault — Fub");

    // **Con una finestra da uno** (§14.4): l'apertura non chiede il vault
    // intero per aprire una nota. È la specie di fatto che si vede solo da
    // questa parte del confine, e che guardando lo schermo non si vede.
    const forNoteBefore = host
      .atGate("queryIndex")
      .map((c) => c.args[0] as { kind: string; page?: { limit: number } | null })
      .filter((q) => q.kind === "entries" && q.page?.limit === 1);
    expect(forNoteBefore.length).toBeGreaterThan(0);
  });

  it("una cartella si apre e mostra ciò che ha dentro, non prima", async () => {
    await start(VAULT);
    expect(rowsOfNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);

    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    expect(folder).toBeDefined();
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    expect(rowsOfNote().map((r) => r.textContent?.trim()).sort()).toEqual([
      "Benvenuto",
      "Riunione",
      "Spesa",
    ]);
  });

  it("aprire e chiudere una cartella rifà solo il suo sottoalbero: le righe di fuori restano gli stessi nodi", async () => {
    const host = await start({ ...VAULT, "zeta/Uno.md": "uno\n", "note/sotto/Tre.md": "tre\n" });
    const entryOf = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"]`);
    const outside = () => ["Benvenuto.md", "note", "zeta"].map((path) => entryOf(path));
    const before = outside();
    expect(before.every((li) => li !== null)).toBe(true);
    const folderRow = entryOf("note")!.querySelector<HTMLElement>(":scope > .tree-row")!;
    const chevron = folderRow.querySelector<HTMLButtonElement>(":scope > .chevron")!;

    chevron.click();
    await waitFor("la cartella si apre", () => entryOf("note/Spesa.md") !== null);
    expect(outside()).toEqual(before);
    expect(entryOf("note")!.querySelector(":scope > .tree-row")).toBe(folderRow);
    expect(entryOf("note")!.getAttribute("aria-expanded")).toBe("true");
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    expect(chevron.textContent).toBe("\u25be");
    // Il sottoalbero è quello di sempre: le sottocartelle, poi le note.
    const group = entryOf("note")!.querySelector(":scope > .tree-children")!;
    expect([...group.querySelectorAll<HTMLElement>(':scope > li[role="treeitem"]')].map((li) => li.dataset.path)).toEqual([
      "note/sotto",
      "note/Riunione.md",
      "note/Spesa.md",
    ]);
    expect(group.previousElementSibling).toBe(folderRow);

    chevron.click();
    await waitFor("la cartella si chiude", () => entryOf("note/Spesa.md") === null);
    expect(outside()).toEqual(before);
    expect(entryOf("note")!.getAttribute("aria-expanded")).toBe("false");
    expect(chevron.textContent).toBe("\u25b8");
    expect(entryOf("note")!.querySelector(":scope > .tree-children:not([inert])")).toBeNull();

    // Se fuori è cambiato qualcosa nel frattempo, si ridisegna tutto: niente
    // resta indietro.
    host.writeFromOutside("Altro.md", "altro\n");
    chevron.click();
    await waitFor("la cartella si apre col resto aggiornato", () =>
      entryOf("note/Spesa.md") !== null && entryOf("Altro.md") !== null,
    );
  });

  it("gli allegati stanno nell'albero: un media si apre nel visualizzatore, un file ignoto no", async () => {
    const host = await start({ ...VAULT, "note/foto.png": "png", "note/dati.zip": "zip" });
    const fileRows = () => [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.file")];
    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    folder?.click();
    await waitFor("gli allegati compaiono", () => fileRows().length === 2);
    expect(fileRows().map((r) => r.querySelector(".row-name")?.textContent)).toEqual([
      "dati.zip",
      "foto.png",
    ]);
    expect(rowsOfNote()).toHaveLength(3);

    fileRows()[0]!.click();
    await settle();
    expect(documentReads(host).map((call) => call.args[0])).not.toContain("note/dati.zip");
    expect(host.atGate("resourceOpen")).toHaveLength(0);

    fileRows()[1]!.click();
    await waitFor("il visualizzatore chiede la risorsa", () => host.atGate("resourceOpen").length > 0);
    expect(host.atGate("resourceOpen")[0]!.args[0]).toBe("note/foto.png");
    expect(documentReads(host).map((call) => call.args[0])).not.toContain("note/foto.png");
  });

  it("un allegato si cestina dal suo menu contestuale, come una nota", async () => {
    const host = await start({ ...VAULT, "note/foto.png": "png" });
    const fileRow = () => document.querySelector<HTMLElement>('#file-list .tree-row.file[data-path="note/foto.png"]');
    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    folder?.click();
    await waitFor("l'allegato compare", () => !!fileRow());

    await contextMenu(fileRow()!, "Sposta nel cestino");
    await waitFor("l'allegato è nel cestino", () => host.trash().length === 1);
    expect(Object.keys(host.files())).not.toContain("note/foto.png");
    expect(withoutTypeReads(host.atGate("invokeCommand")).map((call) => call.args.slice(0, 2))).toEqual([
      ["note.trash", { doc: "note/foto.png" }],
    ]);
    await waitFor("la riga sparisce", () => !fileRow());
  });

  it("un SVG si apre come testo accanto all'anteprima, si salva a byte e segue il disco", async () => {
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';
    const host = await start({ ...VAULT, "note/logo.svg": logo });
    const fileRow = (id: string) => document.querySelector<HTMLElement>(`#file-list .tree-row.file[data-path="${id}"]`);
    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    folder?.click();
    await waitFor("l'SVG compare", () => !!fileRow("note/logo.svg"));
    fileRow("note/logo.svg")!.click();
    await waitFor("l'SVG si apre come testo", () => textToVideo().includes('width="8"'));
    const editor = document.querySelector<HTMLElement>(".pane.focus .pane-editor")!;
    expect(editor.dataset.svgMode).toBe("live_preview");
    expect(editor.querySelector(".svg-preview")).not.toBeNull();
    expect(host.atGate("resourceOpen")).toHaveLength(0);
    const modes = [...document.querySelectorAll<HTMLElement>(".pane.focus .pane-toolbar button[data-mode]")];
    expect(modes.map((button) => button.textContent)).toEqual(["Sorgente", "Diviso", "Anteprima"]);

    // Il kernel rifiuta `write_document` su un file senza formato: la battuta
    // arriva al disco come byte, col CAS sulla revisione letta.
    const read = await host.module.api.readDocument("note/logo.svg");
    typeInEditor("<!-- ciao -->");
    await waitFor("il salvataggio a byte parte", () => host.atGate("resourceWrite").length > 0);
    const [id, bytes, expected] = host.atGate("resourceWrite")[0]!.args as [string, Uint8Array, string];
    expect(id).toBe("note/logo.svg");
    expect(expected).toBe(read.revision);
    expect(new TextDecoder().decode(bytes)).toBe(`${logo}<!-- ciao -->`);
    expect(host.atGate("writeDocument").map((call) => call.args[0])).not.toContain("note/logo.svg");
    await waitFor("il disco ha il testo", () => host.files()["note/logo.svg"] === `${logo}<!-- ciao -->`);
    await waitFor("salvato", () => document.getElementById("save-state")?.dataset.state !== "in_corso");
    expect(document.getElementById("save-state")?.dataset.state).not.toBe("conflitto");

    // Un'altra applicazione lo riscrive: arriva `entry_changed`, non
    // `document_changed`, e il buffer pulito si ricarica lo stesso.
    host.writeFromOutside("note/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>');
    await waitFor("il cambio esterno arriva all'editor", () => textToVideo().includes('width="16"'));

    // Rinominato da fuori, il riquadro lo segue; sparito, si chiude.
    host.renameFromOutside("note/logo.svg", "note/marchio.svg");
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll(".pane.focus .tab")].some((tab) => tab.textContent?.includes("marchio")));
    expect(host.emit({ type: "entry_removed", id: "note/marchio.svg", kind: "asset" })).toBe(true);
    await waitFor("la linguetta si chiude", () =>
      ![...document.querySelectorAll(".pane .tab")].some((tab) => tab.textContent?.includes("marchio")));
    // Il riquadro che la mostrava lo dice, e l'avviso si chiude.
    const removed = document.querySelector<HTMLElement>('.sheet-notice[data-notice="removed"]');
    expect(removed?.textContent).toContain("marchio");
    removed!.querySelector<HTMLButtonElement>("button")!.click();
    expect(document.querySelector('.sheet-notice[data-notice="removed"]')).toBeNull();
  });

  it("il commutatore e le scorciatoie seguono la superficie attiva", async () => {
    const mounted = await mount({
      "Markdown.md": "# Titolo\n",
      "Plain.txt": "solo testo\n",
    });
    const stop = await mounted.startup;
    await settle();
    const modes = () =>
      [...document.querySelectorAll<HTMLElement>(".pane.focus .pane-toolbar button[data-mode]")].map(
        (button) => button.dataset.mode,
      );

    expect(modes()).toEqual(["source", "live_preview", "reading"]);
    // `start` rimonta i moduli dopo i mock: serve l'esemplare vivo del pannello,
    // non un import statico catturato prima di `vi.resetModules`.
    const { openDocument } = await import("./panels/document");
    await openDocument("Plain.txt");
    await settle();
    expect(modes()).toEqual([]);
    expect(document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode).toBe("source");

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "l",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode).toBe("source");
    document.querySelector<HTMLElement>(".tab")?.click();
    await settle();
    expect(modes()).toEqual(["source", "live_preview", "reading"]);
    expect(
      document.querySelector<HTMLElement>(".pane.focus .pane-toolbar button[aria-pressed='true']")
        ?.dataset.mode,
    ).toBe("live_preview");
    stop();
  });
});

describe("scrivi", () => {
  it("ciò che si batte arriva al disco, e discende dalla revisione che si era letta", async () => {
    const host = await start(VAULT);
    const reads = documentReads(host);
    const read = reads[reads.length - 1];
    expect(read?.args[0]).toBe("Benvenuto.md");

    typeInEditor("Una riga nuova.");
    await waitFor("il salvataggio parte", () => host.atGate("writeDocument").length > 0);

    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Benvenuto.md");
    expect(String(written.args[1])).toContain("Una riga nuova.");
    // **La guardia della 0092**: si scrive dichiarando da cosa si partiva, e
    // ciò da cui si partiva è la revisione che la lettura ha risposto — non un
    // `dictated` che copre in silenzio ciò che c'era.
    expect(written.args[2]).toEqual({ kind: "descends_from", value: "r1" });
    expect(host.files()["Benvenuto.md"]).toContain("Una riga nuova.");
  });
});

describe("i confini del buffer", () => {
  it("accorpa le battute ravvicinate in un solo debounce", async () => {
    const host = await start(VAULT);

    typeInEditor("prima battuta");
    typeInEditor(" e seconda battuta");
    await waitFor("il debounce parte", () => host.atGate("writeDocument").length === 1);
    // The integration exercises the real 400 ms app debounce; fake timers would
    // also freeze `waitFor`/`settle` and cannot observe the host gate naturally.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();

    expect(host.atGate("writeDocument")).toHaveLength(1);
    expect(host.files()["Benvenuto.md"]).toContain("prima battuta e seconda battuta");
  });

  it("mantiene il testo e lo stato quando una scrittura fallisce", async () => {
    const host = await start(VAULT);
    const repair = host.fault("writeDocument", "disco pieno");
    // `vi.resetModules` gives each mounted shell its own notification history.
    const { recentNotices } = await import("./ui/notify");

    typeInEditor("testo rifiutato dal disco");
    await waitFor(
      "la scrittura rifiutata parte",
      () => host.atGate("writeDocument").length === 1,
    );
    await waitFor(
      "lo stato diventa fallito",
      () => document.getElementById("save-state")?.dataset.state === "fallito",
    );

    expect(host.files()["Benvenuto.md"]).not.toContain("testo rifiutato dal disco");
    expect(
      recentNotices().some((notice) => notice.text.includes("non è stato salvato")),
      "il fallimento della scrittura non è visibile",
    ).toBe(true);
    // Anche dentro il foglio, non solo nel toast che passa: l'avviso resta
    // finché il guasto non è riparato, con «Riprova» a portata di mano.
    const notice = document.querySelector<HTMLElement>('.sheet-notice[data-notice="save_failed"]');
    expect(notice, "l'errore di salvataggio non è nel foglio").not.toBeNull();
    expect(notice!.getAttribute("role")).toBe("alert");
    const retry = notice!.querySelector<HTMLButtonElement>("button")!;
    expect(retry.textContent).toBe("Riprova");
    repair();
    retry.click();
    await waitFor("il salvataggio riparato riesce", () => host.files()["Benvenuto.md"]?.includes("testo rifiutato dal disco") === true);
    await waitFor(
      "l'avviso se ne va con il guasto",
      () => document.querySelector('.sheet-notice[data-notice="save_failed"]') === null,
    );
  });

  it("dice che il file è in sola lettura, tiene la bozza e non lo ripete a ogni battuta", async () => {
    const host = await start(VAULT);
    const repair = host.fault("writeDocument", {
      kind: "permission_denied",
      message: "il file è in sola lettura: Benvenuto.md",
    });
    const { recentNotices } = await import("./ui/notify");
    const readOnly = () =>
      recentNotices().filter((notice) => notice.text.includes("è in sola lettura: Fub non lo sovrascrive"));

    typeInEditor("testo su un file in sola lettura");
    await waitFor("la scrittura rifiutata parte", () => host.atGate("writeDocument").length === 1);
    await waitFor(
      "lo stato diventa fallito",
      () => document.getElementById("save-state")?.dataset.state === "fallito",
    );
    expect(host.files()["Benvenuto.md"]).not.toContain("testo su un file in sola lettura");
    expect(readOnly(), "l'avviso dice sola lettura, non un errore di I/O").toHaveLength(1);
    expect(readOnly()[0]!.times).toBe(1);
    expect(
      recentNotices().some((notice) => notice.text.includes("non è stato salvato")),
      "non è il messaggio del guasto generico",
    ).toBe(false);

    // Un'altra battuta: il salvataggio automatico ci riprova, l'avviso no.
    typeInEditor(" ancora");
    await waitFor("la seconda scrittura rifiutata parte", () => host.atGate("writeDocument").length === 2);
    await waitFor(
      "lo stato torna fallito",
      () => document.getElementById("save-state")?.dataset.state === "fallito",
    );
    await settle();
    expect(readOnly()[0]!.times, "l'avviso non si ripete a ogni battuta").toBe(1);
    expect(host.files()["Benvenuto.md"]).not.toContain("testo su un file in sola lettura");

    // Il file torna scrivibile: «Riprova» salva quello che era rimasto.
    repair();
    document.querySelector<HTMLButtonElement>('.sheet-notice[data-notice="save_failed"] button')!.click();
    await waitFor(
      "il testo rimasto arriva sul disco",
      () => host.files()["Benvenuto.md"]?.includes("testo su un file in sola lettura ancora") === true,
    );
  });

  it("ricarica un cambio watcher quando il buffer è pulito", async () => {
    const host = await start(VAULT);
    const readsBefore = documentReads(host).length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await waitFor(
      "il documento viene riletto dopo il cambio watcher",
      () => documentReads(host).length > readsBefore,
    );
    await waitFor(
      "il testo watcher arriva all'editor",
      () => textToVideo().includes("testo arrivato dal watcher"),
    );
    expect(textToVideo()).toContain("testo arrivato dal watcher");
    // Il foglio dice che il testo è cambiato sotto gli occhi, e si può chiudere.
    await waitFor("l'avviso di ricarica compare", () => !!document.querySelector('.sheet-notice[data-notice="reloaded"]'));
    document.querySelector<HTMLButtonElement>('.sheet-notice[data-notice="reloaded"] button')!.click();
    expect(document.querySelector('.sheet-notice[data-notice="reloaded"]')).toBeNull();
  });

  it("non sovrascrive il buffer sporco quando il watcher cambia il file", async () => {
    const host = await start(VAULT);
    typeInEditor("testo locale non salvato");
    const readsBefore = documentReads(host).length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await settle();
    expect(documentReads(host).length).toBe(readsBefore);
    expect(textToVideo()).toContain("testo locale non salvato");
    expect(textToVideo()).not.toContain("testo arrivato dal watcher");
    expect(document.querySelector('.sheet-notice[data-notice]')?.getAttribute("data-notice")).toMatch(/changed_on_disk|overwritten/);
    await host.close();
  });

  it("rifiuta la scrittura su una revisione superata senza coprire il file", async () => {
    const host = await start(VAULT);

    typeInEditor("testo locale");
    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo scritto altrove\n",
      { kind: "dictated" },
    );

    const revisionOf = (call: { args: unknown[] }): string | undefined => {
      const base = call.args[2];
      if (typeof base !== "object" || base === null || !("kind" in base)) return undefined;
      if (base.kind !== "descends_from" || !("value" in base) || typeof base.value !== "string") {
        return undefined;
      }
      return base.value;
    };
    await waitFor(
      "la scrittura locale arriva con la base letta",
      () =>
        host
          .atGate("writeDocument")
          .some((call) => revisionOf(call) !== undefined),
    );
    await waitFor(
      "lo stato diventa conflitto",
      () => document.getElementById("save-state")?.dataset.state === "conflitto",
    );
    await waitFor("la bozza del conflitto parte", () => host.atGate("saveDraft").length > 0);

    const attempted = host
      .atGate("writeDocument")
      .find((call) => revisionOf(call) !== undefined);
    expect(attempted).toBeDefined();
    expect(revisionOf(attempted!)).toBe("r1");
    expect(host.files()["Benvenuto.md"]).toBe("testo scritto altrove\n");
  });
});

describe("undo locale tra riquadri", () => {
  it("condivide il testo ma non la cronologia, senza rileggere o lasciare timer", async () => {
    const host = await start(VAULT);
    const readsAtSplit = documentReads(host).length;
    const initial = editorTexts();
    expect(initial).toHaveLength(1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    expect(documentReads(host).length).toBe(readsAtSplit);
    expect(editorTexts()).toEqual([initial[0], initial[0]]);

    const views = editorViews();
    views[0]!.dispatch({
      changes: { from: views[0]!.state.doc.length, insert: " [A]" },
    });
    views[1]!.dispatch({
      changes: { from: views[1]!.state.doc.length, insert: " [B]" },
    });
    await settle();
    const both = `${initial[0]} [A] [B]`;
    expect(editorTexts()).toEqual([both, both]);

    views[0]!.focus();
    views[0]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial[0]} [B]`, `${initial[0]} [B]`]);
    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([initial[0], initial[0]]);

    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "y", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial[0]} [B]`, `${initial[0]} [B]`]);

    const writesBeforeClose = host.atGate("writeDocument").length;
    await host.close();
    await settle();
    expect(host.atGate("writeDocument").length).toBe(writesBeforeClose + 1);
    await settle();
    expect(host.atGate("writeDocument").length).toBe(writesBeforeClose + 1);
  });
  it("un riquadro rimasto indietro fonde la sua battuta invece di perderla", async () => {
    await start(VAULT);
    const initial = editorTexts()[0]!;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " [A]" } });
    await settle();
    // Il secondo riquadro resta indietro — una sincronizzazione mancata —
    // senza che la sessione lo sappia: `sync` non torna alla sessione.
    const behind = views[1]!.state.doc.length;
    views[1]!.dispatch({
      changes: { from: behind - " [A]".length, to: behind },
      userEvent: "sync",
    });
    expect(editorTexts()[1]).toBe(initial);

    // La battuta parte da un testo stantio: la sessione la rifiuta, il
    // pannello la ribasa e la ripresenta. Prima si perdeva sotto il testo
    // autorevole, fuori dalla history.
    views[1]!.dispatch({ changes: { from: 0, insert: "[B] " } });
    await settle();
    const merged = `[B] ${initial} [A]`;
    expect(editorTexts()).toEqual([merged, merged]);

    // La battuta resta del riquadro che l'ha fatta: il suo undo toglie
    // soltanto quella, e l'altro riquadro la vede sparire.
    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial} [A]`, `${initial} [A]`]);
  });
});

describe("una sessione e le sue superfici", () => {
  it("dopo il rimonto della linguetta il secondo riquadro continua a seguire", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    // Il secondo riquadro mostra un altro documento e poi torna: la
    // registrazione alla sessione si toglie e si rifà. Ciò che si guarda è
    // che **dopo** il rimonto la sessione raggiunge ancora entrambe le
    // superfici — una registrazione persa qui non si riparebbe più.
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    panes[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    row("Spesa").click();
    await waitFor(
      "la nota della cartella arriva nel secondo riquadro",
      () => editorViews()[1]?.state.doc.toString().includes("pane, latte") === true,
    );
    const tabs = [...document.querySelectorAll<HTMLElement>(".pane")][1]!.querySelectorAll<HTMLElement>(".tab");
    tabs[0]?.click();
    await waitFor(
      "il secondo riquadro torna sul documento di partenza",
      () => editorViews()[1]?.state.doc.toString().includes("Il primo documento") === true,
    );
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " [dopo il rimonto]" } });
    await settle();
    const texts = editorTexts();
    expect(texts).toEqual([texts[0], texts[0]]);
    expect(texts[0]).toContain(" [dopo il rimonto]");
  });

  // C5: tornare a una scheda aperta non rimonta l'editor. La sua superficie
  // resta da parte, nascosta, col cursore, lo scorrimento e la cronologia
  // locale; il testo cambiato altrove intanto arriva come da fuori.
  describe("tornare a una scheda già aperta", () => {
    const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
    const tabOf = (pane: HTMLElement, name: string) =>
      [...pane.querySelectorAll<HTMLElement>(".tab")].find((tab) => tab.textContent?.includes(name))!;
    const viewIn = (pane: HTMLElement) => {
      const host = pane.querySelector<HTMLElement>(".pane-editor");
      return host ? findTextEditor(host) : null;
    };
    type TextView = NonNullable<ReturnType<typeof findTextEditor>>;
    /// Una superficie liberata ha distrutto il suo editor, e con lui gli
    /// ascoltatori e i plugin: il campo è privato in CodeMirror, ma è il segno.
    const destroyed = (view: TextView) => (view as unknown as { destroyed: boolean }).destroyed;
    /// Apre Spesa nel primo riquadro, torna su Benvenuto e dà l'editor di Spesa,
    /// rimasto da parte.
    const parkSpesa = async (): Promise<TextView> => {
      const { openDocument } = await import("./panels/document");
      await openDocument("note/Spesa.md");
      await waitFor("Spesa si apre", () => viewIn(panes()[0]!)?.state.doc.toString().includes("pane, latte") === true);
      const spesa = viewIn(panes()[0]!)!;
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Spesa va da parte", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 1);
      return spesa;
    };

    it("ritrova la stessa superficie, col cursore e la cronologia locale", async () => {
      const host = await start({ ...VAULT });
      const { openDocument } = await import("./panels/document");
      await openDocument("note/Spesa.md");
      await waitFor("Spesa si apre", () => viewIn(panes()[0]!)?.state.doc.toString().includes("pane, latte") === true);
      const spesa = viewIn(panes()[0]!)!;
      spesa.dispatch({ changes: { from: 4, insert: " fresco" }, selection: { anchor: 11 }, userEvent: "input.type" });
      const depth = undoDepth(spesa.state);
      expect(depth).toBeGreaterThan(0);

      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Benvenuto torna davanti", () => viewIn(panes()[0]!)?.state.doc.toString().includes("Il primo documento") === true);
      expect(editorViews()).toHaveLength(1);
      expect(panes()[0]!.querySelectorAll(".pane-editor")).toHaveLength(1);
      expect(panes()[0]!.querySelector<HTMLElement>(".pane-editor-riposo")?.hidden).toBe(true);

      tabOf(panes()[0]!, "Spesa").click();
      await waitFor("Spesa torna davanti", () => viewIn(panes()[0]!) === spesa);
      expect(spesa.state.doc.toString()).toContain("pane fresco, latte");
      expect(spesa.state.selection.main.head).toBe(11);
      expect(undoDepth(spesa.state)).toBe(depth);
      expect(spesa.state.readOnly).toBe(false);
      // La superficie che torna scrive ancora nella sessione.
      spesa.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type" });
      await settle();
      const { documentSessions } = await import("./state/document-session");
      expect(documentSessions.text("note/Spesa.md")).toContain("Xpane fresco");
      // Il salvataggio arriva al disco qui, non nella prova dopo.
      await waitFor("il salvataggio arriva al disco", () =>
        host.atGate("writeDocument").some((call) => String(call.args[1]).includes("Xpane fresco")) &&
        (host.files()["note/Spesa.md"] ?? "").includes("Xpane fresco"));
    });

    it("il testo cambiato in un altro riquadro intanto arriva, fuori dalla cronologia locale", async () => {
      await start({ ...VAULT });
      await splitRight();
      await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
      await settle();
      const { openDocument } = await import("./panels/document");
      panes()[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await openDocument("note/Spesa.md");
      await settle();
      await waitFor("Spesa si apre a sinistra", () => viewIn(panes()[0]!)?.state.doc.toString().includes("pane, latte") === true);
      const parked = viewIn(panes()[0]!)!;
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Benvenuto torna davanti", () => viewIn(panes()[0]!) !== parked);

      panes()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await openDocument("note/Spesa.md");
      await waitFor("Spesa si apre a destra", () => viewIn(panes()[1]!)?.state.doc.toString().includes("pane, latte") === true);
      const right = viewIn(panes()[1]!)!;
      right.dispatch({ changes: { from: 0, insert: "Lista: " }, userEvent: "input.type" });
      await settle();

      panes()[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      tabOf(panes()[0]!, "Spesa").click();
      await waitFor("Spesa torna davanti a sinistra", () => viewIn(panes()[0]!) === parked);
      expect(parked.state.doc.toString()).toContain("Lista: pane, latte");
      expect(undoDepth(parked.state)).toBe(0);
    });

    it("chiudere una scheda messa da parte smonta la sua superficie", async () => {
      await start({ ...VAULT });
      const { openDocument } = await import("./panels/document");
      await openDocument("note/Spesa.md");
      await waitFor("Spesa si apre", () => viewIn(panes()[0]!)?.state.doc.toString().includes("pane, latte") === true);
      const parked = viewIn(panes()[0]!)!;
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Spesa va da parte", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 1);
      const close = tabOf(panes()[0]!, "Spesa").parentElement!.querySelector<HTMLElement>(".tab-close");
      expect(close).not.toBeNull();
      close!.click();
      await waitFor("la superficie da parte se ne va", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 0);
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
      expect(destroyed(parked)).toBe(true);
    });

    it("il testo cambiato sul disco mentre è da parte arriva al ritorno", async () => {
      const host = await start({ ...VAULT });
      const parked = await parkSpesa();
      host.writeFromOutside("note/Spesa.md", "cambiato da un'altra app\n");
      const { documentSessions } = await import("./state/document-session");
      await waitFor("la sessione rilegge il disco", () => documentSessions.text("note/Spesa.md") === "cambiato da un'altra app\n");
      // Da parte non si ridisegna: è staccata dalla sessione.
      expect(parked.state.doc.toString()).toContain("pane, latte");

      tabOf(panes()[0]!, "Spesa").click();
      await waitFor("Spesa torna davanti", () => viewIn(panes()[0]!) === parked);
      expect(parked.state.doc.toString()).toBe("cambiato da un'altra app\n");
      expect(undoDepth(parked.state)).toBe(0);
    });

    it("una rinomina o uno spostamento lasciano la superficie da parte, e la scheda torna con lei", async () => {
      // La scheda è la stessa, cambia solo il nome: la superficie la segue
      // col cursore e la cronologia locale (IMP-046, come per quella davanti).
      const host = await start({ ...VAULT });
      const parked = await parkSpesa();
      host.renameFromOutside("note/Spesa.md", "note/Lista.md");
      await waitFor("la scheda segue la rinomina", () => !!tabOf(panes()[0]!, "Lista"));
      await settle();
      expect(panes()[0]!.querySelectorAll(".pane-editor-riposo")).toHaveLength(1);
      expect(destroyed(parked)).toBe(false);

      tabOf(panes()[0]!, "Lista").click();
      await waitFor("Lista torna davanti", () => viewIn(panes()[0]!) === parked);
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Lista va da parte", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 1);

      host.renameFromOutside("note/Lista.md", "Archivio/Lista.md");
      await waitFor("la scheda segue lo spostamento", () => !!tabOf(panes()[0]!, "Lista"));
      await settle();
      expect(destroyed(parked)).toBe(false);
      tabOf(panes()[0]!, "Lista").click();
      await waitFor("Lista torna dalla cartella nuova", () => viewIn(panes()[0]!) === parked);
      expect(parked.state.doc.toString()).toContain("pane, latte");
      expect(editorViews()).toHaveLength(1);

      // La battuta va alla sessione col nome nuovo.
      parked.dispatch({ changes: { from: 0, insert: "X " }, userEvent: "input.type" });
      await waitFor("il salvataggio va al path nuovo", () => host.files()["Archivio/Lista.md"]?.startsWith("X ") === true);
    });

    it("cambiata l'estensione, la superficie da parte si smonta e la scheda rimonta", async () => {
      const host = await start({ ...VAULT });
      const parked = await parkSpesa();
      host.renameFromOutside("note/Spesa.md", "note/Spesa.txt");
      await waitFor("la superficie da parte se ne va", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 0);
      expect(destroyed(parked)).toBe(true);
    });

    it("un salvataggio in volo quando la scheda va da parte arriva al disco, e la superficie torna intatta", async () => {
      const host = await start({ ...VAULT });
      const { openDocument } = await import("./panels/document");
      await openDocument("note/Spesa.md");
      await waitFor("Spesa si apre", () => viewIn(panes()[0]!)?.state.doc.toString().includes("pane, latte") === true);
      const spesa = viewIn(panes()[0]!)!;
      const release = host.throttle("writeDocument");
      spesa.dispatch({ changes: { from: 0, insert: "A " }, userEvent: "input.type" });
      await waitFor("il primo salvataggio è in volo", () =>
        host.atGate("writeDocument").some((call) => String(call.args[1]).startsWith("A pane")));
      // Il secondo resta nel debounce della superficie: andare da parte lo registra.
      spesa.dispatch({ changes: { from: 2, insert: "B " }, userEvent: "input.type" });
      const depth = undoDepth(spesa.state);
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Spesa va da parte", () => panes()[0]!.querySelectorAll(".pane-editor-riposo").length === 1);
      const { documentSessions } = await import("./state/document-session");
      expect(documentSessions.text("note/Spesa.md")).toBe("A B pane, latte, arance\n");

      release();
      await waitFor("tutto arriva al disco", () => host.files()["note/Spesa.md"] === "A B pane, latte, arance\n");
      tabOf(panes()[0]!, "Spesa").click();
      await waitFor("Spesa torna davanti", () => viewIn(panes()[0]!) === spesa);
      expect(spesa.state.doc.toString()).toBe("A B pane, latte, arance\n");
      expect(undoDepth(spesa.state)).toBe(depth);
      expect(document.querySelector('.sheet-notice[data-notice]')).toBeNull();
    });

    it("la luce cambiata mentre è da parte arriva al ritorno", async () => {
      await start({ ...VAULT });
      const { setEditorTheme } = await import("./panels/document");
      setEditorTheme("light");
      const parked = await parkSpesa();
      expect(isDarkTheme(parked)).toBe(false);

      setEditorTheme("dark");
      expect(isDarkTheme(viewIn(panes()[0]!)!)).toBe(true);
      tabOf(panes()[0]!, "Spesa").click();
      await waitFor("Spesa torna davanti", () => viewIn(panes()[0]!) === parked);
      expect(isDarkTheme(parked)).toBe(true);
    });

    it("dividere non copia le superfici da parte, e chiudere il riquadro le smonta", async () => {
      await start({ ...VAULT });
      const left = await parkSpesa();
      await splitRight();
      await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
      await settle();
      expect(panes()[1]!.querySelectorAll(".pane-editor-riposo")).toHaveLength(0);
      expect(panes()[0]!.querySelectorAll(".pane-editor-riposo")).toHaveLength(1);

      const { openDocument } = await import("./panels/document");
      panes()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await openDocument("note/Riunione.md");
      await waitFor("Riunione si apre a destra", () => viewIn(panes()[1]!)?.state.doc.toString().includes("Appunti") === true);
      const right = viewIn(panes()[1]!)!;
      tabOf(panes()[1]!, "Benvenuto").click();
      await waitFor("Riunione va da parte a destra", () => panes()[1]!.querySelectorAll(".pane-editor-riposo").length === 1);

      const registry = await import("./ui/commands");
      await registry.allCommands().find((entry) => entry.id === "shell.pane.close")?.run?.();
      await waitFor("il riquadro si chiude", () => panes().length === 1);
      expect(destroyed(right)).toBe(true);
      expect(destroyed(left)).toBe(false);
      expect(document.querySelectorAll(".pane-editor-riposo")).toHaveLength(1);
    });

    it("tiene da parte al più quattro superfici per riquadro: la quinta libera la meno recente", async () => {
      const notes: Record<string, string> = {};
      for (let i = 1; i <= 5; i += 1) notes[`n/Nota ${i}.md`] = `testo della nota ${i}\n`;
      await start({ ...VAULT, ...notes });
      const { openDocument } = await import("./panels/document");
      const views: TextView[] = [viewIn(panes()[0]!)!];
      for (let i = 1; i <= 5; i += 1) {
        await openDocument(`n/Nota ${i}.md`);
        await waitFor(`Nota ${i} si apre`, () => viewIn(panes()[0]!)?.state.doc.toString() === `testo della nota ${i}\n`);
        views.push(viewIn(panes()[0]!)!);
      }
      // Da parte: Benvenuto, Nota 1…4; la quinta superficie da parte ha liberato Benvenuto.
      expect(panes()[0]!.querySelectorAll(".pane-editor-riposo")).toHaveLength(4);
      expect(destroyed(views[0]!)).toBe(true);
      expect(views.slice(1).map(destroyed)).toEqual([false, false, false, false, false]);
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(5);

      // Benvenuto torna montato da capo; Nota 1, ora la meno recente, se ne va.
      tabOf(panes()[0]!, "Benvenuto").click();
      await waitFor("Benvenuto si rimonta", () => viewIn(panes()[0]!)?.state.doc.toString().includes("Il primo documento") === true);
      expect(viewIn(panes()[0]!)).not.toBe(views[0]);
      expect(destroyed(views[1]!)).toBe(true);
      expect(panes()[0]!.querySelectorAll(".pane-editor-riposo")).toHaveLength(4);
      tabOf(panes()[0]!, "Nota 3").click();
      await waitFor("Nota 3 torna com'era", () => viewIn(panes()[0]!) === views[3]);
    });
  });

  it("«Apri a lato» dal menu della riga apre la nota in un secondo riquadro", async () => {
    await start(VAULT);
    await contextMenu(row("Benvenuto"), "Apri a lato");
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
  });

  it("«Duplica» dal menu della riga crea la copia accanto all'originale e la apre", async () => {
    await start(VAULT);
    await contextMenu(row("Benvenuto"), "Duplica");
    await waitFor("la copia compare nell'albero", () => !!row("Benvenuto copia"));
    expect(row("Benvenuto")).toBeTruthy();
  });

  it("Ctrl-C su una nota e Ctrl-V su una cartella ci mettono una copia col suo nome", async () => {
    await start(VAULT);
    const item = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"]`);
    const press = (on: HTMLElement, key: string) => {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
      on.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(item("Benvenuto.md")!, "c")).toBe(true);
    expect(press(item("note")!, "v")).toBe(true);
    document.querySelector<HTMLButtonElement>('#file-list li[data-path="note"] > .tree-row > .chevron')!.click();
    await waitFor("la copia compare nella cartella", () => !!item("note/Benvenuto.md"));
    expect(item("Benvenuto.md")).toBeTruthy();
    await contextMenu(item("note")!.querySelector<HTMLElement>(".tree-row")!, "Incolla");
    await waitFor("la seconda copia prende un nome libero", () => !!item("note/Benvenuto 1.md"));
  });

  it("«Aggiungi ai segnalibri» dal menu della riga salva la nota tra i segnalibri", async () => {
    await start(VAULT);
    await contextMenu(row("Benvenuto"), "Organizza", "Aggiungi ai segnalibri");
    const { listBookmarks } = await import("./state/bookmarks");
    await waitFor("il segnalibro è salvato", () =>
      listBookmarks().some((b) => b.target.k === "doc" && b.title.includes("Benvenuto")));
  });

  it("la rinomina non stacca le superfici: due riquadri restano una sessione", async () => {
    const host = await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor("la rinomina arriva al kernel", () => withoutTypeReads(host.atGate("invokeCommand")).length > 0);
    await settle();
    // La barriera è la **linguetta**: l'albero si riscrive con un evento, la
    // migrazione dell'identità aperta (evento `document_renamed` → layout →
    // sessione) con un altro. Battere nel mezzo scriverebbe col nome di
    // prima — una corsa del sistema, non ciò che questo banco prova.
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some(
        (el) => el.textContent === "Indice",
      ),
    );
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " dopo la rinomina" } });
    await settle();
    const texts = editorTexts();
    expect(texts).toEqual([texts[0], texts[0]]);
    expect(texts[0]).toContain(" dopo la rinomina");
    // Il salvataggio parte col nome nuovo: la sessione è quella, se ne è
    // costruita una seconda le due superfici starebbero su due buffer.
    await waitFor(
      "il salvataggio parte col nome nuovo",
      () => host.atGate("writeDocument").some((w) => w.args[0] === "Indice.md"),
    );
  });
});

describe("due salvataggi della stessa nota", () => {
  it("non si accavallano: chi flussa non ne fa partire un secondo", async () => {
    // Il difetto 0030, **costruito** e non aspettato. La prima stesura di questo
    // banco batteva due volte e sperava che i due salvataggi si sovrapponessero:
    // passava verde anche togliendo la coda, perché il debounce di 400 ms li
    // metteva in fila da sé. Non provava niente, ed è stato quel verde a dire
    // dove la finestra è davvero.
    //
    // È qui: `flushPendingSave` — che parte a ogni cambio documento, a ogni
    // rinomina, a ogni azione di view che scrive — chiama `saveDoc` **subito**,
    // e il `clearTimeout` che fa prima non richiama indietro un salvataggio che
    // il timer ha già fatto partire. Senza coda erano due scritture in volo con
    // la **stessa** `base` letta tutte e due prima, e la seconda si prendeva un
    // `conflict` dal kernel su un file che aveva toccato solo l'utente.
    const host = await start(VAULT);

    const unlock = host.throttle("writeDocument");
    typeInEditor("Prima battuta.");
    await waitFor("la prima scrittura parte", () => host.atGate("writeDocument").length === 1);

    // Il gesto vero che flussa: si apre un'altra nota mentre la scrittura è
    // ancora in volo. Non si aspetta — `openDocument` è ferma dentro il flush,
    // che è ferma dentro la scrittura frenata, ed è esattamente il momento.
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    void row("Riunione").click();
    await settle();

    // **Il momento che conta.** Senza la coda qui le scritture sono due.
    expect(host.atGate("writeDocument").length).toBe(1);

    unlock();
    await waitFor("la nota si apre", () => documentReads(host).length > 1);
    await settle();

    // Una scrittura sola, e nessun conflitto: il flush ha aspettato quella in
    // volo invece di affiancarle una gemella con la base di prima.
    expect(host.atGate("writeDocument").length).toBe(1);
    expect(host.files()["Benvenuto.md"]).toContain("Prima battuta.");
  });
});
