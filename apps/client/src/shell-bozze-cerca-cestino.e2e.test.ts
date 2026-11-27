// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): le bozze di crash, la ricerca e il cestino.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import { appendToTextEditor as typeInEditor } from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { SettingEntry, KnownVault } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";
import { withoutTypeReads } from "./state/note-type-commands";
import { start, settle, waitFor, documentReads, row, contextMenu, shortcut, shortcutField, textToVideo, VAULT, TRASH_VIEW, useShellHarness } from "./shell-e2e-support";

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

describe("le bozze di crash che smettono di arrivare sul disco", () => {
  /// Il buffer di crash (§15.2) è una rete: gira di fianco al lavoro vero e non
  /// racconta i propri inciampi, per la ragione scritta accanto a `writeDraft` —
  /// un avviso per ogni bozza non scritta insegnerebbe a ignorare gli avvisi.
  ///
  /// Ciò che invece va detto è il **passaggio**: un vault in sola lettura, un
  /// disco pieno, una share caduta spengono la rete mentre chi scrive continua a
  /// credere di averla, e lo scopre al riavvio dopo il crash, cioè quando non
  /// può più farci niente (difetto 0209). Le due metà si guardano insieme,
  /// perché sono l'una il limite dell'altra: **lo dice**, e **lo dice una volta
  /// sola** — il debounce ci riprova a ogni battuta, e una riga per tentativo
  /// sarebbe di nuovo il rumore che il silenzio voleva evitare.
  it("lo dicono la prima volta, e non a ogni tentativo", async () => {
    const host = await start(VAULT);
    const { recentNotices } = await import("./ui/notify");
    const blind = () =>
      recentNotices().filter((a) => a.text.includes("non arriva più sul disco"));
    // Il vault diventa di sola lettura sotto i piedi: la nota non si salva e la
    // bozza nemmeno. Il primo guasto è ciò che porta la bozza al disco senza
    // aspettare il secondo — `scriviBuffer`, fallendo, la scrive subito.
    const repairDisk = host.fault("writeDocument", "vault in sola lettura");
    const repairDraft = host.fault("saveDraft", "vault in sola lettura");

    typeInEditor("la prima riga");
    await waitFor("la prima bozza tentata", () => host.atGate("saveDraft").length >= 1);
    expect(
      blind().length,
      "le bozze non arrivano più sul disco e nessuno l'ha detto: la rete di " +
        "sicurezza è spenta mentre chi scrive crede di averla",
    ).toBe(1);

    typeInEditor(" e la seconda");
    await waitFor("la seconda bozza tentata", () => host.atGate("saveDraft").length >= 2);
    expect(
      blind().length,
      "una riga di avviso per ogni bozza tentata: è il rumore che insegna a " +
        "ignorare gli avvisi",
    ).toBe(1);

    // E la terza metà, senza la quale la prima diventa «lo dice una volta e poi
    // mai più»: una share che va e viene se ne va più di una volta, e la
    // seconda caduta è una notizia come la prima. La nota continua a non
    // salvarsi — è ciò che porta la bozza al disco — ma la bozza sì, e con lei
    // il silenzio riparte da capo.
    repairDraft();
    typeInEditor(" con la rete tornata");
    await waitFor("la bozza scritta davvero", () => host.atGate("saveDraft").length >= 3);
    host.fault("saveDraft", "la share se n'è andata di nuovo");
    typeInEditor(" e la rete di nuovo caduta");
    await waitFor("la bozza tentata da capo", () => host.atGate("saveDraft").length >= 4);
    expect(
      blind().length,
      "la rete è caduta due volte e l'ha detto una: dopo il primo guasto il " +
        "canale resta muto per sempre",
    ).toBe(2);

    repairDisk();
  });
});

describe("le bozze e il salvataggio vanno in fila", () => {
  /// `writeDraft`/`dropDraft` chiamano gli IPC `save_draft`/`discard_draft`
  /// dalla stessa `Coda` che serializza i salvataggi di quel buffer, e non per
  /// conto loro: senza fila, un `discard_draft` può arrivare al kernel prima
  /// di un `save_draft` già in volo, e la bozza stantia sopravvive al buffer
  /// pulito — al riavvio la si ripropone sopra contenuto buono.
  ///
  /// La corsa la scrive il banco, non la spera: `frena` tiene lo `save_draft`
  /// in volo finché non lo si libera, e si guarda cosa parte e in che ordine.
  it("un discard non scavalca uno save_draft in volo", async () => {
    const host = await start(VAULT);
    // Metto in volo uno save_draft e lo tengo fermo. Parte subito, perché il
    // salvataggio fallendo lo scrive senza aspettare il debounce di un secondo.
    const repairDisk = host.fault("writeDocument", "disco pieno");
    const unlockDraft = host.throttle("saveDraft");
    typeInEditor("testo che il disco rifiuta");
    await waitFor(
      "la bozza parte dopo il salvataggio fallito",
      () => host.atGate("saveDraft").length === 1,
    );
    // Lo save_draft è in volo, trattenuto dal freno.

    // Riparo il disco e batto ancora: il salvataggio riuscirebbe e, pulendo
    // il buffer, scatenerebbe il discard. Senza fila il discard partiva subito
    // — mentre lo save_draft era ancora in volo.
    repairDisk();
    typeInEditor(" e adesso il disco lo prende");
    // Sotto la fila il secondo salvataggio resta in coda dietro lo save_draft
    // in volo, e il suo discard non parte; senza fila partiva subito — mentre
    // lo save_draft era ancora in volo. `attendi` fallisce se la condizione non
    // si avvera entro il debounce, ed è l'esito giusto: il discard non deve
    // partire. Si ribalta l'eccezione in «non partito».
    let discardInFlight = true;
    try {
      await waitFor(
        "il discard NON parte mentre save_draft è in volo",
        () => host.atGate("discardDraft").length > 0,
        700,
      );
    } catch {
      discardInFlight = false;
    }
    expect(
      discardInFlight,
      "il discard è partito mentre lo save_draft era ancora in volo: le bozze " +
        "non vanno in fila col salvataggio",
    ).toBe(false);

    // Libero lo save_draft: il discard ha il suo turno, e gli arriva DOPO.
    unlockDraft();
    await waitFor(
      "il discard parte dopo lo save_draft",
      () => host.atGate("discardDraft").length === 1,
    );
    const beforeDraft = host.calls.findIndex((c) => c.gate === "saveDraft");
    const afterDiscard = host.calls.findIndex((c) => c.gate === "discardDraft");
    expect(
      afterDiscard,
      "lo save_draft è arrivato al kernel dopo il discard: l'ordine non è FIFO",
    ).toBeGreaterThan(beforeDraft);
  });

  /// L'altra metà di una fila che non si avvelena: uno `save_draft` rifiutato
  /// non deve fermare ciò che viene dopo. Il rigetto è inghiottito dentro
  /// `writeDraft` (la singola bozza non racconta i propri inciampi), e la
  /// `Coda` prosegue comunque — ma se così non fosse, il discard successivo
  /// non partirebbe mai, ed è ciò che si guarda.
  it("uno save_draft rifiutato non avvelena la fila", async () => {
    const host = await start(VAULT);
    // Anche la bozza viene rifiutata: save_draft rigetta.
    const repairDisk = host.fault("writeDocument", "disco pieno");
    const repairDraft = host.fault("saveDraft", "disco pieno");
    typeInEditor("testo che né il disco né la bozza accettano");
    await waitFor(
      "il primo save_draft rifiutato parte",
      () => host.atGate("saveDraft").length === 1,
    );

    // Se il rigetto avvelenasse la coda, ciò che viene dopo non partirebbe mai.
    repairDisk();
    repairDraft();
    typeInEditor(" e invece tutto riparte");
    // Il salvataggio riesce → pulisce il buffer → discard della bozza. Che la
    // fila sia viva dopo il rifiuto lo dice il fatto che il discard arrivi.
    await waitFor(
      "il discard parte dopo lo save_draft rifiutato",
      () => host.atGate("discardDraft").length === 1,
    );
    expect(
      host.atGate("discardDraft").length,
      "il discard non è partito: la fila si è avvelenata al save_draft rifiutato",
    ).toBe(1);
  });
});

describe("spostare un file col testo non ancora sul disco", () => {
  /// Il gesto è la rinomina, e ciò che si guarda è **se parte**.
  ///
  /// `flushPendingSave` esiste per una ragione sola: il kernel, muovendo un
  /// file, riscrive i wikilink entranti di file di terzi, e un buffer rimasto
  /// sporco li ricopre col testo di prima al salvataggio successivo. La
  /// funzione però non alzava mai — un salvataggio fallito lo dice il buffer,
  /// che resta sporco — quindi chi la chiamava proseguiva identico che i byte
  /// fossero sul disco o no: una precondizione di cui nessuno leggeva l'esito
  /// (difetto 0206).
  it("la rinomina non parte, e lo dice", async () => {
    const host = await start(VAULT);
    typeInEditor("testo che il disco rifiuta");
    const repair = host.fault("writeDocument", "disco pieno");

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle(20);

    const renames = withoutTypeReads(host.atGate("invokeCommand")).filter((c) => c.args[0] === "note.rename");
    expect(
      renames,
      "il file si è mosso mentre il testo battuto era solo in RAM: la " +
        "riscrittura dei wikilink del kernel finirà sotto il salvataggio dopo",
    ).toEqual([]);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");
    // E chi guarda lo sa: il rifiuto è una frase, non un gesto che non fa niente.
    expect(document.body.textContent).toContain("Le ultime modifiche di Benvenuto.md non sono ancora salvate");

    repair();
  });

  /// L'altra metà: `convertToFolder` sposta il file esattamente come la
  /// rinomina — è una rinomina — e non metteva in salvo niente affatto.
  it("la conversione in cartella mette in salvo prima di muovere", async () => {
    const host = await start(VAULT);
    typeInEditor("battuta prima di convertire");

    await contextMenu(row("Benvenuto"), "Organizza", "Converti in cartella");
    await settle(20);

    const writing = host.calls.findIndex((c) => c.gate === "writeDocument");
    const moved = host.calls.findIndex(
      (c) => c.gate === "invokeCommand" && c.args[0] === "note.rename",
    );
    expect(moved, "la conversione non è arrivata al kernel").toBeGreaterThan(-1);
    expect(
      writing,
      "il file è stato mosso senza mettere in salvo il buffer: il testo battuto " +
        "è ancora solo in RAM mentre il kernel riscrive i wikilink",
    ).toBeGreaterThan(-1);
    expect(writing).toBeLessThan(moved);
    // La nota diventa la pagina della cartella nuova (decisione 0229).
    expect(host.calls[moved].args[1]).toMatchObject({ doc: "Benvenuto.md", to: "Benvenuto/_index.md" });
  });
});

describe("l'albero e le icone", () => {
  it("una cartella senza icona ha la figura a tratto, e quella scelta la sostituisce", async () => {
    await start(VAULT);
    const folder = () => document.querySelector<HTMLElement>("#file-list .tree-row.folder")!;
    await waitFor("la cartella è disegnata", () => document.querySelector("#file-list .tree-row.folder") !== null);
    expect(folder().querySelector(".row-icon > svg")).not.toBeNull();
    const path = folder().closest<HTMLElement>("[data-path]")!.dataset.path!;
    const { setIcon } = await import("./state/organization");
    await setIcon(path, "📚");
    await waitFor("l'icona scelta arriva", () => folder().querySelector(".row-icon")?.textContent === "📚");
    expect(folder().querySelector(".row-icon > svg")).toBeNull();
  });
});

describe("cerca", () => {
  it("ordina per nome e comprime i risultati, dal pannello", async () => {
    await start(VAULT);
    const field = document.querySelector<HTMLInputElement>("#search-input")!;
    field.value = "e";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor("i risultati arrivano", () => document.querySelectorAll("#search-results li > button.search-result").length > 1);
    const order = document.querySelector<HTMLSelectElement>("#search-results select")!;
    order.value = "name-desc";
    order.dispatchEvent(new Event("change", { bubbles: true }));
    const titles = () =>
      [...document.querySelectorAll<HTMLElement>("#search-results .hit-path")].map((e) => e.textContent ?? "");
    await waitFor("l'ordine cambia", () => {
      const list = titles();
      return list.length > 1 && list[0] !== [...list].sort((x, y) => x.localeCompare(y, "it", { numeric: true }))[0];
    });
    expect(titles()).toEqual([...titles()].sort((x, y) => y.localeCompare(x, "it", { numeric: true })));
    // Comprimere sta nel menu «⋯» degli strumenti, con le altre azioni rare.
    document.querySelector<HTMLButtonElement>("#search-results .search-tools .search-more")!.click();
    const collapse = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitemcheckbox]")]
      .find((item) => item.textContent?.includes("Comprimi"))!;
    expect(collapse.getAttribute("aria-checked")).toBe("false");
    collapse.click();
    expect(document.querySelectorAll("#search-results .hit-snippet").length).toBe(0);
  });

  it("un risultato si trascina come la nota che è", async () => {
    await start(VAULT);
    const field = document.querySelector<HTMLInputElement>("#search-input")!;
    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor("i risultati arrivano", () => document.querySelectorAll("#search-results li > button.search-result").length > 0);
    const result = document.querySelector<HTMLButtonElement>("#search-results li > button.search-result")!;
    expect(result.draggable).toBe(true);
    const offered = new Map<string, string>();
    const begin = new Event("dragstart", { bubbles: true, cancelable: true });
    const transfer = { effectAllowed: "", dropEffect: "", types: [], files: [], items: [], setData: (kind: string, value: string) => offered.set(kind, value) };
    Object.defineProperty(begin, "dataTransfer", { value: transfer });
    result.dispatchEvent(begin);
    expect(offered.get("application/x-fub-note")).toBe("note/Spesa.md");
    expect(JSON.parse(offered.get("application/x-fub-entries")!)).toEqual([{ id: "note/Spesa.md", note: true }]);
    expect(offered.get("text/uri-list")).toBe("file:///vault/note/Spesa.md");
    expect(transfer.effectAllowed).toBe("copy");
  });

  it("una ricerca che tarda mostra la sagoma dei risultati, e la toglie quando arrivano", async () => {
    const host = await start(VAULT);
    const unlock = host.throttle("queryIndex");
    const field = document.querySelector<HTMLInputElement>("#search-input")!;
    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const results = document.querySelector<HTMLElement>("#search-results")!;
    await waitFor("la sagoma compare", () => results.querySelector(":scope > li.skeleton") !== null);
    expect(results.getAttribute("aria-busy")).toBe("true");
    expect(results.querySelector(".skeleton")!.getAttribute("aria-hidden")).toBe("true");
    unlock();
    await waitFor("i risultati arrivano", () => results.querySelectorAll("li > button.search-result").length > 0);
    expect(results.querySelector(".skeleton")).toBeNull();
    expect(results.hasAttribute("aria-busy")).toBe(false);
  });

  it("esclusa l'unica nota, la lista offre di togliere le esclusioni", async () => {
    await start(VAULT);
    const field = document.querySelector<HTMLInputElement>("#search-input")!;
    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor("i risultati arrivano", () => document.querySelectorAll("#search-results li > button.search-result").length > 0);
    [...document.querySelectorAll<HTMLButtonElement>("#search-results .search-action")]
      .find((button) => button.textContent === "Escludi")!.click();
    const clear = () => [...document.querySelectorAll<HTMLButtonElement>("#search-results li > button.search-result")]
      .find((button) => button.textContent === "Togli le esclusioni (1)");
    await waitFor("la via d'uscita c'è", () => clear() !== undefined);
    clear()!.click();
    await waitFor("la nota torna", () => document.querySelector("#search-results .hit-path")?.textContent?.includes("Spesa") === true);
    expect(clear()).toBeUndefined();
  });

  it("la casella trova, e il risultato apre il documento", async () => {
    const host = await start(VAULT);
    const field = document.querySelector<HTMLInputElement>("#search-input");
    if (!field) throw new Error("la casella di ricerca non c'è");

    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(
      "i risultati arrivano",
      () => document.querySelectorAll("#search-results li").length > 0,
    );

    const results = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "#search-results li > button.search-result",
      ),
    ];
    expect(results.map((r) => r.textContent)).toHaveLength(1);
    expect(results[0].textContent).toContain("Spesa");

    results[0].click();
    await waitFor("il documento cercato si apre", () =>
      documentReads(host).some((c) => c.args[0] === "note/Spesa.md"),
    );
    await settle();
    expect(textToVideo()).toContain("pane, latte, arance");
  });

  it("l'estratto del risultato taglia sui byte, e il testo del provider resta testo", async () => {
    const host = await start(VAULT);
    // Il finto non scrive estratti: la sua risposta passa, con uno aggiunto.
    // «però» sta ai byte 3..8 e non 3..7, perché la `ò` ne occupa due; i tag
    // sono testo del provider, e devono restare testo.
    const answer = host.module.api.queryIndex;
    vi.spyOn(host.module.api, "queryIndex").mockImplementation(async (query) => {
      const result = await answer(query);
      if (result.kind !== "documents") return result;
      const items = result.value.items.map((row) => ({
        ...row,
        snippet: "<b>però</b> arance",
        highlights: [{ start: 3, end: 8 }],
      }));
      return { ...result, value: { ...result.value, items } };
    });
    const field = document.querySelector<HTMLInputElement>("#search-input");
    if (!field) throw new Error("la casella di ricerca non c'è");

    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(
      "l'estratto arriva",
      () => document.querySelector("#search-results .hit-snippet") !== null,
    );

    const snippet = document.querySelector<HTMLElement>("#search-results .hit-snippet");
    if (!snippet) throw new Error("l'estratto non c'è");
    expect(snippet.textContent).toBe("<b>però</b> arance");
    expect([...snippet.children].map((e) => e.tagName)).toEqual(["MARK"]);
    expect(snippet.children[0].textContent).toBe("però");
  });
});

describe("ripristina", () => {
  it("una nota cestinata torna dalla view del cestino, che la shell non conosce", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Sposta nel cestino");
    await waitFor("la nota è nel cestino", () => host.trash().length === 1);
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");

    // Il cestino è un `ViewProvider`: la shell disegna l'albero che riceve e
    // rimanda l'azione a chi l'ha disegnato, **senza sapere cosa faccia**. È il
    // percorso di un plugin, ed è il solo dei cinque gesti che non passa da una
    // riga di questo bundle.
    await waitFor("la view del cestino si disegna", () => trashEntries().length === 1);
    trashEntries()[0].click();
    await waitFor("la nota è tornata", () => Object.keys(host.files()).includes("Benvenuto.md"));

    const actions = host.atGate("viewAction");
    const action = actions[actions.length - 1];
    expect(action?.args[0]).toBe(TRASH_VIEW);
    expect(action?.args[3]).toBe("restore");
  });
});

describe("il cestino scelto", () => {
  it("con il cestino di sistema la cancellazione passa da trash.os e il ripiego si dice", async () => {
    const choice: SettingEntry = {
      spec: {
        key: "files.trash",
        label: "Note cancellate",
        description: "",
        group: "",
        scope: "vault",
        kind: {
          kind: "choice",
          default: "vault",
          options: [
            { value: "vault", label: "Cestino del vault" },
            { value: "system", label: "Cestino del sistema" },
          ],
        },
        program_writable: false,
      },
      value: "system",
      source: "vault",
    } as SettingEntry;
    const host = await start(VAULT, [choice]);

    await contextMenu(row("Benvenuto"), "Sposta nel cestino");
    await waitFor("la nota è nel cestino", () => host.trash().length === 1);
    expect(withoutTypeReads(host.atGate("invokeCommand")).map((call) => call.args[0])).toEqual(["trash.os"]);
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().some((a) => a.text.includes("cestino del vault"))).toBe(true);
  });
});

function trashEntries(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#views-left .ui-list-item")];
}

describe("riconfigura una scorciatoia", () => {
  it("una scorciatoia della shell si cambia dal pannello, e da lì risponde la nuova", async () => {
    // L'ottavo gesto, e il primo che attraversa il pannello delle impostazioni.
    // È la casella che la 0090 aveva trasferito alla §16.3: la chiave
    // `keys.shell.*` la dichiara il bundle di core ed è di **macchina**, perché
    // un comando di shell esiste prima di ogni vault. Qui il gesto è quello che
    // l'utente fa — apri le impostazioni, vai alle scorciatoie, scrivi una
    // combinazione — e ciò che si asserisce è che la tastiera la onori.
    const host = await start(VAULT, [shortcut("shell.palette")]);

    const field = await shortcutField("Apri la palette dei comandi");
    expect(field.value).toBe(SHELL_KEYS["shell.palette"]);
    field.value = "Mod-Alt-p";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    // È arrivata alla porta con la chiave giusta: senza questa riga il gesto
    // potrebbe scrivere la chiave di un altro comando e sembrare a posto.
    const writtenItems = host.atGate("setSetting");
    const written = writtenItems[writtenItems.length - 1];
    expect(written?.args[0]).toBe("keys.shell.palette");
    expect(written?.args[1]).toBe("Mod-Alt-p");

    // Il pannello intrappola il fuoco, quindi si chiude prima di premere —
    // come fa chi ha finito di configurare.
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await settle();

    // La combinazione nuova apre il lanciatore sui comandi, premuta sul
    // documento come da un browser: è la riga che dice che il giro è chiuso —
    // scritta, riletta, e onorata senza riavviare niente.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, altKey: true }),
    );
    await settle();
    const { t } = await import("./i18n/strings");
    expect(document.querySelector(".launcher")).not.toBeNull();
    expect(document.querySelector(".launcher-input")?.getAttribute("placeholder")).toBe(
      t("launcher.placeholder.commands"),
    );

    // E la vecchia non è più di nessuno. La domanda si pone al **registro** e
    // non premendola, per un limite di questo banco che vale la pena scrivere:
    // `document` è uno solo per tutto il file e nessuno smonta i suoi
    // ascoltatori, quindi ogni `start()` ne lascia uno addosso — premere
    // `Mod-Shift-p` qui farebbe rispondere la tastiera di un gesto precedente,
    // che ha un registro suo e non sa niente di questa scrittura. È un fatto
    // del banco, non della shell.
    const registry = await import("./ui/commands");
    expect(
      registry.advance(registry.allCommands(), null, {
        key: "p",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({ type: "passa" });
  });
});
