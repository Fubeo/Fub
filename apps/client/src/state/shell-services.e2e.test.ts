// @vitest-environment happy-dom
//
// **I servizi che non disegnano, guardati dal confine.**
//
// Quattro sequenze della shell decidono se un testo battuto arriva sul disco o
// si perde: l'apertura di un vault, la guardia di chiusura della finestra, il
// rilascio di una linguetta e il recupero delle bozze. `shell.e2e.test.ts` ne
// prova gli esiti (l'ultima battuta arriva al disco, la finestra resta aperta
// senza bozza, un «no» alla conferma tiene la nota); ciò che non guardava è
// **l'ordine e le condizioni** — quale porta viene prima di quale, cosa ferma
// la sequenza, cosa vale un dialogo che non risponde.
//
// È proprio ciò che uno spostamento di codice può cambiare senza che un esito
// si accorga di niente: un `flush` scivolato dopo l'`openVault`, un `emit`
// salito sopra il recupero delle bozze. Queste prove fissano la sequenza al
// confine con l'host (`host/fake.ts`) e sul bus dei segnali, quindi non sanno
// in quale modulo la sequenza abiti: devono restare verdi, immutate, quando si
// sposta.
//
// Come `shell.e2e.test.ts`, monta `main.ts` sulla scocca vera: il perché sta
// in testa a quel file, e vale qui parola per parola.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendToTextEditor as typeInEditor,
  mountedTextEditors as editorViews,
} from "../editors/text/test-support";
import type { FakeHost } from "../host/fake";
import type { DraftInfo } from "../host/contract";

vi.setConfig({ testTimeout: 20_000 });

// La scatola che `vi.mock` può vedere (le factory sono issate sopra gli
// import). Oltre all'host porta ciò che `host/fake.ts` non sa simulare e che
// queste prove devono poter decidere: le bozze dichiarate dal vault, un dialogo
// di conferma che può anche **fallire**, e un registro unico di porte e segnali.
const box = vi.hoisted(() => {
  const box = {
    host: null as FakeHost | null,
    /// Cosa risponde la conferma: un sì, un no, o un rifiuto.
    confirm: (): Promise<boolean> => Promise.resolve(true),
    /// Quante volte la conferma è stata chiesta.
    asked: 0,
    /// Le bozze che il vault dichiara: l'host finto risponde sempre «nessuna».
    drafts: [] as DraftInfo[],
    /// La domanda sulle bozze fallisce.
    draftsFail: false,
    /// L'aggancio alla chiusura della finestra fallisce.
    closeHookFails: false,
    /// Porte e segnali, nell'ordine in cui la shell li ha toccati.
    trace: [] as string[],
    /// Ciò che una prova vuole guardare **nell'istante** di un passo.
    probes: new Map<string, () => void>(),
    mark(step: string): void {
      box.trace.push(step);
      box.probes.get(step)?.();
    },
  };
  return box;
});

let activeStop: (() => void) | null = null;
/// Le sessioni del giro in corso. Smontare la shell non le chiude (in
/// produzione la pagina muore con lei), ma qui il mock dell'host delega
/// all'host **di adesso**: un salvataggio rimasto in attesa nel giro di prima
/// scriverebbe sul vault della prova dopo.
let activeSessions: { closeAll(): unknown } | null = null;

/// Il nome di un passo nel registro: la porta, e per le due porte generiche
/// ciò che distingue una chiamata dall'altra.
function stepName(name: string, args: unknown[]): string {
  const first = args[0];
  if (name === "queryIndex" && first && typeof first === "object") {
    return `queryIndex:${String((first as { kind?: unknown }).kind)}`;
  }
  if ((name === "viewState" || name === "setViewState") && typeof first === "string") {
    return `${name}:${first}`;
  }
  return name;
}

// Un modulo mimato solo, che delega all'host di adesso a ogni chiamata: il
// perché sta in `shell.e2e.test.ts` (`vi.resetModules()` non azzera i mock).
// In più registra ogni chiamata nel registro unico, e sostituisce la risposta
// della sola domanda sulle bozze — che passa comunque dalla porta finta, così
// freni, guasti e conteggi valgono anche per lei.
vi.mock("../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) => {
          const api = now().api as unknown as Record<string, (...a: unknown[]) => unknown>;
          const step = stepName(name, args);
          box.mark(step);
          const answer = api[name]!(...args);
          if (step !== "queryIndex:drafts") return answer;
          return (answer as Promise<unknown>).then(() => {
            if (box.draftsFail) throw new Error("indice delle bozze illeggibile");
            return {
              kind: "drafts",
              value: { items: box.drafts, offset: 0, total: box.drafts.length },
            };
          });
        },
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) =>
      now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) =>
      box.closeHookFails
        ? Promise.reject(new Error("la finestra non si lascia agganciare"))
        : now().onClose(first, onFailure),
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

vi.mock("../host/dialog", () => ({
  confirm: () => {
    box.asked++;
    return box.confirm();
  },
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost, TRASH_VIEW, testViewSpec } = await import("../host/fake");
const rawHtml = (await import("../../index.html?raw")).default;

/// La scocca vera, rimessa in piedi come la webview la trova.
function mountShell(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1]!.replace(/<script[\s\S]*?<\/script>/g, "");
}

/// I moduli della shell montata che una prova guarda. Vanno presi **dopo**
/// `vi.resetModules()`, o si parlerebbe con le istanze del giro precedente.
interface Shell {
  host: FakeHost;
  sessions: typeof import("./document-session").documentSessions;
  store: typeof import("./store");
  notices(): string[];
  t: typeof import("../i18n/strings").t;
  plural: typeof import("../i18n/strings").plural;
}

interface Mounted extends Shell {
  startup: Promise<() => void>;
}

/// Monta la shell su un vault finto **senza aspettare l'avvio**.
///
/// I due segnali dell'apertura (`vault`, `documents`) entrano nel registro
/// accanto alle porte: l'ascoltatore si iscrive prima che `main.ts` parta, così
/// è il primo a sentirli e ciò che guarda è lo stato **al momento dell'annuncio**.
///
/// `watch` riceve la shell prima che l'avvio cominci: chi vuole guardare dentro
/// l'avvio mette lì le sue sonde, perché dopo `import("../main")` è già partito.
async function mount(
  file: Record<string, string>,
  watch: (shell: Shell) => void = () => {},
): Promise<Mounted> {
  vi.resetModules();
  const host = createFakeHost({
    file,
    view: [testViewSpec(TRASH_VIEW, "left_sidebar")],
  });
  box.host = host;
  box.trace = [];
  const store = await import("./store");
  store.on("vault", (root) => box.mark(`signal:vault:${root}`));
  store.on("documents", () => box.mark("signal:documents"));
  const { documentSessions: sessions } = await import("./document-session");
  activeSessions = sessions;
  const { recentNotices } = await import("../ui/notify");
  const { t, plural } = await import("../i18n/strings");
  const shell: Shell = {
    host,
    sessions,
    store,
    notices: () => recentNotices().map((notice) => notice.text),
    t,
    plural,
  };
  watch(shell);
  mountShell();
  const main = await import("../main");
  const { declareConfirm } = await import("../platform/confirm");
  const startup = main.startup.then((stop) => {
    // Lo Scrittoio chiede le conferme col suo dialogo; il banco dichiara sopra
    // di lui un presentatore che risponde con `box.confirm`. È la stessa porta:
    // un presentatore che rifiuta è il dialogo che non si apre.
    const withdraw = declareConfirm(() => {
      box.asked++;
      return box.confirm();
    });
    const tracked = () => {
      withdraw();
      stop();
      if (activeStop === tracked) activeStop = null;
    };
    activeStop = tracked;
    return tracked;
  });
  return { ...shell, startup };
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
async function start(
  file: Record<string, string>,
  watch?: (shell: Shell) => void,
): Promise<Mounted> {
  const mounted = await mount(file, watch);
  await mounted.startup;
  await settle();
  return mounted;
}

/// Lascia girare ciò che è stato messo in coda.
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/// Aspetta che una condizione diventi vera, o fallisce dicendo cosa aspettava.
async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

/// Il testo dell'editor, letto dal DOM di CodeMirror come lo legge chi guarda.
function textToVideo(): string {
  const rows = [...document.querySelectorAll(".cm-content .cm-line")];
  return rows.map((r) => r.textContent).join("\n");
}

/// La prima volta che ciascuno dei passi nominati compare, nell'ordine in cui
/// compare. Un registro intero legherebbe la prova a ogni domanda che la shell
/// fa per disegnarsi; così resta legata ai soli passi che decidono.
function firstOccurrences(trace: readonly string[], steps: readonly string[]): string[] {
  const wanted = new Set(steps);
  const seen: string[] = [];
  for (const step of trace) {
    if (wanted.has(step) && !seen.includes(step)) seen.push(step);
  }
  return seen;
}

/// L'editor del primo riquadro, o un errore che dice cosa manca.
function firstEditor(): ReturnType<typeof editorViews>[number] {
  const view = editorViews()[0];
  if (!view) throw new Error("l'editor non è montato");
  return view;
}

/// Tiene una finestra documento **a metà dell'apertura**.
///
/// È lo stato in cui `drainDocumentWindows` risponde di no senza chiedere
/// niente a nessuno: una finestra che sta nascendo non si può ancora congelare
/// né salvare. Serve a guardare cosa fa chi chiama quando lo svuotamento si
/// rifiuta, senza una seconda webview che in questo banco non c'è. La lettura
/// della nota resta frenata; `abandon` la rilascia facendo fallire la finestra,
/// così non resta un canale aperto dopo la prova.
async function holdWindowOpening(shell: Shell): Promise<{ abandon(): Promise<void> }> {
  const { openCurrentInNewWindow } = await import("./document-windows");
  const reads = shell.host.atGate("readDocument").length;
  const unlock = shell.host.throttle("readDocument");
  const opening = openCurrentInNewWindow("note/Spesa.md");
  await waitFor(
    "la finestra comincia ad aprirsi",
    () => shell.host.atGate("readDocument").length === reads + 1,
  );
  return {
    abandon: async () => {
      const repair = shell.host.fault("openDocumentWindow", "finestra negata");
      unlock();
      await opening;
      repair();
    },
  };
}

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "note/Spesa.md": "pane, latte, arance\n",
};

/// Una bozza il cui file è rimasto com'era: è l'unica copia delle battute non
/// salvate, e rientra nel suo documento. `r1` è la revisione che l'host finto
/// dà al primo file del vault.
function draftOfWelcome(text: string): DraftInfo {
  return { doc: "Benvenuto.md", at: 1, base: "r1", exists: true, current: "r1", text };
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  activeSessions?.closeAll();
  activeSessions = null;
  document.body.innerHTML = "";
  localStorage.clear();
  box.confirm = () => Promise.resolve(true);
  box.asked = 0;
  box.drafts = [];
  box.draftsFail = false;
  box.closeHookFails = false;
  box.probes.clear();
});

describe("aprire un vault: i passi e il loro ordine", () => {
  /// La sequenza di `openVaultPath`, ridotta ai passi che decidono: l'host
  /// accetta il vault, si carica ciò che la macchina ricorda (organizzazione,
  /// layout, cartelle aperte, spazio), le bozze rientrano, **poi** il vault si
  /// annuncia e i pannelli si ricaricano, poi view e comandi, poi i tre avvisi,
  /// e solo in fondo la prima nota.
  it("all'avvio: vault, layout, bozze, annuncio, registri, avvisi, prima nota", async () => {
    await start(VAULT);

    const steps = [
      "initialVault",
      "openVault",
      "queryIndex:organization",
      "viewState:layout",
      "viewState:expanded",
      "viewState:activeSpace",
      "queryIndex:drafts",
      "signal:vault:/vault",
      "signal:documents",
      "listViews",
      "listCommands",
      "pendingKeybindings",
      "queryIndex:vault_status",
      // La prima nota: il layout era vuoto, quindi nessuno aveva letto niente.
      "readDocument",
    ];
    expect(firstOccurrences(box.trace, steps)).toEqual(steps);
  });

  /// Con un vault già aperto la sequenza comincia prima: ciò che è appeso al
  /// ritardo del salvataggio va sul disco **del vault che si lascia**, e solo
  /// dopo si chiede all'host quello nuovo. La linguetta che il layout ripristina
  /// si legge dal disco prima delle bozze, che le rientrano sopra.
  it("da un vault aperto: prima si salva ciò che è appeso, poi si cambia", async () => {
    const shell = await start(VAULT);
    typeInEditor("battuta ancora da salvare");
    const from = box.trace.length;
    const { openVault } = await import("../desktop-shell");

    await openVault("/altro");

    const steps = [
      "writeDocument",
      "openVault",
      "queryIndex:organization",
      "viewState:layout",
      "viewState:expanded",
      "viewState:activeSpace",
      "readDocument",
      "queryIndex:drafts",
      "signal:vault:/altro",
      "signal:documents",
      "listViews",
      "listCommands",
      "pendingKeybindings",
    ];
    const trace = box.trace.slice(from);
    expect(firstOccurrences(trace, steps)).toEqual(steps);
    // Lo stato del vault lo chiede anche la banda di stato, appena il vault si
    // annuncia: è una lettrice sua. L'avviso della sessione resta in fondo,
    // dopo i registri.
    expect(trace.lastIndexOf("queryIndex:vault_status")).toBeGreaterThan(trace.indexOf("pendingKeybindings"));
    expect(shell.host.files()["Benvenuto.md"]).toContain("battuta ancora da salvare");
    expect(shell.store.state.vaultRoot).toBe("/altro");
  });

  /// Le sessioni sono indicizzate per path, e due vault hanno spesso le stesse
  /// note: il vault di prima si smonta **dopo** che l'host ha accettato quello
  /// nuovo, e **prima** che il suo layout rimetta in piedi delle linguette.
  it("il vault di prima si smonta dopo il sì dell'host e prima di caricare il layout", async () => {
    const shell = await start(VAULT);
    const seen: Record<string, { session: boolean; panes: number; editors: number }> = {};
    for (const step of ["openVault", "viewState:layout"]) {
      box.probes.set(step, () => {
        seen[step] = {
          session: shell.sessions.get("Benvenuto.md") !== undefined,
          panes: document.querySelectorAll(".pane").length,
          editors: editorViews().length,
        };
      });
    }
    const { openVault } = await import("../desktop-shell");

    await openVault("/altro");

    expect(seen).toEqual({
      "openVault": { session: true, panes: 1, editors: 1 },
      "viewState:layout": { session: false, panes: 0, editors: 0 },
    });
  });

  it("un vault che l'host rifiuta lascia in piedi quello di prima", async () => {
    const shell = await start(VAULT);
    const owner = shell.sessions.get("Benvenuto.md");
    const repair = shell.host.fault("openVault", "cartella illeggibile");
    const { openVault } = await import("../desktop-shell");

    await expect(openVault("/altro")).rejects.toThrow("cartella illeggibile");
    repair();

    expect(shell.store.state.vaultRoot).toBe("/vault");
    expect(shell.sessions.get("Benvenuto.md")).toBe(owner);
    expect(textToVideo()).toContain("Il primo documento");
  });

  /// Il caso che protegge il testo: se la coda di salvataggio non si svuota,
  /// il vault nuovo non si chiede nemmeno — le note restano dove sono, col loro
  /// buffer, e un avviso dice quali.
  it("un salvataggio che non si svuota ferma il cambio di vault, e lo dice", async () => {
    const shell = await start(VAULT);
    const repair = shell.host.fault("writeDocument", "disco pieno");
    typeInEditor("lavoro che il disco rifiuta");
    const { openVault } = await import("../desktop-shell");

    await openVault("/altro");

    expect(shell.host.atGate("openVault").map((c) => c.args[0])).toEqual(["/vault"]);
    expect(shell.notices()).toContain(shell.t("demo.unsaved", { files: "Benvenuto.md" }));
    expect(shell.store.state.vaultRoot).toBe("/vault");
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });
    expect(textToVideo()).toContain("lavoro che il disco rifiuta");
    repair();
  });

  /// Le finestre documento si svuotano **prima** del salvataggio: se lo
  /// svuotamento si rifiuta la sequenza finisce lì, senza aver scritto niente
  /// e senza aver chiesto niente all'host.
  it("una finestra documento che non si svuota ferma il cambio prima di ogni salvataggio", async () => {
    const shell = await start(VAULT);
    typeInEditor("battuta ancora da salvare");
    const pending = await holdWindowOpening(shell);
    const { openVault } = await import("../desktop-shell");

    await openVault("/altro");

    expect(shell.host.atGate("openVault").map((c) => c.args[0])).toEqual(["/vault"]);
    expect(shell.host.atGate("writeDocument")).toHaveLength(0);
    expect(shell.store.state.vaultRoot).toBe("/vault");
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });
    await pending.abandon();
  });

  /// Fra lo svuotamento della coda e lo smontaggio c'è una chiamata all'host, e
  /// l'utente può continuare a battere nel documento che sta lasciando. Il vault
  /// di prima resta aperto nell'host, e la sessione scrive in quello in cui è
  /// nata: la battuta arriva al disco **di quel vault** (FUB-001), non si perde
  /// con la chiusura delle sessioni e non finisce in quello nuovo, che intanto
  /// è il corrente dell'host.
  it("una battuta arrivata mentre l'host apre il vault nuovo si salva nel vault che si lascia", async () => {
    const shell = await start(VAULT);
    const unlock = shell.host.throttle("openVault");
    const { openVault } = await import("../desktop-shell");

    const opening = openVault("/altro");
    await waitFor("la richiesta arriva all'host", () => shell.host.atGate("openVault").length === 2);
    typeInEditor("battuta fuori tempo");
    unlock();
    await opening;

    const writes = shell.host.atGate("writeDocument");
    const saved = writes[writes.length - 1]?.args;
    expect(saved?.[0]).toBe("Benvenuto.md");
    expect(saved?.[1]).toEqual(expect.stringContaining("battuta fuori tempo"));
    // Il quarto argomento è il vault: quello che si lascia, mai il nuovo.
    expect(saved?.[3]).toBe("/vault");
    expect(writes.map((c) => c.args[3])).not.toContain("/altro");
    expect(shell.notices()).not.toContain(shell.t("demo.unsaved", { files: "Benvenuto.md" }));
    expect(shell.store.state.vaultRoot).toBe("/altro");
    expect(box.trace).toContain("signal:vault:/altro");
  });

  /// Se nemmeno il flush dopo l'apertura riesce a salvare, la battuta non si
  /// perde in silenzio: la sequenza lo dice e va avanti, com'è sempre stato.
  it("una battuta che il vecchio vault rifiuta dopo l'apertura viene detta", async () => {
    const shell = await start(VAULT);
    const unlock = shell.host.throttle("openVault");
    const { openVault } = await import("../desktop-shell");

    const opening = openVault("/altro");
    await waitFor("la richiesta arriva all'host", () => shell.host.atGate("openVault").length === 2);
    const repair = shell.host.fault("writeDocument", "disco pieno");
    typeInEditor("battuta che il disco rifiuta");
    unlock();
    await opening;
    repair();

    expect(shell.notices()).toContain(shell.t("demo.unsaved", { files: "Benvenuto.md" }));
    expect(shell.store.state.vaultRoot).toBe("/altro");
  });
});

describe("i gesti nominano il vault in cui nascono (FUB-001)", () => {
  /// Crea e rinomina passano dal registro dei comandi, e senza `vault` l'host
  /// risponde con il corrente: un gesto che aspetta mentre se ne apre un altro
  /// finirebbe lì. Nominandolo, il comando raggiunge quello da cui è partito.
  it("crea e rinomina raggiungono il vault aperto per nome", async () => {
    const shell = await start(VAULT);
    const { createNote, renameNote } = await import("./vault");

    await createNote("Nuova");
    await renameNote("Benvenuto.md", "Altro.md");

    const named = shell.host
      .atGate("invokeCommand")
      .filter((call) => call.args[0] === "note.create" || call.args[0] === "note.rename")
      .map((call) => [call.args[0], call.args[3]]);
    expect(named).toEqual([
      ["note.create", "/vault"],
      ["note.rename", "/vault"],
    ]);
  });

  /// Le letture dei documenti nominano il vault della sessione fin dalla prima.
  it("la lettura di un documento aperto nomina il vault aperto", async () => {
    const shell = await start(VAULT);

    const reads = shell.host.atGate("readDocument").map((call) => call.args);
    expect(reads.length).toBeGreaterThan(0);
    for (const args of reads) expect(args[1]).toBe("/vault");
  });

  /// Le letture che compongono la shell — l'elenco delle view, il disegno delle
  /// view montate, l'elenco dei comandi e il canale dati — nominano il vault
  /// aperto, come le scritture: l'host risponde con il corrente soltanto se non
  /// gli si dice quale.
  it("l'elenco delle view e dei comandi, il disegno e il canale dati nominano il vault aperto", async () => {
    const shell = await start(VAULT);

    // Prima dell'apertura non c'è un vault da nominare (le impostazioni di
    // macchina si leggono all'avvio): contano le chiamate da quando il vault è
    // aperto.
    const calls = shell.host.calls;
    const opened = calls.findIndex((call) => call.gate === "openVault");
    expect(opened, "il vault non è stato aperto").toBeGreaterThan(-1);
    const after = calls.slice(opened + 1);
    for (const gate of ["listViews", "renderView", "listCommands", "queryIndex"] as const) {
      const named = after.filter((call) => call.gate === gate);
      expect(named.length, `${gate}: nessuna chiamata`).toBeGreaterThan(0);
      for (const call of named) {
        expect(call.args[call.args.length - 1], `${gate} non nomina il vault`).toBe("/vault");
      }
    }
  });
});

describe("recuperare le bozze", () => {
  /// `emit("vault")` è il momento in cui i pannelli si ricaricano e leggono lo
  /// stato dei documenti: la bozza deve esserci **già**, o chi ascolta vedrebbe
  /// il disco e la prima battuta coprirebbe il recupero.
  it("all'avvio la bozza è già nel suo documento quando il vault si annuncia", async () => {
    box.drafts = [draftOfWelcome("testo ritrovato nella bozza\n")];
    let atAnnouncement: unknown = "il vault non si è mai annunciato";

    const shell = await start(VAULT, (early) => {
      box.probes.set("signal:vault:/vault", () => {
        atAnnouncement = early.sessions.inspect("Benvenuto.md") ?? "nessuna sessione";
      });
    });

    expect(atAnnouncement).toMatchObject({ dirty: true, text: "testo ritrovato nella bozza\n" });
    expect(textToVideo()).toContain("testo ritrovato nella bozza");
    expect(shell.notices()).toContain(`Benvenuto.md: ${shell.t("draft.case.intatta")}`);
    expect(shell.notices()).toContain(shell.plural(1, "draft.found.one", "draft.found"));
    // E il foglio lo tiene scritto sopra il testo finché non lo si chiude.
    const recovered = document.querySelector<HTMLElement>('.sheet-notice[data-notice="recovered"]');
    expect(recovered?.textContent).toContain(shell.t("draft.case.intatta"));
  });

  /// La linguetta già a schermo leggeva il disco: la bozza le rientra sopra, e
  /// con lei l'editor e lo stato di salvataggio. Il conto dice quante sono
  /// rientrate davvero — un buffer sporco è un testo battuto dopo, e non si copre.
  it("rientra sopra la linguetta a schermo: editor, stato, avviso e conto", async () => {
    const shell = await start(VAULT);
    const { recoverDrafts } = await import("../panels/document");
    box.drafts = [draftOfWelcome("testo ritrovato nella bozza\n")];

    expect(await recoverDrafts()).toBe(1);

    expect(textToVideo()).toContain("testo ritrovato nella bozza");
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({
      dirty: true,
      text: "testo ritrovato nella bozza\n",
    });
    expect(document.getElementById("save-state")?.dataset.state).toBe("non_salvato");
    expect(shell.notices()).toContain(`Benvenuto.md: ${shell.t("draft.case.intatta")}`);

    typeInEditor("battuta dopo il recupero");
    box.drafts = [draftOfWelcome("una bozza più vecchia del buffer\n")];
    expect(await recoverDrafts()).toBe(0);
    expect(textToVideo()).toContain("battuta dopo il recupero");
    expect(textToVideo()).not.toContain("una bozza più vecchia del buffer");
  });

  /// Il recupero è una rete di sicurezza: se non parte, il vault si apre lo
  /// stesso.
  it("una domanda sulle bozze che fallisce non ferma l'apertura", async () => {
    box.draftsFail = true;

    const shell = await start(VAULT);

    expect(box.trace).toContain("queryIndex:drafts");
    expect(box.trace).toContain("signal:vault:/vault");
    expect(textToVideo()).toContain("Il primo documento");
    expect(shell.notices()).not.toContain(shell.plural(1, "draft.found.one", "draft.found"));
  });
});

describe("chiudere la finestra: la guardia", () => {
  /// Le superfici si fermano **prima** di mettere in salvo: una battuta entrata
  /// mentre il salvataggio di chiusura è in volo resterebbe soltanto nella
  /// webview che sta per sparire. Il via libera arriva dopo l'ultima scrittura.
  it("ferma le superfici mentre mette in salvo, poi lascia andare la finestra", async () => {
    const shell = await start(VAULT);
    typeInEditor("l'ultima riga prima di chiudere");
    const view = firstEditor();
    const unlock = shell.host.throttle("writeDocument");

    const closing = shell.host.close();
    await waitFor(
      "il salvataggio di chiusura parte",
      () => shell.host.atGate("writeDocument").length === 1,
    );
    expect(view.state.readOnly).toBe(true);
    expect(shell.host.atGate("finishMainClose")).toHaveLength(0);

    unlock();
    await closing;

    const gates = shell.host.calls.map((c) => c.gate);
    expect(shell.host.atGate("finishMainClose")).toHaveLength(1);
    expect(gates.indexOf("finishMainClose")).toBeGreaterThan(gates.lastIndexOf("writeDocument"));
    expect(shell.host.files()["Benvenuto.md"]).toContain("l'ultima riga prima di chiudere");
  });

  /// Una chiusura rifiutata lascia la finestra a chi scrive: il testo che non
  /// è né sul disco né in una bozza resta aperto **e modificabile**.
  it("una chiusura rifiutata restituisce le superfici a chi scrive", async () => {
    const shell = await start(VAULT);
    typeInEditor("LAVORO NON PERSISTITO");
    const view = firstEditor();
    const repairWrite = shell.host.fault("writeDocument", "disco pieno");
    const repairDraft = shell.host.fault("saveDraft", "disco pieno");

    await shell.host.close();

    expect(shell.host.atGate("finishMainClose")).toHaveLength(0);
    expect(shell.notices()).toContain(
      shell.t("document.close_unprotected", { docs: "Benvenuto.md" }),
    );
    expect(view.state.readOnly).toBe(false);
    repairWrite();
    repairDraft();
  });

  /// Lo svuotamento delle finestre documento viene prima di ogni salvataggio:
  /// se si rifiuta, la chiusura si rifiuta con lui e niente è stato scritto.
  it("una finestra documento che non si svuota rifiuta la chiusura prima di ogni salvataggio", async () => {
    const shell = await start(VAULT);
    typeInEditor("battuta ancora da salvare");
    const view = firstEditor();
    const pending = await holdWindowOpening(shell);

    await shell.host.close();

    expect(shell.host.atGate("finishMainClose")).toHaveLength(0);
    expect(shell.host.atGate("writeDocument")).toHaveLength(0);
    expect(shell.host.atGate("saveDraft")).toHaveLength(0);
    expect(view.state.readOnly).toBe(false);
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });
    await pending.abandon();
  });

  /// Dopo il via libera la finestra può ancora non chiudersi: allora la shell
  /// è viva con le superfici ferme, e deve scongelarle e dirlo.
  it("se la finestra non si chiude dopo il via libera lo dice e scongela", async () => {
    const shell = await start(VAULT);
    const view = firstEditor();
    const repair = shell.host.fault("finishMainClose", "finestra occupata");

    await shell.host.close();
    repair();

    expect(shell.notices()).toContain(
      shell.t("document.close_failed", { reason: "finestra occupata" }),
    );
    expect(view.state.readOnly).toBe(false);
  });

  it("un aggancio alla chiusura che fallisce si dice all'avvio", async () => {
    box.closeHookFails = true;

    const shell = await start(VAULT);

    expect(shell.notices()).toContain(shell.t("document.close_unhooked"));
    expect(textToVideo()).toContain("Il primo documento");
  });

  it("smontata la shell nessuno ascolta più la chiusura", async () => {
    const shell = await mount(VAULT);
    const stop = await shell.startup;
    await settle();

    stop();
    await settle();

    await expect(shell.host.close()).rejects.toThrow("nessuno ascolta");
  });
});

describe("rilasciare una linguetta", () => {
  /// La linguetta è già chiusa quando il salvataggio fallisce, e la sessione è
  /// l'unica copia del lavoro. Un dialogo che **non risponde** — rifiutato, non
  /// solo negato — vale «tieni»: la nota torna aperta col suo buffer e la bozza
  /// resta sul disco. Solo uno «scarta» esplicito butta l'una e l'altra.
  it("una conferma che fallisce vale «tieni», e solo uno «scarta» butta la bozza", async () => {
    const shell = await start(VAULT);
    const repair = shell.host.fault("writeDocument", "disco pieno");
    box.confirm = () => Promise.reject(new Error("il dialogo non si apre"));
    typeInEditor("lavoro che il disco rifiuta");

    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la chiusura chiede cosa fare", () => box.asked === 1);
    await waitFor("la nota torna aperta", () =>
      document.querySelectorAll(".pane .tab").length === 1 &&
      textToVideo().includes("lavoro che il disco rifiuta"),
    );
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });
    expect(shell.host.atGate("discardDraft")).toHaveLength(0);

    box.confirm = () => Promise.resolve(true);
    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la sessione se ne va", () => shell.sessions.get("Benvenuto.md") === undefined);
    await waitFor("la bozza viene scartata", () =>
      shell.host.atGate("discardDraft").some((c) => c.args[0] === "Benvenuto.md"),
    );
    expect(box.asked).toBe(2);
    expect(document.querySelectorAll(".pane .tab")).toHaveLength(0);
    repair();
    expect(shell.host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  /// Il rilascio è della sessione, non della linguetta: finché un altro
  /// riquadro guarda il documento, chiudere una linguetta non salva, non chiude
  /// e non cambia owner. L'ultima linguetta sì.
  it("un documento che un altro riquadro guarda ancora non viene rilasciato", async () => {
    const shell = await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    const owner = shell.sessions.get("Benvenuto.md");
    typeInEditor("battuta in due riquadri");

    document.querySelector<HTMLElement>(".pane.focus .tab-close")?.click();
    await waitFor("resta una linguetta", () => document.querySelectorAll(".pane .tab").length === 1);

    expect(shell.sessions.get("Benvenuto.md")).toBe(owner);
    expect(shell.sessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });
    expect(shell.host.atGate("writeDocument")).toHaveLength(0);
    expect(textToVideo()).toContain("battuta in due riquadri");

    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor(
      "l'ultima linguetta rilascia la sessione",
      () => shell.sessions.get("Benvenuto.md") === undefined,
    );
    expect(shell.host.files()["Benvenuto.md"]).toContain("battuta in due riquadri");
  });
});
