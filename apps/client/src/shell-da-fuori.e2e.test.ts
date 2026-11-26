// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): la finestra senza vault e ciò che arriva da fuori.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import { appendToTextEditor as typeInEditor, mountedTextEditors as editorViews } from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { KernelNotice, SettingEntry, CommandSpec, KnownVault } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";
import { start, settle, waitFor, shortcut, VAULT, useShellHarness } from "./shell-e2e-support";

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

describe("la finestra senza vault", () => {
  it("conosce comunque le scorciatoie riconfigurate, che sono della macchina", async () => {
    // Il caso per cui la famiglia `keys.shell.*` è di macchina e non di vault
    // (§16.3): `shell.vault.open` è il comando che serve ad aprire il primo
    // vault, e una sua chiave che vivesse dentro un vault esisterebbe solo dopo
    // — cioè quando serve meno. Qui non c'è nessun vault, e l'accordo che
    // l'utente ha scelto è già quello che vale.
    const chord = { ...shortcut("shell.palette"), value: "Mod-Alt-p", source: "machine" };
    await start({}, [chord as SettingEntry], null);
    expect(document.querySelector("#vault-path")?.textContent).not.toBe("/vault");

    // La domanda si pone al **registro** e non premendo, per il limite del banco
    // scritto qui sopra: su un `document` che nessuno smonta, un tasto premuto
    // qui lo riceve anche la tastiera dei gesti precedenti. Ciò che questa riga
    // difende è l'**ordine dell'avvio** — gli accordi si rileggono prima di
    // sapere se un vault c'è — e quello si vede dal registro.
    const registry = await import("./ui/commands");
    const palette = registry.allCommands().find((e) => e.id === "shell.palette");
    expect(palette?.binding).toBe("Mod-Alt-p");
    expect(palette?.declared).toBe(SHELL_KEYS["shell.palette"]);
  });

  it("chiede l'avviso di sessione all'avvio, e lo mostra se c'è", async () => {
    // §25.5: la diagnosi «la cartella di configurazione non si può scrivere»
    // nasce all'avvio del backend, quando nessun ascoltatore esiste — una
    // spinta sarebbe persa, e la porta è un tiraggio. Questo gesto tiene ferma
    // la catena intera: la shell lo chiede (il registro del finto lo vede),
    // e lo consegna al router come un evento qualunque (lo storico dei toast
    // lo mostra). Si fa rosso in due versi: senza la chiamata in `init()`
    // il registro non vede nulla, senza l'inoltro il toast non appare.
    const notice: KernelNotice = {
      event: {
        type: "trouble",
        severity: "warning",
        subject: null,
        error: { kind: "io", message: "`/config` non si può scrivere" },
        gate: null,
      },
      origin: { actor: { kind: "kernel" }, batch: null },
    };
    const host = await start({}, [], null, notice);

    // Un tiraggio per l'avviso, uno che risponde vuoto e ferma il ciclo.
    expect(host.atGate("sessionNotice").length).toBe(2);
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().some((a) => a.text.includes("non si può scrivere"))).toBe(true);

    // E una sessione sana non dice niente: il tiraggio c'è, la risposta è
    // vuota, e lo storico resta pulito. `recentNotices` si ri-importa dopo
    // ogni `start`: `vi.resetModules` ricarica i moduli, e l'istanza di prima
    // è quella della sessione con l'avviso.
    const healthy = await start({}, [], null);
    const { recentNotices: healthyRecent } = await import("./ui/notify");
    expect(healthy.atGate("sessionNotice").length).toBe(1);
    expect(healthyRecent().some((a) => a.text.includes("non si può scrivere"))).toBe(false);
  });

  it("dopo la diagnosi tira gli avvisi del percorso di disegno e li mostra", async () => {
    // Il driver disallineato nasce in `fub_app::run` prima di GTK, e arriva
    // in coda all'avviso di sessione come `custom` col topic `rendering`:
    // senza il ciclo dei tiraggi si vedrebbe solo il primo.
    const trouble: KernelNotice = {
      event: {
        type: "trouble",
        severity: "warning",
        subject: null,
        error: { kind: "io", message: "`/config` non si può scrivere" },
        gate: null,
      },
      origin: { actor: { kind: "kernel" }, batch: null },
    };
    const rendering: KernelNotice = {
      event: {
        type: "custom",
        topic: "rendering",
        payload: { kind: "driver_mismatch", kernel: "550.163.01", library: "595.112.07" },
      },
      origin: { actor: { kind: "kernel" }, batch: null },
    };
    const host = await start({}, [], null, [trouble, rendering]);

    expect(host.atGate("sessionNotice").length).toBe(3);
    const { recentNotices } = await import("./ui/notify");
    const texts = recentNotices().map((a) => a.text);
    expect(texts.some((text) => text.includes("non si può scrivere"))).toBe(true);
    expect(texts.some((text) => text.includes("riavvia il computer") && text.includes("550.163.01"))).toBe(true);
  });
});

describe("i vault recenti nella schermata senza vault", () => {
  it("si tolgono dall'elenco senza toccare la cartella, e il fuoco resta nell'elenco", async () => {
    const vault = (root: string, name: string): KnownVault => ({
      root, name, icon: null, favorite: false, last_opened: 0, keys_seen: {},
    });
    box.known = [vault("/Vecchio", "Vecchio"), vault("/Appunti", "Appunti")];
    const host = await start({}, [], null);
    await waitFor("i recenti", () => document.querySelectorAll("#onboarding-recent li").length === 2);
    const forget = document.querySelector<HTMLButtonElement>("#onboarding-recent li .onboarding-forget")!;
    expect(forget.getAttribute("aria-label")).toContain("Vecchio");
    forget.focus();
    forget.click();
    await waitFor("l'elenco ridisegnato", () => document.querySelectorAll("#onboarding-recent li").length === 1);
    expect(host.atGate("forgetVault").map((call) => call.args[0])).toEqual(["/Vecchio"]);
    expect(document.querySelector("#onboarding-recent li")?.textContent).toContain("Appunti");
    await waitFor("il fuoco nell'elenco", () => document.activeElement?.closest("#onboarding-recent") !== null);
  });
});

describe("una rinomina che questa finestra non ha chiesto", () => {
  it("porta con sé il buffer sporco, e il salvataggio in attesa con lui", async () => {
    // Un `mv` da terminale, un'altra applicazione, un sync: la rinomina arriva
    // come evento mentre qui c'è del testo battuto e non ancora salvato. È il
    // caso che `renameDoc` non produce mai — chi rinomina da questa finestra
    // mette in salvo i buffer prima di chiedere — e quindi il solo modo di
    // provarlo è dall'evento.
    const host = await start(VAULT);
    typeInEditor("testo non ancora salvato");
    host.renameFromOutside("Benvenuto.md", "Fuori.md");

    await waitFor("il salvataggio in attesa arriva", () => host.atGate("writeDocument").length > 0);
    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Fuori.md");
    expect(String(written.args[1])).toContain("testo non ancora salvato");
    // E il path vecchio **non** rinasce: era il difetto gemello, e sarebbe
    // passato per una nota duplicata invece che per una battuta persa.
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("lascia l'editor dov'era: stesso editor, stesso fuoco, stesso cursore (IMP-046)", async () => {
    // La scheda segue il nome nuovo, ma rimontare la superficie buttava via il
    // fuoco: le battute dopo un `mv` da fuori finivano sul body, perse.
    const host = await start(VAULT);
    const before = editorViews()[0]!;
    before.focus();
    before.dispatch({ selection: { anchor: 3 } });
    expect(document.activeElement?.closest(".cm-content")).not.toBeNull();

    host.renameFromOutside("Benvenuto.md", "Fuori.md");
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some((el) => el.textContent === "Fuori"));
    await settle();

    const after = editorViews();
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before);
    expect(before.dom.isConnected).toBe(true);
    expect(document.activeElement?.closest(".cm-content")).not.toBeNull();
    expect(before.state.selection.main.head).toBe(3);

    // La battuta dopo la rinomina va alla sessione col nome nuovo, e da lì sul disco.
    before.dispatch({ changes: { from: 3, insert: "dopo" }, userEvent: "input.type" });
    await waitFor("il salvataggio parte col nome nuovo", () =>
      host.atGate("writeDocument").some((w) => w.args[0] === "Fuori.md" && String(w.args[1]).includes("dopo")));
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("con il fuoco in un altro pannello, la rinomina non lo sposta (IMP-046)", async () => {
    const host = await start(VAULT);
    const rail = document.querySelector<HTMLElement>("#rail button")!;
    rail.focus();
    expect(document.activeElement).toBe(rail);

    host.renameFromOutside("Benvenuto.md", "Fuori.md");
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some((el) => el.textContent === "Fuori"));
    await settle();
    expect(document.activeElement).toBe(rail);
  });

  it("cambiata l'estensione l'editor si rimonta, e fuoco e cursore tornano dov'erano (IMP-046)", async () => {
    // `.md` → `.markdown`: un'altra estensione chiede un montaggio nuovo, ma
    // per chi scrive la nota è la stessa: la battuta dopo deve entrarci.
    const host = await start(VAULT);
    const before = editorViews()[0]!;
    before.focus();
    before.dispatch({ selection: { anchor: 3 } });
    typeInEditorAt(before, 3, "prima");

    host.renameFromOutside("Benvenuto.md", "Benvenuto.markdown");
    await waitFor("l'editor si rimonta sul nome nuovo", () => {
      const now = editorViews();
      return now.length === 1 && now[0] !== before;
    });
    await settle();
    const after = editorViews()[0]!;
    expect(document.activeElement?.closest(".cm-content")).toBe(after.contentDOM);
    expect(after.state.selection.main.head).toBe(3 + "prima".length);

    after.dispatch({ changes: { from: after.state.selection.main.head, insert: "dopo" }, userEvent: "input.type" });
    await waitFor("tutto il testo arriva al nome nuovo", () =>
      host.atGate("writeDocument").some((w) => w.args[0] === "Benvenuto.markdown" && String(w.args[1]).includes("primadopo")));
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("cambiata l'estensione col fuoco altrove, il montaggio nuovo non lo prende (IMP-046)", async () => {
    const host = await start(VAULT);
    const rail = document.querySelector<HTMLElement>("#rail button")!;
    rail.focus();
    const before = editorViews()[0]!;

    host.renameFromOutside("Benvenuto.md", "Benvenuto.markdown");
    await waitFor("l'editor si rimonta sul nome nuovo", () => {
      const now = editorViews();
      return now.length === 1 && now[0] !== before;
    });
    await settle();
    expect(document.activeElement).toBe(rail);
  });
});

describe("un documento Word rinominato da fuori", () => {
  const RICH = JSON.stringify({ format: "fub-rich", version: 1, blocks: [{ t: "para", role: { kind: "body" }, c: [{ t: "text", x: "ciao" }] }] });

  /// Apre il Word dall'albero e aspetta che la pagina si possa scrivere.
  async function openLetter(): Promise<FakeHost> {
    const host = await start({ ...VAULT, "Lettera.docx": RICH });
    const row = () => document.querySelector<HTMLElement>('#file-list li[data-path="Lettera.docx"] > .tree-row');
    await waitFor("il Word è nell'albero", () => !!row());
    row()!.click();
    await waitFor("la pagina del Word si scrive", () =>
      document.querySelector<HTMLElement>(".pane.focus .rich-page [contenteditable=true]") !== null);
    await settle();
    return host;
  }

  const richPage = () => document.querySelector<HTMLElement>(".pane.focus .rich-page [contenteditable=true]");

  /// Il cursore all'inizio del testo della pagina, come dopo un clic lì.
  function caretAtStart(page: HTMLElement): void {
    const text = document.createTreeWalker(page, NodeFilter.SHOW_TEXT).nextNode()!;
    window.getSelection()!.collapse(text, 0);
    document.dispatchEvent(new Event("selectionchange"));
  }

  /// Una battuta come la dà il browser a una pagina scrivibile: il carattere
  /// entra nel nodo di testo dove sta la selezione del documento, e il motore
  /// lo legge dal DOM. Senza fuoco nella pagina (sul body) non entra da
  /// nessuna parte, come nell'app.
  function press(char: string): void {
    const editable = document.activeElement?.closest<HTMLElement>("[contenteditable=true]");
    if (!editable) return;
    const selection = window.getSelection()!;
    let node = selection.focusNode;
    let offset = selection.focusOffset;
    if (!node || !editable.contains(node)) return;
    if (node.nodeType !== Node.TEXT_NODE) {
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
      if (!text) return;
      node = text;
      offset = 0;
    }
    (node as Text).insertData(offset, char);
    selection.collapse(node, offset + char.length);
  }

  it("la pagina resta quella, col fuoco e il cursore, e la battuta dopo va sul nome nuovo (IMP-046)", async () => {
    const host = await openLetter();
    const page = richPage()!;
    page.focus();
    caretAtStart(page);
    press("a");
    await waitFor("la battuta entra", () => page.textContent?.includes("aciao") === true);

    host.renameFromOutside("Lettera.docx", "Lettera nuova.docx");
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some((el) => el.textContent === "Lettera nuova"));
    await settle();

    expect(richPage()).toBe(page);
    expect(page.isConnected).toBe(true);
    expect(page.contains(document.activeElement)).toBe(true);

    press("b");
    await waitFor("la battuta dopo entra al cursore di prima", () => page.textContent?.includes("abciao") === true);
    await waitFor("il salvataggio va al nome nuovo", () =>
      host.atGate("writeDocument").some((w) => w.args[0] === "Lettera nuova.docx" && String(w.args[1]).includes("abciao")));
    expect(Object.keys(host.files())).not.toContain("Lettera.docx");
  });

  it("il testo non salvato prima della rinomina arriva sul disco col nome nuovo", async () => {
    const host = await openLetter();
    const unlock = host.throttle("writeDocument");
    const page = richPage()!;
    page.focus();
    caretAtStart(page);
    press("z");
    await waitFor("la battuta entra", () => page.textContent?.includes("zciao") === true);

    host.renameFromOutside("Lettera.docx", "Archivio.docx");
    await settle();
    unlock();
    await waitFor("il testo arriva al nome nuovo", () => host.files()["Archivio.docx"]?.includes("zciao") === true);
    expect(Object.keys(host.files())).not.toContain("Lettera.docx");
  });

  it("con il fuoco in un altro pannello, la rinomina non lo sposta", async () => {
    const host = await openLetter();
    const rail = document.querySelector<HTMLElement>("#rail button")!;
    rail.focus();
    host.renameFromOutside("Lettera.docx", "Lettera nuova.docx");
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some((el) => el.textContent === "Lettera nuova"));
    await settle();
    expect(document.activeElement).toBe(rail);
  });
});

/// Scrive `text` a `at` come una battuta della persona, nella vista data.
function typeInEditorAt(view: ReturnType<typeof editorViews>[number], at: number, text: string): void {
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
}

describe("una nota cancellata da fuori con testo non salvato", () => {
  it("«Ricrea la nota» riscrive il testo e toglie la bozza che lo teneva (IMP-047)", async () => {
    // La bozza scritta alla cancellazione ha come base la revisione del file
    // sparito: lasciata lì dopo la ricreazione, alla riapertura dava un
    // conflitto con un disco uguale a lei.
    const host = await start(VAULT);
    const unlock = host.throttle("saveDraft");
    typeInEditor(" e il testo non salvato");
    expect(host.emit({ type: "document_removed", id: "Benvenuto.md" })).toBe(true);
    await waitFor("la bozza parte", () => host.atGate("saveDraft").some((call) => call.args[0] === "Benvenuto.md"));

    await waitFor("il riquadro offre di ricrearla", () =>
      !!document.querySelector('.sheet-notice[data-notice="removed"]'));
    const notice = document.querySelector<HTMLElement>('.sheet-notice[data-notice="removed"]')!;
    const action = [...notice.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Ricrea la nota");
    expect(action).toBeDefined();
    action!.click();
    await waitFor("il file torna col testo", () =>
      host.atGate("writeDocument").some((w) => w.args[0] === "Benvenuto.md" && String(w.args[1]).includes("il testo non salvato")));
    await settle();
    // La bozza è ancora in scrittura: scartarla prima la lascerebbe dopo.
    expect(host.atGate("discardDraft")).toHaveLength(0);

    unlock();
    await waitFor("la bozza se ne va", () => host.atGate("discardDraft").some((call) => call.args[0] === "Benvenuto.md"));
  });
});

describe("segui un link dentro la nota", () => {
  it("un `[[#Sezione]]` chiede al kernel col documento che lo ospita", async () => {
    // Il gesto è il click sul wikilink **reso** senza pagina, e la cosa che si
    // guarda sta di qua dal confine: *quale domanda* è partita. Un
    // `[[#Sezione]]` non nomina una nota, nomina questa — e chi lo risolve non
    // può saperlo se non gli si dice da dove si sta guardando.
    const host = await start({
      "Benvenuto.md": "Vedi [[#Appunti]] più sotto.\n\n## Appunti\n\nEccoli.\n",
    });
    const { setMode } = await import("./panels/document");
    await setMode("reading");
    await settle();
    const link = document.querySelector<HTMLElement>(".pane-preview.markdown-rendered a.wikilink");
    expect(link, "la lettura non ha reso il wikilink").not.toBeNull();
    link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle();

    const requested = host
      .atGate("queryIndex")
      .map((c) => c.args[0] as { kind: string; target?: { value: { page: string } }; from?: string | null })
      .filter((q) => q.kind === "resolve");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.target?.value.page).toBe("");
    expect(requested[0]!.from).toBe("Benvenuto.md");
  });
});

describe("la palette flussa prima di un comando che scrive", () => {
  // Il flush-before-patch di M3: un comando che scrive documenti riscrive
  // file — il kernel muove i wikilink entranti, la rinomina sposta la nota —
  // e un buffer rimasto sporco li ricoprirebbe col testo di prima al
  // salvataggio successivo. È la stessa guardia di `nonInSalvo`
  // dell'esploratore, e si prova qui perché la palette è l'altro posto in cui
  // un comando parte: la spec dichiara `writes`, e chi invoca deve salvare
  // prima di calcolare le patch.
  //
  // La spec è quella vera di `note.create` (commands.rs): un parametro `name`
  // facoltativo, raggio `document` — quindi niente piano, apply diretto.
  const specNoteCreate: CommandSpec = {
    id: "note.create",
    title: "Nuova nota",
    description: "",
    keybinding: null,
    params: [{ name: "name", title: "Nome", description: "", kind: { kind: "text" }, required: false }],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };

  /// Apre il lanciatore sui comandi con l'accordo di serie, cerca il comando
  /// del kernel e lo sceglie: prosegue nel modulo della palette. Il titolo da
  /// solo non basta, perché anche la shell ha una «Nuova nota»; la portata
  /// scritta accanto la ha solo il comando del kernel.
  async function chooseCommand(spec: CommandSpec): Promise<void> {
    const { scopeLabel } = await import("./ui/palette");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    const input = document.querySelector<HTMLInputElement>(".launcher-input")!;
    input.value = spec.title;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const row = (): HTMLElement | undefined =>
      [...document.querySelectorAll<HTMLElement>(".launcher-row")].find(
        (each) =>
          each.querySelector(".launcher-row-title")?.textContent === spec.title &&
          (each.querySelector(".launcher-row-main")?.textContent ?? "").includes(scopeLabel(spec)),
      );
    await waitFor(`il lanciatore offre «${spec.title}» del kernel`, () => row() !== undefined);
    row()!.click();
    await waitFor("la palette mostra il modulo", () => document.querySelector(".palette-form") !== null);
  }

  it("un buffer sporco si salva prima che note.create parta", async () => {
    const host = await start(VAULT, [], undefined, null, [specNoteCreate]);
    typeInEditor("testo non ancora salvato");

    // Il lanciatore si apre sui comandi con la scorciatoia di default, come da
    // un browser, e il comando si sceglie da lì.
    await chooseCommand(specNoteCreate);

    // Il comando ha un parametro facoltativo: la palette mostra il form.
    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "Appunti.md";
    // Il buffer si sporca subito prima dell'invio, a palette aperta:
    // l'autosave parte 400 ms dopo l'ultima battuta, e su una macchina carica
    // aprire la palette ne prende di più. Così non può arrivare prima del
    // comando, e un `writeDocument` prima di lui è soltanto il flush.
    typeInEditor("testo non ancora salvato");
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const flush = host.calls.findIndex((c) => c.gate === "writeDocument");
    const invoked = host.calls.findIndex(
      (c) => c.gate === "invokeCommand" && c.args[0] === "note.create",
    );
    expect(invoked, "note.create non è arrivato al kernel").toBeGreaterThan(-1);
    expect(flush, "il buffer sporco non è stato salvato affatto").toBeGreaterThan(-1);
    // **Il momento che conta.** Senza il flush, `writeDocument` non c'è (il
    // debounce di 400 ms non è scaduto) e il comando parte col testo solo in
    // RAM: `flush` sarebbe -1 e questa riga rossa.
    expect(flush, "il comando è partito prima del flush").toBeLessThan(invoked);
  });

  it("un comando di sola lettura non flussa", async () => {
    // La spec è quella vera di `search.open` (commands.rs): nessuno scope
    // dichiarato, quindi `read_only` per default. Un comando che non scrive
    // non deve pagare il giro del flush — e il banco lo prova col buffer
    // sporco: se la palette flussasse comunque, `writeDocument` avrebbe una
    // chiamata.
    const specSearchOpen: CommandSpec = {
      id: "search.open",
      title: "Cerca nel vault",
      description: "",
      keybinding: null,
      params: [{ name: "query", title: "Query", description: "", kind: { kind: "text" }, required: true }],
      scope: { writes: false, reach: "session", reversible: true },
      surfaces: [],
    };
    const host = await start(VAULT, [], undefined, null, [specSearchOpen]);

    await chooseCommand(specSearchOpen);

    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "rust";
    // Come sopra: il buffer si sporca subito prima dell'invio, perché
    // l'autosave non arrivi prima del comando.
    typeInEditor("testo non ancora salvato");
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const invoked = host.calls.findIndex(
      (c) => c.gate === "invokeCommand" && c.args[0] === "search.open",
    );
    expect(invoked, "search.open non è arrivato al kernel").toBeGreaterThan(-1);
    // L'autosave, 400 ms dopo la battuta, può arrivare dopo il comando; un
    // flush della palette verrebbe prima.
    expect(
      host.calls.slice(0, invoked).filter((c) => c.gate === "writeDocument"),
      "un comando di sola lettura non deve salvare i buffer",
    ).toHaveLength(0);
  });
});
