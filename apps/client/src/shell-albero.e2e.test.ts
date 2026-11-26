// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): l'esploratore e la sua navigazione.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { SettingEntry, KnownVault } from "./host/contract";
import { withoutTypeReads } from "./state/note-type-commands";
import { start, settle, waitFor, row, contextMenu, textToVideo, VAULT, useShellHarness } from "./shell-e2e-support";

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

describe("navigazione accessibile dell'esploratore", () => {
  it("espande e richiude senza aprire la pagina della cartella né perdere il focus", async () => {
    await start({ ...VAULT, "note/_index.md": "La pagina della cartella.\n" });
    const original = textToVideo();
    const chevron = () => document.querySelector<HTMLButtonElement>(
      '#file-list li[data-path="note"] > .tree-row > .chevron',
    )!;
    for (const [key, expanded] of [["Enter", "true"], [" ", "false"]]) {
      const control = chevron();
      control.focus();
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      // Happy DOM non esegue l'attivazione nativa predefinita del tasto.
      control.click();
      await settle();
      expect(chevron().getAttribute("aria-expanded")).toBe(expanded);
      expect(document.activeElement).toBe(chevron());
      expect(textToVideo()).toBe(original);
    }
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    chevron().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("un'apertura che finisce tardi non toglie il fuoco a un campo aperto intanto, e Invio resta lì", async () => {
    // R1 sullo schermo vero: si apre un documento lento, e prima che finisca si
    // apre il lanciatore e si scrive. La fine dell'apertura portava il fuoco
    // nell'editor, e l'Invio del lanciatore finiva nel documento.
    const host = await start(VAULT);
    const controller = await import("./state/document-controller");
    const unlock = host.throttle("openDocument");
    const opening = controller.openDocument("note/Riunione.md", { gesture: true });
    await settle();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    unlock();
    await opening;
    await settle();
    expect(textToVideo()).toContain("riunione");
    expect(document.activeElement).toBe(field);
    field.remove();

    // Senza nessuno che l'abbia portato altrove, il fuoco va all'editor come prima.
    (document.querySelector<HTMLElement>("#file-list .tree-row") ?? document.body).focus();
    const again = host.throttle("openDocument");
    const second = controller.openDocument("note/Spesa.md", { gesture: true });
    await settle();
    again();
    await second;
    await settle();
    expect(textToVideo()).toContain("pane, latte");
    expect(document.activeElement?.closest(".cm-content")).not.toBeNull();
  });

  it("un'apertura che finisce tardi non toglie il fuoco a chi è già entrato nel documento aperto", async () => {
    // #395: la superficie si monta prima che l'apertura finisca (il contesto
    // si pubblica dopo). Chi intanto entra nel documento (il Tab della lavagna
    // vuota al suo primo pulsante) ci resta: la fine dell'apertura riportava
    // il fuoco all'editor, e il pulsante lo perdeva.
    const host = await start(VAULT);
    const controller = await import("./state/document-controller");
    (document.querySelector<HTMLElement>("#file-list .tree-row") ?? document.body).focus();
    const unlock = host.throttle("setActiveContext");
    const opening = controller.openDocument("note/Spesa.md", { gesture: true });
    for (let i = 0; i < 40 && !textToVideo().includes("pane, latte"); i++) await settle();
    expect(textToVideo()).toContain("pane, latte");
    const surface = document.querySelector<HTMLElement>(".pane.focus .pane-editor > *");
    expect(surface).not.toBeNull();
    // Un controllo del documento, come «Scrivi una scheda» della lavagna vuota.
    const control = document.createElement("button");
    surface?.append(control);
    control.focus();
    unlock();
    await opening;
    await settle();
    expect(document.activeElement).toBe(control);
    control.remove();

    // Col fuoco ancora dove era al gesto, l'editor lo prende come prima.
    (document.querySelector<HTMLElement>("#file-list .tree-row") ?? document.body).focus();
    const again = host.throttle("setActiveContext");
    const second = controller.openDocument("note/Riunione.md", { gesture: true });
    await settle();
    again();
    await second;
    await settle();
    expect(textToVideo()).toContain("riunione");
    expect(document.activeElement?.closest(".cm-content")).not.toBeNull();
  });

  it("rivela la nota attiva dentro una cartella chiusa, senza togliere il fuoco all'editor", async () => {
    await start(VAULT);
    const noteItem = () =>
      document.querySelector<HTMLElement>('#file-list li[data-path="note/Riunione.md"]');
    const chevron = () =>
      document.querySelector<HTMLButtonElement>('#file-list li[data-path="note"] > .tree-row > .chevron')!;
    chevron().click();
    await waitFor("la cartella si apre", () => !!noteItem());
    noteItem()!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la nota si apre", () => textToVideo().includes("riunione"));
    chevron().click();
    await waitFor("la cartella si richiude", () => !noteItem());
    const focused = document.activeElement;

    const registry = await import("./ui/commands");
    const reveal = registry.allCommands().find((e) => e.id === "shell.explorer.reveal");
    expect(reveal?.binding).toBeNull();
    await reveal!.run!();
    await settle();

    expect(noteItem()?.getAttribute("aria-selected")).toBe("true");
    expect(noteItem()?.tabIndex).toBe(0);
    expect(
      document.querySelector('#file-list li[data-path="note"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.activeElement).toBe(focused);
  });

  it("una cartella del percorso nella testata si apre nell'esplora; il nome resta il titolo", async () => {
    // Il nome scelto dalla persona per il vault apre il percorso.
    box.known = [{ root: "/vault", name: "Appunti", icon: null, favorite: false, last_opened: 0, keys_seen: {} }];
    await start(VAULT);
    const noteItem = () =>
      document.querySelector<HTMLElement>('#file-list li[data-path="note/Riunione.md"]');
    const chevron = () =>
      document.querySelector<HTMLButtonElement>('#file-list li[data-path="note"] > .tree-row > .chevron')!;
    chevron().click();
    await waitFor("la cartella si apre", () => !!noteItem());
    noteItem()!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la nota si apre", () => textToVideo().includes("riunione"));
    chevron().click();
    await waitFor("la cartella si richiude", () => !noteItem());

    const crumb = document.querySelector<HTMLElement>(".pane.focus .pane-toolbar > .muted")!;
    expect(crumb.dataset.path).toBe("note/Riunione.md");
    // Le briciole: la cartella disegnata, il vault, la cartella, il nome.
    expect(crumb.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    await waitFor("il nome del vault", () => crumb.querySelector("[data-folder='']")?.textContent === "Appunti");
    expect([...crumb.querySelectorAll<HTMLElement>("[data-folder]")].map((f) => f.textContent)).toEqual(["Appunti", "note"]);
    expect(crumb.querySelectorAll(".crumb-sep[aria-hidden='true']")).toHaveLength(2);
    expect(crumb.querySelector(".crumb-name")?.textContent).toBe("Riunione");
    const folder = crumb.querySelector<HTMLElement>("[data-folder='note']")!;
    expect(folder.textContent).toBe("note");
    // Due colpi sulla cartella non aprono il campo della rinomina.
    folder.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    folder.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    await waitFor("la cartella si apre dall'intestazione", () => !!noteItem());
    expect(
      document.querySelector('#file-list li[data-path="note"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.querySelector(".sheet-title-edit")).toBeNull();
  });
});

describe("il cassetto sopra i fogli (A-02)", () => {
  // A 700 px albero e ispettore sono cassetti col velo: la tastiera non deve
  // arrivare al foglio coperto. Scegliere un documento chiude il cassetto e dà
  // il fuoco al documento; qualunque fuoco che entra sotto il velo lo chiude.
  const narrow = async (body: () => Promise<void>): Promise<void> => {
    const saved = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    try {
      await body();
    } finally {
      if (saved) Object.defineProperty(window, "innerWidth", saved);
      else delete (window as { innerWidth?: number }).innerWidth;
    }
  };
  const run = async (id: string) => {
    const registry = await import("./ui/commands");
    await registry.allCommands().find((entry) => entry.id === id)!.run!();
    await settle();
  };
  const layout = () => document.getElementById("layout")!;
  const inSheet = () => !!document.activeElement?.closest(".pane");

  it("scegliere una nota dall'albero chiude il cassetto e porta il fuoco nella nota", async () => {
    await narrow(async () => {
      await start(VAULT);
      await run("shell.sidebar.toggle");
      expect(layout().classList.contains("drawer-sidebar-open")).toBe(true);
      const chevron = document.querySelector<HTMLButtonElement>('#file-list li[data-path="note"] > .tree-row > .chevron')!;
      chevron.click();
      await waitFor("la cartella si apre", () => !!document.querySelector('#file-list li[data-path="note/Spesa.md"]'));
      // Aprire la cartella non è scegliere un documento: il cassetto resta.
      expect(layout().classList.contains("drawer-sidebar-open")).toBe(true);
      const row = document.querySelector<HTMLElement>('#file-list li[data-path="note/Spesa.md"]')!;
      row.focus();
      row.querySelector<HTMLElement>(":scope > .tree-row")!.click();
      await waitFor("la nota si apre", () => textToVideo().includes("pane, latte"));
      await settle();
      expect(layout().classList.contains("drawer-sidebar-open")).toBe(false);
      expect(document.getElementById("sidebar-scrim")!.hidden).toBe(true);
      expect(document.activeElement?.closest(".cm-content")).not.toBeNull();
    });
  });

  it("finché il cassetto è aperto il fuoco non resta nel foglio coperto, anche nell'ispettore", async () => {
    await narrow(async () => {
      await start(VAULT);
      const controller = await import("./state/document-controller");
      for (const side of ["sidebar", "inspector"] as const) {
        await run(side === "sidebar" ? "shell.sidebar.toggle" : "shell.inspector.toggle");
        expect(layout().classList.contains(`drawer-${side}-open`)).toBe(true);
        // La rail sta sopra il velo: il fuoco lì non chiude niente.
        document.querySelector<HTMLElement>("#rail button")!.focus();
        expect(layout().classList.contains(`drawer-${side}-open`)).toBe(true);
        // Una voce dello schema, un collegamento: chi porta il fuoco all'editor
        // sotto il velo chiude il cassetto prima che arrivi una battuta.
        controller.focusEditor();
        expect(inSheet()).toBe(true);
        expect(layout().classList.contains(`drawer-${side}-open`)).toBe(false);
        expect(document.getElementById(side === "sidebar" ? "sidebar-scrim" : "inspector-scrim")!.hidden).toBe(true);
      }
    });
  });
});

describe("il formato si vede", () => {
  it("un Word ha la sua icona nell'albero e nella linguetta; la testata ha solo briciole, «Salvato» e «…»", async () => {
    const rich = JSON.stringify({ format: "fub-rich", version: 1, blocks: [{ t: "para", role: { kind: "body" }, c: [{ t: "text", x: "ciao" }] }] });
    await start({ ...VAULT, "Lettera.docx": rich });
    const row = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`);
    await waitFor("il Word è nell'albero", () => !!row("Lettera.docx"));
    expect(row("Lettera.docx")!.querySelector(".row-icon svg")).not.toBeNull();
    expect(row("Benvenuto.md")!.classList.contains("no-icon")).toBe(true);
    row("Lettera.docx")!.click();
    const bar = () => document.querySelector<HTMLElement>(".pane.focus .pane-toolbar")!;
    const name = () => bar().querySelector<HTMLElement>(":scope > .muted .crumb-name")?.textContent;
    await waitFor("il Word si apre", () => name() === "Lettera.docx");
    // Il formato non è più un'etichetta della testata: lo dice la linguetta.
    expect(bar().querySelector(".pane-format")).toBeNull();
    const tab = () => document.querySelector<HTMLElement>('.pane.focus .tab[aria-selected="true"]')!;
    expect(tab().querySelector("svg.tab-format")).not.toBeNull();
    expect(tab().getAttribute("aria-label")).toContain("Documento .docx");
    // «Salvato» è il bottone dello stato, che ridice la parola nel nome; «…» è
    // una figura col nome di sempre.
    const save = bar().querySelector<HTMLButtonElement>(".pane-status-slot button.sheet-save")!;
    await waitFor("lo stato del Word", () => save.dataset.state === "salvato");
    expect(save.textContent).toBe("Salvato");
    expect(save.getAttribute("aria-label")).toContain("Salvato");
    const menu = bar().querySelector<HTMLButtonElement>(":scope > [data-pane-menu]")!;
    expect(menu.textContent).toBe("");
    expect(menu.querySelector(":scope > svg")).not.toBeNull();
    expect(menu.getAttribute("aria-label")).toBe("Azioni del riquadro");
    // Una nota ha la figura della nota nella linguetta, e nessun nome di formato.
    row("Benvenuto.md")!.click();
    await waitFor("la nota si apre", () => name() === "Benvenuto");
    expect(tab().querySelector("svg.tab-format")).not.toBeNull();
    expect(tab().getAttribute("aria-label")).not.toContain("Documento .docx");
  });
});

describe("filtra l'esplora per percorso", () => {
  it("le voci col percorso giusto prendono il posto dell'albero; una cartella si apre nell'albero", async () => {
    await start(VAULT);
    const registry = await import("./ui/commands");
    const command = registry.allCommands().find((entry) => entry.id === "shell.explorer.filter");
    expect(command?.binding).toBeNull();
    await command!.run!();
    const input = document.querySelector<HTMLInputElement>(".explorer-filter input")!;
    expect(document.activeElement).toBe(input);
    const rows = () => [...document.querySelectorAll<HTMLElement>("#files-panel .search-results .search-result")];
    input.value = "note riun";
    input.dispatchEvent(new Event("input"));
    await waitFor("l'elenco filtrato", () => rows().length > 0);
    expect(rows().map((row) => row.dataset.path)).toEqual(["note/Riunione.md"]);
    expect(document.querySelector<HTMLElement>("#file-list")!.hidden).toBe(true);
    rows()[0].click();
    await waitFor("la nota si apre", () => textToVideo().includes("riunione"));

    input.value = "note -riunione";
    input.dispatchEvent(new Event("input"));
    await waitFor("l'elenco cambia", () => rows()[0]?.dataset.path === "note");
    expect(rows().map((row) => row.dataset.path)).not.toContain("note/Riunione.md");
    rows()[0].click();
    await waitFor("l'albero torna", () => !document.querySelector<HTMLElement>("#file-list")!.hidden);
    await settle();
    expect(document.querySelector('#file-list li[data-path="note"]')?.getAttribute("aria-expanded")).toBe("true");
    // Il campo resta, vuoto: è l'unico campo del pannello File.
    expect(document.querySelector<HTMLElement>(".explorer-filter")!.hidden).toBe(false);
    expect(input.value).toBe("");
  });
});

describe("mostra la cartella degli allegati", () => {
  const folder = (value: string): SettingEntry => ({
    spec: {
      key: "files.attachment-folder",
      label: "Cartella degli allegati",
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: "attachments" },
      program_writable: false,
    },
    value,
    source: "machine",
  }) as SettingEntry;

  it("apre la cartella nell'albero, e dice quando non c'è ancora", async () => {
    await start(VAULT, [folder("note")]);
    const registry = await import("./ui/commands");
    const command = registry.allCommands().find((entry) => entry.id === "shell.explorer.reveal_attachments");
    expect(command?.binding).toBeNull();
    await command!.run!();
    await settle();
    const item = document.querySelector<HTMLElement>('#file-list li[data-path="note"]');
    expect(item?.getAttribute("aria-expanded")).toBe("true");
    expect(item?.tabIndex).toBe(0);
    expect(document.querySelector('#file-list li[data-path="note/Spesa.md"]')).not.toBeNull();
  });

  it("una cartella che non c'è si dice e non si crea", async () => {
    const host = await start(VAULT);
    const { recentNotices } = await import("./ui/notify");
    const registry = await import("./ui/commands");
    await registry.allCommands().find((entry) => entry.id === "shell.explorer.reveal_attachments")!.run!();
    await settle();
    expect(recentNotices().some((notice) => notice.text.includes("«attachments»"))).toBe(true);
    expect(host.calls.some((call) => call.gate === "createFolder")).toBe(false);
  });
});

describe("copia il link a questo punto", () => {
  it("dà al paragrafo un id e copia [[Nota#^id]]", async () => {
    await start(VAULT);
    row("Benvenuto").click();
    await waitFor("la nota si apre", () => textToVideo().includes("primo documento"));
    const copied: string[] = [];
    const { declareClipboard } = await import("./platform/clipboard");
    const undeclare = declareClipboard(async (text) => { copied.push(text); });
    const registry = await import("./ui/commands");
    const command = registry.allCommands().find((entry) => entry.id === "shell.doc.copy_anchor_link");
    expect(command?.binding).toBeNull();
    await command!.run!();
    await waitFor("il link è negli appunti", () => copied.length === 1);
    const id = /^\[\[Benvenuto#\^([a-z0-9]{6})\]\]$/.exec(copied[0]!)?.[1];
    expect(id).toBeDefined();
    // In Live l'id del blocco non si vede: il testo si legge in Sorgente.
    const { setMode } = await import("./panels/document");
    await setMode("source");
    await settle();
    expect(textToVideo()).toContain(`Il primo documento di questo vault. ^${id}`);
    undeclare();
  });
});

describe("i menu dell'albero e della scheda", () => {
  const tree = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`)!;

  it("«Copia ▸ Il link» di una nota mette negli appunti il suo [[link]]", async () => {
    await start(VAULT);
    const copied: string[] = [];
    const { declareClipboard } = await import("./platform/clipboard");
    const undeclare = declareClipboard(async (text) => { copied.push(text); });
    await contextMenu(tree("Benvenuto.md"), "Copia", "Il link");
    await waitFor("il link è negli appunti", () => copied.length === 1);
    expect(copied).toEqual(["[[Benvenuto]]"]);
    undeclare();
  });

  it("«Chiudi anche ▸ Tutte» chiude anche le schede appuntate, e ogni sessione si chiude", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("Benvenuto.md");
    await openDocument("note/Spesa.md");
    await settle();
    const { layout, setPinnedTab } = await import("./state/layout");
    const pane = layout.focus;
    setPinnedTab(pane, 0, true);
    await settle();
    expect(document.querySelectorAll(".pane .tab").length).toBe(2);
    await contextMenu(document.querySelector<HTMLElement>(".pane .tab")!, "Chiudi anche", "Tutte");
    await waitFor("le schede se ne vanno", () => document.querySelectorAll(".pane .tab").length === 0);
  });

  it("«Mostra le note che lo usano» apre il file e porta l'ispettore sui collegamenti", async () => {
    await start({ ...VAULT, "foto.png": "png" });
    const { setSidePanelController } = await import("./ui/side-panels");
    const revealed: string[] = [];
    const restore = setSidePanelController({ visible: () => false, reveal: (side) => void revealed.push(side), toggle: () => {}, dismiss: () => {} });
    await contextMenu(tree("foto.png"), "Mostra le note che lo usano");
    await waitFor("il file si apre", () => [...document.querySelectorAll(".pane .tab")].some((tab) => tab.textContent?.includes("foto")));
    expect(revealed).toEqual(["inspector"]);
    restore();
  });
});

describe("comprimi ed espandi tutto dall'albero", () => {
  const folderItem = (path: string) =>
    document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"]`);
  const command = async (id: string) => {
    const registry = await import("./ui/commands");
    return registry.allCommands().find((entry) => entry.id === id);
  };

  it("espande ogni cartella, poi le comprime tutte", async () => {
    await start(VAULT);
    await (await command("shell.explorer.expand_all"))!.run!();
    await settle();
    expect(folderItem("note")?.getAttribute("aria-expanded")).toBe("true");
    await (await command("shell.explorer.collapse_all"))!.run!();
    await settle();
    expect(folderItem("note")?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("rinomina e cestino dal registro dei comandi", () => {
  const noteItem = (path: string) =>
    document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"]`);
  const command = async (id: string) => {
    const registry = await import("./ui/commands");
    return registry.allCommands().find((entry) => entry.id === id);
  };

  it("con «Mostra la nota aperta» l'albero apre le cartelle della nota che si apre", async () => {
    const autoReveal = {
      spec: {
        key: "files.auto-reveal",
        label: "Mostra la nota aperta nell'esplora",
        description: "",
        group: "",
        scope: "machine",
        kind: { kind: "toggle", default: false },
        program_writable: false,
      },
      value: true,
      source: "machine",
    } as SettingEntry;
    await start(VAULT, [autoReveal]);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await waitFor("la cartella si apre da sé", () => noteItem("note/Riunione.md") !== null);
  });

  it("cestinare una cartella chiede, finché «Conferma prima di cestinare» non è spenta", async () => {
    const press = () => {
      const folder = noteItem("note")!;
      folder.focus();
      const canc = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      folder.dispatchEvent(canc);
      expect(canc.defaultPrevented).toBe(true);
    };
    let host = await start(VAULT);
    let asked = box.asked;
    box.confirm = false;
    press();
    await waitFor("la domanda arriva", () => box.asked === asked + 1);
    await settle();
    expect(withoutTypeReads(host.atGate("invokeCommand")).some((call) => call.args[0] === "folder.trash")).toBe(false);

    const noConfirm = {
      spec: {
        key: "files.confirm-trash",
        label: "Conferma prima di cestinare una cartella",
        description: "",
        group: "",
        scope: "vault",
        kind: { kind: "toggle", default: true },
        program_writable: false,
      },
      value: false,
      source: "vault",
    } as SettingEntry;
    host = await start(VAULT, [noConfirm]);
    asked = box.asked;
    press();
    await waitFor("la cartella va nel cestino", () =>
      withoutTypeReads(host.atGate("invokeCommand")).some((call) => call.args[0] === "folder.trash"));
    expect(box.asked).toBe(asked);
  });

  it("da fuori dell'albero rinomina la nota attiva, portandola in vista", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    expect(noteItem("note/Riunione.md")).toBeNull();

    const rename = await command("shell.explorer.rename");
    expect(rename?.binding).toBeNull();
    await rename!.run!();
    await settle();
    const field = noteItem("note/Riunione.md")?.querySelector<HTMLInputElement>("input");
    expect(field?.value).toBe("Riunione");
    expect(document.activeElement).toBe(field);
  });

  it("dopo la rinomina il fuoco resta sulla riga rinominata, o va dove si è cliccato (B-02)", async () => {
    await start(VAULT);
    noteItem("note")!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    const rename = (from: string, name: string, commit: (field: HTMLInputElement) => void): void => {
      noteItem(from)!.focus();
      noteItem(from)!.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
      const field = noteItem(from)!.querySelector<HTMLInputElement>("input")!;
      expect(document.activeElement).toBe(field);
      field.value = name;
      commit(field);
    };

    // Invio: il fuoco segue la voce al nome nuovo, non cade su `body`.
    rename("note/Spesa.md", "Lista", (field) =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await waitFor("la voce rinominata", () => !!noteItem("note/Lista.md"));
    await settle();
    expect(document.activeElement).toBe(noteItem("note/Lista.md"));

    // Un clic fuori su niente di focalizzabile: il fuoco torna alla riga.
    rename("note/Lista.md", "Elenco", (field) =>
      field.dispatchEvent(new FocusEvent("blur", { relatedTarget: null })));
    await waitFor("la voce rinominata ancora", () => !!noteItem("note/Elenco.md"));
    await settle();
    expect(document.activeElement).toBe(noteItem("note/Elenco.md"));

    // Un clic su un controllo: il fuoco resta lì.
    const elsewhere = document.getElementById("new-note")!;
    rename("note/Elenco.md", "Compere", (field) => {
      field.dispatchEvent(new FocusEvent("blur", { relatedTarget: elsewhere }));
      elsewhere.focus();
    });
    await waitFor("la terza rinomina", () => !!noteItem("note/Compere.md"));
    await settle();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("un nome rifiutato riapre il campo col testo digitato e la frase accanto", async () => {
    const host = await start(VAULT);
    noteItem("note")!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    noteItem("note/Spesa.md")!.focus();
    noteItem("note/Spesa.md")!.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    const field = noteItem("note/Spesa.md")!.querySelector<HTMLInputElement>("input")!;
    field.value = "CON";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await waitFor("il campo si riapre con la frase", () => !!noteItem("note/Spesa.md")?.querySelector(".tree-rename-problem"));
    const again = noteItem("note/Spesa.md")!.querySelector<HTMLInputElement>("input")!;
    expect(again.value).toBe("CON");
    expect(again.getAttribute("aria-invalid")).toBe("true");
    const problem = noteItem("note/Spesa.md")!.querySelector<HTMLElement>(".tree-rename-problem")!;
    expect(again.getAttribute("aria-describedby")).toBe(problem.id);
    expect(problem.textContent).toContain("CON");
    // Niente è partito verso il kernel, e alla prima battuta la frase se ne va.
    expect(withoutTypeReads(host.atGate("invokeCommand")).filter((c) => c.args[0] === "note.rename")).toHaveLength(0);
    again.dispatchEvent(new Event("input", { bubbles: true }));
    expect(noteItem("note/Spesa.md")!.querySelector(".tree-rename-problem")).toBeNull();
    expect(again.hasAttribute("aria-invalid")).toBe(false);
  });

  it("una cartella chiusa si apre sostandoci sopra col trascinamento, e non se si lascia prima", async () => {
    await start(VAULT);
    const dragEvent = (type: string): Event => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { effectAllowed: "", setData: () => {} } });
      return e;
    };
    const source = noteItem("Benvenuto.md")!.querySelector<HTMLElement>(".tree-row")!;
    const folder = noteItem("note")!.querySelector<HTMLElement>(".tree-row")!;
    source.dispatchEvent(dragEvent("dragstart"));
    // Un passaggio breve non apre niente.
    folder.dispatchEvent(dragEvent("dragover"));
    folder.dispatchEvent(new Event("dragleave", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    expect(noteItem("note/Spesa.md")).toBeNull();
    // Una sosta sì: il kernel risponde e le note della cartella compaiono.
    folder.dispatchEvent(dragEvent("dragover"));
    await waitFor("la cartella si apre da sola", () => !!noteItem("note/Spesa.md"), 3000);
    source.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(document.querySelectorAll(".drop-into")).toHaveLength(0);
  });

  it("nell'albero F2, Canc e il comando agiscono sulla voce col fuoco", async () => {
    const host = await start(VAULT);
    // La nota attiva è Benvenuto; il fuoco va sulla cartella e poi su una
    // nota diversa, e i gesti devono seguire il fuoco e non l'attiva.
    const folder = noteItem("note")!;
    folder.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    noteItem("note")!.focus();
    const trash = await command("shell.explorer.trash");
    expect(trash).toBeUndefined();

    const spesa = noteItem("note/Spesa.md")!;
    spesa.focus();
    const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    spesa.dispatchEvent(f2);
    expect(f2.defaultPrevented).toBe(true);
    const field = spesa.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe("Spesa");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();

    noteItem("note/Spesa.md")!.focus();
    await (await command("shell.explorer.trash"))!.run!();
    await waitFor("la voce col fuoco è nel cestino", () => host.trash().length === 1);

    const riunione = noteItem("note/Riunione.md")!;
    riunione.focus();
    const canc = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    riunione.dispatchEvent(canc);
    expect(canc.defaultPrevented).toBe(true);
    await waitFor("anche la seconda è nel cestino", () => host.trash().length === 2);
    expect(withoutTypeReads(host.atGate("invokeCommand")).map((call) => call.args.slice(0, 2))).toEqual([
      ["note.trash", { doc: "note/Spesa.md" }],
      ["note.trash", { doc: "note/Riunione.md" }],
    ]);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");
  });

  // IMP-154: la riga col fuoco sparisce dall'albero e il fuoco cadeva su
  // `body`, dove le battute dopo si perdevano. Resta nell'albero, sulla riga
  // vicina: la successiva, la precedente se era l'ultima, la cartella se è
  // rimasta vuota. Anche quando la nota cestinata era aperta e l'editor chiude.
  it("Canc lascia il fuoco sulla riga vicina, anche se la nota era aperta", async () => {
    const host = await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Spesa.md");
    await settle();
    noteItem("note")!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    const press = (path: string) => {
      const item = noteItem(path)!;
      item.focus();
      const canc = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      item.dispatchEvent(canc);
      expect(canc.defaultPrevented).toBe(true);
    };
    const focusedPath = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && active.matches('#file-list li[role="treeitem"]')
        ? active.dataset.path
        : `fuori dall'albero: ${active?.tagName ?? "niente"}`;
    };

    // Spesa è aperta ed è l'ultima della cartella: il fuoco va alla precedente.
    expect([...document.querySelectorAll(".pane .tab")].some((tab) => tab.textContent?.includes("Spesa"))).toBe(true);
    press("note/Spesa.md");
    await waitFor("Spesa è nel cestino", () => host.trash().length === 1 && !noteItem("note/Spesa.md"));
    await settle();
    expect([...document.querySelectorAll(".pane .tab")].some((tab) => tab.textContent?.includes("Spesa"))).toBe(false);
    expect(focusedPath()).toBe("note/Riunione.md");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("0");

    // L'ultima della cartella: il fuoco va alla cartella rimasta vuota, se
    // l'albero la disegna ancora (l'host finto la toglie con l'ultima nota),
    // altrimenti alla prima voce che resta.
    press("note/Riunione.md");
    await waitFor("Riunione è nel cestino", () => host.trash().length === 2 && !noteItem("note/Riunione.md"));
    await settle();
    expect(focusedPath()).toBe(noteItem("note") ? "note" : "Benvenuto.md");
  });

  it("Canc sulla prima di più note lascia il fuoco sulla successiva", async () => {
    const host = await start(VAULT);
    noteItem("note")!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    const riunione = noteItem("note/Riunione.md")!;
    riunione.focus();
    riunione.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    await waitFor("Riunione è nel cestino", () => host.trash().length === 1 && !noteItem("note/Riunione.md"));
    await settle();
    expect(document.activeElement).toBe(noteItem("note/Spesa.md"));
  });

  // IMP-6500: con una nota della cartella aperta, F2 sulla riga arrivata con le
  // frecce (dopo Tab) o col clic apre il campo, per la nota e per la cartella.
  // Ogni tasto va all'elemento col fuoco in quel momento, come da tastiera.
  it("F2 sulla riga raggiunta con le frecce o col clic apre il campo, con una nota della cartella aperta", async () => {
    const host = await start({ ...VAULT, "note/Altra.md": "x\n" });
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Spesa.md");
    await settle();
    const key = (name: string): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return event;
    };
    const focusedPath = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("li[role=treeitem]")?.dataset.path;
    const field = () => document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const renames = () => withoutTypeReads(host.atGate("invokeCommand")).filter((c) => /\.rename$/.test(String(c.args[0])));
    const walk = async (path: string, step: "ArrowDown" | "ArrowUp") => {
      for (let i = 0; i < 12 && focusedPath() !== path; i += 1) {
        key(step);
        await settle(2);
      }
      expect(focusedPath()).toBe(path);
    };

    // Tab porta il fuoco sulla voce dell'albero che lo tiene (tabindex 0).
    document.querySelector<HTMLElement>('#file-list li[role="treeitem"][tabindex="0"]')!.focus();
    await walk("note", "ArrowUp");
    if (noteItem("note")!.getAttribute("aria-expanded") === "false") key("ArrowRight");
    await waitFor("la cartella è aperta", () => !!noteItem("note/Riunione.md"));
    await walk("note/Riunione.md", "ArrowDown");

    // Riga-nota: F2, Esc lascia tutto com'era; F2, Invio col nome invariato pure.
    expect(key("F2").defaultPrevented).toBe(true);
    expect(field()?.value).toBe("Riunione");
    key("Escape");
    await settle();
    expect(focusedPath()).toBe("note/Riunione.md");
    key("F2");
    expect(field()?.value).toBe("Riunione");
    key("Enter");
    await settle();
    expect(focusedPath()).toBe("note/Riunione.md");
    expect(renames()).toEqual([]);

    // Un nome già usato da una sorella: il campo resta col perché accanto.
    key("F2");
    field()!.value = "Altra";
    key("Enter");
    await waitFor("il nome occupato è detto accanto al campo", () => !!noteItem("note/Riunione.md")?.querySelector(".tree-rename-problem"));
    expect(Object.keys(host.files())).toEqual(expect.arrayContaining(["note/Riunione.md", "note/Altra.md"]));
    key("Escape");
    await settle();

    // Un nome con «/»: la nota scende nella sottocartella, col nome dopo «/».
    noteItem("note/Riunione.md")!.focus();
    key("F2");
    field()!.value = "2026/Riunione";
    key("Enter");
    await waitFor("la nota è nella sottocartella", () => "note/2026/Riunione.md" in host.files());

    // Riga-cartella col clic: il fuoco è sulla riga, F2 apre il campo e la nota
    // aperta segue la cartella al nome nuovo.
    noteItem("note")!.focus();
    noteItem("note")!.querySelector<HTMLElement>(".tree-row")!.click();
    await settle();
    expect(focusedPath()).toBe("note");
    expect(key("F2").defaultPrevented).toBe(true);
    expect(field()?.value).toBe("note");
    field()!.value = "Lavoro nuovo";
    key("Enter");
    await waitFor("la cartella ha il nome nuovo", () => "Lavoro nuovo/Spesa.md" in host.files());
    expect(Object.keys(host.files()).some((path) => path.startsWith("note/"))).toBe(false);
    await waitFor("la scheda aperta segue", () =>
      [...document.querySelectorAll<HTMLElement>(".pane .tab")].some((tab) => tab.textContent?.includes("Spesa")));
  });
});

describe("una conferma sola", () => {
  // Una domanda sì/no passa sempre dalla porta di `platform/confirm.ts`:
  // prima segnalibri e workspace ne disegnavano una loro nel DOM, e la stessa
  // eliminazione si chiedeva in due modi diversi a seconda di chi la offriva.
  it("eliminare un workspace lo chiede al dialogo dell'app, e un no lo lascia", async () => {
    await start(VAULT);
    const workspaces = await import("./state/workspaces");
    const ui = await import("./state/workspaces-ui");
    const { layout } = await import("./state/layout");
    const saved = workspaces.saveWorkspace("Sera", layout, [], null)!;
    ui.setCurrentWorkspace(saved.id);
    const registry = await import("./ui/commands");
    const remove = registry.allCommands().find((entry) => entry.id === "shell.workspace.delete")!;

    const asked = box.asked;
    box.confirm = false;
    await remove.run!();
    expect(box.asked).toBe(asked + 1);
    expect(document.querySelector(".shell-dialog")).toBeNull();
    expect(workspaces.getWorkspace(saved.id)).not.toBeNull();

    box.confirm = true;
    await remove.run!();
    expect(box.asked).toBe(asked + 2);
    expect(workspaces.getWorkspace(saved.id)).toBeNull();
  });
});

describe("un workspace salvato segue le rinomine", () => {
  // I89: il layout vivo migrava la chiave, i workspace salvati no — e al
  // ripristino la nota rinominata usciva dalle schede come «mancante».
  it("rinominata la nota, il ripristino la riapre col nome nuovo", async () => {
    const host = await start(VAULT);
    const workspaces = await import("./state/workspaces");
    const { defaultLayout, openIn } = await import("./state/layout");
    const assetto = defaultLayout();
    openIn("main", "note/Spesa.md", assetto);
    openIn("main", "Benvenuto.md", assetto);
    assetto.panes.main.history = { past: [{ k: "doc", doc: "note/Spesa.md" }], future: [] };
    const saved = workspaces.saveWorkspace("Mattina", assetto, [], null)!;

    host.renameFromOutside("note/Spesa.md", "note/Lista della spesa.md");
    await waitFor("il workspace salvato nomina la nota nuova", () =>
      workspaces.getWorkspace(saved.id)!.layout.panes.main.tabs
        .some((tab) => tab.k === "doc" && tab.doc === "note/Lista della spesa.md"));

    const applied = await workspaces.applyWorkspace(saved.id, defaultLayout());
    expect(applied?.report.missingDocs).toEqual([]);
    expect(applied?.layout.panes.main.tabs.map((tab) => tab.k === "doc" ? tab.doc : tab.view))
      .toEqual(["note/Lista della spesa.md", "Benvenuto.md"]);
    expect(applied?.layout.panes.main.history?.past).toEqual([{ k: "doc", doc: "note/Lista della spesa.md" }]);
    expect(applied?.report.prunedHistory).toBe(0);
  });
});

describe("i pannelli laterali ricordati sulla macchina", () => {
  // Stavano in `localStorage`: adesso sono `chrome.sidebar.visible` e
  // `chrome.inspector.visible`, impostazioni della macchina come il resto
  // della cornice.
  const chrome = (key: string, kind: SettingEntry["spec"]["kind"], value: SettingEntry["value"],
    source: SettingEntry["source"] = "default"): SettingEntry => ({
    spec: { key, label: key, description: "", group: "", scope: "machine", kind, program_writable: false },
    value,
    source,
  });

  it("chiuso nell'impostazione resta chiuso, e riaprirlo lo scrive lì", async () => {
    localStorage.clear();
    const host = await start(VAULT, [
      chrome("chrome.schema", { kind: "number", default: 1, min: 1, max: 1 }, 1),
      chrome("chrome.sidebar.visible", { kind: "toggle", default: true }, false, "machine"),
      chrome("chrome.inspector.visible", { kind: "toggle", default: true }, true),
    ]);
    const sidebar = document.getElementById("sidebar")!;
    await waitFor("la barra si chiude come dice la macchina", () => sidebar.hidden);

    const registry = await import("./ui/commands");
    registry.allCommands().find((entry) => entry.id === "shell.sidebar.toggle")!.run!();
    await settle();
    expect(sidebar.hidden).toBe(false);
    expect(host.calls.filter((call) => call.gate === "setSetting").map((call) => call.args))
      .toContainEqual(["chrome.sidebar.visible", true]);
    expect(localStorage.getItem("fub.layout.sidebar")).toBeNull();
  });
});
