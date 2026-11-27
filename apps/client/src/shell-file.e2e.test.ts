// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): rinominare, spostare e cancellare i file.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import { appendToTextEditor as typeInEditor } from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { SettingEntry, KnownVault } from "./host/contract";
import { withoutTypeReads } from "./state/note-type-commands";
import { start, settle, waitFor, rowsOfNote, row, contextMenu, textToVideo, VAULT, editorTexts, useShellHarness } from "./shell-e2e-support";

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

describe("rinomina", () => {
  it("il nome pagina cambia, cartella ed estensione restano, e la nota aperta segue", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    await waitFor("la rinomina arriva al kernel", () => withoutTypeReads(host.atGate("invokeCommand")).length > 0);
    await settle();

    const invoked = withoutTypeReads(host.atGate("invokeCommand"))[0];
    expect(invoked.args[0]).toBe("note.rename");
    expect(invoked.args[1]).toEqual({ doc: "Benvenuto.md", to: "Indice.md" });
    expect(Object.keys(host.files())).toContain("Indice.md");

    // L'identità del documento aperto la migra **l'evento**, non il chiamante
    // (§13.1): il buffer che si salverà dopo deve avere il nome nuovo, o la
    // prima battuta successiva ricreerebbe la nota vecchia.
    await waitFor("l'albero si riscrive", () =>
      rowsOfNote().some((r) => r.textContent?.trim() === "Indice"),
    );
    typeInEditor("dopo la rinomina");
    await waitFor("il salvataggio parte", () => host.atGate("writeDocument").length > 0);
    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Indice.md");
    // **E col nome nuovo segue anche la base.** Il path da solo non basta a
    // provarlo: senza la migrazione del buffer, la battuta dopo la rinomina ne
    // fa nascere uno nuovo — che scrive sul path giusto, ma `dictated`, cioè
    // coprendo qualunque cosa ci sia senza guardare. Misurato: togliendo la
    // migrazione, un presidio che guardasse solo il path resterebbe **verde**.
    expect(written.args[2]).toEqual({ kind: "descends_from", value: "r1" });
  });
});

describe("nuova cartella", () => {
  it("nasce dal kernel dentro una cartella o nella radice, e un nome occupato non lascia il campo", async () => {
    const host = await start(VAULT);
    const folderRow = (path: string) =>
      document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`);
    const typeFolder = async (name: string) => {
      const field = document.querySelector<HTMLInputElement>("#file-list input.new-folder");
      if (!field) throw new Error("il campo della cartella nuova non c'è");
      field.value = name;
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    };

    await contextMenu(folderRow("note")!, "Nuovo", "Cartella");
    await typeFolder("Progetti");
    await waitFor("la sottocartella compare aperta sotto la madre", () => !!folderRow("note/Progetti"));
    expect(withoutTypeReads(host.atGate("invokeCommand")).map((call) => call.args.slice(0, 2))).toEqual([
      ["folder.create", { path: "note/Progetti" }],
    ]);

    await contextMenu(document.querySelector<HTMLElement>("#files-title")!, "Nuovo", "Cartella");
    await typeFolder("Archivio");
    await waitFor("la cartella di radice compare", () => !!folderRow("Archivio"));

    await contextMenu(document.querySelector<HTMLElement>("#files-title")!, "Nuovo", "Cartella");
    await typeFolder("note");
    await waitFor("il rifiuto chiude il campo", () => !document.querySelector("input.new-folder"));
    expect(withoutTypeReads(host.atGate("invokeCommand"))).toHaveLength(3);
    expect(document.querySelectorAll('#file-list li[data-path="note"]')).toHaveLength(1);
  });
});

describe("trascinare nell'albero e da e verso gli altri programmi", () => {
  const row = (path: string) =>
    document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`);
  /// Un evento di trascinamento col suo `DataTransfer` finto: `types` e
  /// `files` per un rilascio dal sistema, `set` raccoglie ciò che la shell
  /// offre fuori.
  const dragEvent = (type: string, data: { types?: string[]; files?: File[]; set?: Map<string, string> } = {}, clientY = 10): Event => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clientY", { value: clientY });
    Object.defineProperty(e, "dataTransfer", {
      value: {
        effectAllowed: "",
        dropEffect: "",
        types: data.types ?? [],
        files: data.files ?? [],
        items: [],
        setData: (kind: string, value: string) => data.set?.set(kind, value),
      },
    });
    return e;
  };
  /// La riga sotto il cursore, alta 20 px: a metà è «dentro».
  const sized = (el: HTMLElement): HTMLElement => {
    el.getBoundingClientRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    return el;
  };
  const commands = (host: FakeHost, id: string) =>
    withoutTypeReads(host.atGate("invokeCommand")).filter((call) => call.args[0] === id).map((call) => call.args[1]);

  it("una cartella si rinomina con F2 e si sposta trascinandola su un'altra", async () => {
    const host = await start({ ...VAULT, "Archivio/vecchio.md": "x" });
    const folder = document.querySelector<HTMLElement>('#file-list li[data-path="note"]')!;
    folder.focus();
    const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    folder.dispatchEvent(f2);
    expect(f2.defaultPrevented).toBe(true);
    const field = row("note")!.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe("note");
    field.value = "Appunti";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor("la cartella ha il nome nuovo", () => !!row("Appunti"));
    expect(commands(host, "folder.rename")).toEqual([{ folder: "note", to: "Appunti" }]);

    row("Appunti")!.dispatchEvent(dragEvent("dragstart"));
    const target = sized(row("Archivio")!);
    target.dispatchEvent(dragEvent("dragover"));
    expect(target.classList.contains("drop-into")).toBe(true);
    target.dispatchEvent(dragEvent("drop"));
    await waitFor("la cartella è dentro l'altra", () => commands(host, "folder.rename").length === 2);
    expect(commands(host, "folder.rename")[1]).toEqual({ folder: "Appunti", to: "Archivio/Appunti" });
    expect((await host.module.api.readDocument("Archivio/Appunti/Spesa.md")).text).toBe("pane, latte, arance\n");
  });

  it("una cartella non entra in una sua figlia", async () => {
    const host = await start({ ...VAULT, "note/dentro/x.md": "x" });
    row("note")!.click();
    await waitFor("la cartella si apre", () => !!row("note/dentro"));
    row("note")!.dispatchEvent(dragEvent("dragstart"));
    const child = sized(row("note/dentro")!);
    const over = dragEvent("dragover");
    child.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    child.dispatchEvent(dragEvent("drop"));
    await settle();
    expect(commands(host, "folder.rename")).toEqual([]);
  });

  it("la riga trascinata si solleva finché dura il gesto, poi torna giù", async () => {
    await start({ ...VAULT, "Altro.md": "y" });
    const source = row("Altro.md")!;
    source.dispatchEvent(dragEvent("dragstart"));
    expect(source.hasAttribute("data-lifted")).toBe(true);
    // Solo la riga d'origine: le altre restano al loro posto.
    expect(document.querySelectorAll("#file-list [data-lifted]")).toHaveLength(1);
    source.dispatchEvent(dragEvent("dragend"));
    expect(document.querySelector("[data-lifted]")).toBeNull();

    // Lo stesso per una linguetta.
    source.click();
    await waitFor("la nota ha la sua linguetta", () => !!document.querySelector(".tab-entry"));
    const tab = document.querySelector<HTMLElement>(".tab-entry")!;
    tab.dispatchEvent(dragEvent("dragstart"));
    expect(tab.hasAttribute("data-lifted")).toBe(true);
    tab.dispatchEvent(dragEvent("dragend"));
    expect(document.querySelector("[data-lifted]")).toBeNull();
  });

  it("le note scelte insieme si trascinano insieme", async () => {
    const host = await start({ ...VAULT, "Altro.md": "y" });
    row("Benvenuto.md")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    row("Altro.md")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    const offered = new Map<string, string>();
    row("Altro.md")!.dispatchEvent(dragEvent("dragstart", { set: offered }));
    expect(offered.get("text/uri-list")).toBe("file:///vault/Benvenuto.md\r\nfile:///vault/Altro.md");
    const folder = sized(row("note")!);
    folder.dispatchEvent(dragEvent("dragover"));
    folder.dispatchEvent(dragEvent("drop"));
    await waitFor("entrambe sono nella cartella", () => !!host.module && commands(host, "note.rename").length === 2);
    expect(commands(host, "note.rename")).toEqual([
      expect.objectContaining({ doc: "Benvenuto.md", to: "note/Benvenuto.md" }),
      expect.objectContaining({ doc: "Altro.md", to: "note/Altro.md" }),
    ]);
  });

  it("una nota trascinata fuori porta il file vero: uri-list, path e DownloadURL", async () => {
    await start(VAULT);
    const offered = new Map<string, string>();
    row("Benvenuto.md")!.dispatchEvent(dragEvent("dragstart", { set: offered }));
    expect(offered.get("text/uri-list")).toBe("file:///vault/Benvenuto.md");
    expect(offered.get("text/plain")).toBe("/vault/Benvenuto.md");
    expect(offered.get("DownloadURL")).toBe("text/markdown:Benvenuto.md:file:///vault/Benvenuto.md");
  });

  it("un file dell'albero lasciato in una nota diventa un rimando relativo, non il suo path", async () => {
    await start({ ...VAULT, "img/foto.png": "png" });
    // In Live l'immagine lasciata si vede resa: il rimando si legge in Sorgente.
    const { setMode } = await import("./panels/document");
    await setMode("source");
    await settle();
    row("img")!.click();
    await waitFor("la cartella si apre", () => !!row("img/foto.png"));
    const offered = new Map<string, string>();
    row("img/foto.png")!.dispatchEvent(dragEvent("dragstart", { set: offered }));
    const entries = offered.get("application/x-fub-entries")!;
    expect(JSON.parse(entries)).toEqual([{ id: "img/foto.png", note: false }]);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["application/x-fub-entries"], files: [], getData: (kind: string) => (kind === "application/x-fub-entries" ? entries : "") },
    });
    document.querySelector(".pane-editor .cm-content")!.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await waitFor("il rimando è nel testo", () => editorTexts().some((text) => text.includes("img/foto.png")));
    expect(editorTexts().join("\n")).not.toContain("/vault/");
  });

  it("con i link Markdown una nota lasciata in una nota diventa un link col percorso relativo", async () => {
    const style = {
      spec: {
        key: "files.link-style",
        label: "Nuovi link",
        description: "",
        group: "",
        scope: "vault",
        kind: { kind: "choice", default: "wiki", options: [{ value: "wiki", label: "Wikilink" }, { value: "markdown", label: "Link Markdown" }] },
        program_writable: false,
      },
      value: "markdown",
      source: "vault",
    } as SettingEntry;
    await start(VAULT, [style]);
    // In Live il link è una pillola: il testo si legge in Sorgente.
    const { setMode } = await import("./panels/document");
    await setMode("source");
    await settle();
    row("note")!.click();
    await waitFor("la cartella si apre", () => !!row("note/Spesa.md"));
    const offered = new Map<string, string>();
    row("note/Spesa.md")!.dispatchEvent(dragEvent("dragstart", { set: offered }));
    const entries = offered.get("application/x-fub-entries")!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["application/x-fub-entries"], files: [], getData: (kind: string) => (kind === "application/x-fub-entries" ? entries : "") },
    });
    document.querySelector(".pane-editor .cm-content")!.dispatchEvent(drop);
    await waitFor("il link è nel testo", () => editorTexts().some((text) => text.includes("[Spesa](note/Spesa.md)")));
    expect(editorTexts().join("\n")).not.toContain("[[");
  });

  it("una nota lasciata che l'editor non riesce a scrivere lo dice, senza un rifiuto muto", async () => {
    await start(VAULT);
    const { setMode } = await import("./panels/document");
    await setMode("source");
    await settle();
    const { layout } = await import("./state/layout");
    const { paneOf } = await import("./state/document-controller");
    const surface = paneOf(layout.focus)!.surface!;
    vi.spyOn(surface, "insertReferences").mockImplementation(() => {
      throw new Error("editor guasto");
    });
    for (const [kind, value] of [
      ["application/x-fub-note", "note/Spesa.md"],
      ["application/x-fub-entries", JSON.stringify([{ id: "note/Spesa.md", note: true }])],
    ] as const) {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: { types: [kind], files: [], getData: (asked: string) => (asked === kind ? value : "") },
      });
      document.querySelector(".pane-editor .cm-content")!.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
    }
    await waitFor("l'avviso del collegamento non scritto", () =>
      [...document.querySelectorAll(".toast")].filter((each) => each.textContent?.includes("editor guasto")).length >= 1);
  });

  it("un collegamento web lasciato in una nota diventa un link, il resto un allegato", async () => {
    const host = await start(VAULT);
    const { setMode } = await import("./panels/document");
    await setMode("source");
    await settle();
    const shortcut = new File(["[InternetShortcut]\r\nURL=https://example.org/pagina\r\n"], "Pagina utile.url");
    const files = [shortcut, new File([new Uint8Array([1, 2, 3])], "foto.png")];
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files, getData: () => "" } });
    document.querySelector(".pane-editor .cm-content")!.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await waitFor("il link è nel testo", () => editorTexts().some((text) => text.includes("[Pagina utile](https://example.org/pagina)")));
    await waitFor("l'immagine è depositata", () => host.atGate("resourceWrite").length === 1);
    expect(String(host.atGate("resourceWrite")[0]!.args[0])).toMatch(/foto\.png$/);
  });

  it("i file del sistema lasciati su una cartella entrano lì, e un nome preso non si sovrascrive", async () => {
    const host = await start(VAULT);
    const folder = row("note")!;
    const files = [new File(["altro"], "Spesa.md"), new File([new Uint8Array([1, 2, 3])], "foto.png")];
    const over = dragEvent("dragover", { types: ["Files"], files });
    folder.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    folder.dispatchEvent(dragEvent("drop", { types: ["Files"], files }));
    await waitFor("i due file sono scritti", () => host.atGate("resourceWrite").length === 2);
    expect(host.atGate("resourceWrite").map((call) => [call.args[0], call.args[2]])).toEqual([
      ["note/Spesa 1.md", null],
      ["note/foto.png", null],
    ]);
    expect((await host.module.api.readDocument("note/Spesa.md")).text).toBe("pane, latte, arance\n");
  });
});

describe("rinomina durante un salvataggio in volo", () => {
  it("aspetta il salvataggio e non ricrea il nome vecchio", async () => {
    const host = await start(VAULT);
    const unlock = host.throttle("writeDocument");

    typeInEditor("testo prima della rinomina");
    await waitFor(
      "la prima scrittura è in volo",
      () => host.atGate("writeDocument").length === 1,
    );

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(withoutTypeReads(host.atGate("invokeCommand")).filter((c) => c.args[0] === "note.rename")).toHaveLength(0);

    unlock();
    await waitFor(
      "la rinomina parte dopo il salvataggio",
      () => withoutTypeReads(host.atGate("invokeCommand")).some((c) => c.args[0] === "note.rename"),
    );
    await settle();

    expect(host.atGate("writeDocument")).toHaveLength(1);
    expect(Object.keys(host.files())).toContain("Indice.md");
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
    expect(host.files()["Indice.md"]).toContain("testo prima della rinomina");
  });
});

describe("chiudere la finestra col ritardo che corre", () => {
  /// I due ritardi della shell — 400 ms il salvataggio, un secondo la bozza —
  /// non hanno un dopo quando la finestra si chiude, e non lo aveva nessuno:
  /// `RunEvent::Exit` di `fub-app` chiude gli indici quando la webview sta già
  /// morendo, e ciò che era in RAM non lo chiedeva più nessuno (difetto 0205).
  ///
  /// I banchi non aspettano il ritardo: chiudono **mentre corre**, che è
  /// esattamente il caso, e guardano cos'è arrivato all'host.
  it("l'ultima battuta va sul disco invece di sparire", async () => {
    const host = await start(VAULT);
    typeInEditor("l'ultima riga prima di chiudere");

    await host.close();

    // Il testo battuto si aggiunge in fondo alla nota, quindi ciò che parte per
    // il disco è **tutto** il documento: si guarda dentro, non uguale.
    const writtenItems = host.atGate("writeDocument").map((c) => String(c.args[1]));
    expect(
      writtenItems.join("\n--- e poi ---\n"),
      "la finestra si è chiusa mentre il ritardo del salvataggio correva: " +
        "l'ultima battuta non è arrivata al disco",
    ).toContain("l'ultima riga prima di chiudere");
  });

  /// L'altra metà, e la ragione per cui la chiusura non chiede conferma: se il
  /// disco rifiuta, il testo deve restare **nella bozza**, che è la rete tesa
  /// apposta sotto questo caso (§15.2).
  ///
  /// La domanda qui non è «la bozza c'è» — il ramo di fallimento di `saveDoc` la
  /// scrive comunque — ma **se la chiusura l'ha aspettata**: una scrittura
  /// lanciata e non attesa, in questa riga, corre contro la distruzione della
  /// finestra, e chi arriva secondo non arriva. Quindi la bozza si tiene in volo
  /// e si guarda se la chiusura è già finita senza di lei.
  it("la chiusura aspetta la bozza, invece di lanciarla e andarsene", async () => {
    const host = await start(VAULT);
    typeInEditor("la riga che il disco non vuole");
    const repair = host.fault("writeDocument", "disco pieno");
    const unlock = host.throttle("saveDraft");

    let closed = false;
    const close = host.close().then(() => {
      closed = true;
    });
    await settle();

    const drafts = host.atGate("saveDraft").map((c) => String(c.args[1]));
    expect(
      drafts.join("\n--- e poi ---\n"),
      "il salvataggio è fallito chiudendo e nessuno ha scritto la bozza: " +
        "l'ultima battuta non è in nessuno dei due posti",
    ).toContain("la riga che il disco non vuole");
    expect(
      closed,
      "la finestra si è chiusa mentre la bozza era ancora in volo: la battuta " +
        "che il disco ha rifiutato corre contro la distruzione della webview",
    ).toBe(false);

    unlock();
    await close;
    repair();
  });

  /// Se il disco rifiuta sia il documento sia la bozza, il testo vive soltanto
  /// nella webview: la chiusura si rifiuta, lo dice, e riprova quando il disco
  /// torna a rispondere.
  it("senza documento né bozza sul disco la finestra resta aperta", async () => {
    const host = await start(VAULT);
    typeInEditor("LAVORO NON PERSISTITO");
    const repairWrite = host.fault("writeDocument", "disco pieno");
    const repairDraft = host.fault("saveDraft", "disco pieno");
    const { recentNotices } = await import("./ui/notify");
    const { t } = await import("./i18n/strings");

    await host.close();

    expect(host.atGate("writeDocument").length).toBeGreaterThan(0);
    expect(host.atGate("saveDraft").length).toBeGreaterThan(0);
    expect(
      host.atGate("finishMainClose"),
      "la chiusura è stata autorizzata con l'ultima battuta soltanto in memoria",
    ).toHaveLength(0);
    expect(textToVideo()).toContain("LAVORO NON PERSISTITO");
    expect(recentNotices().map((notice) => notice.text)).toContain(
      t("document.close_unprotected", { docs: "Benvenuto.md" }),
    );

    repairWrite();
    repairDraft();
    await host.close();
    expect(host.atGate("finishMainClose")).toHaveLength(1);
  });
});
