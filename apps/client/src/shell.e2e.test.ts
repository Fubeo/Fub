// @vitest-environment happy-dom
//
// **I cinque gesti, dall'inizio alla fine** (§17.2): apri un vault, scrivi,
// rinomina, cerca, ripristina.
//
// # Cosa prova questo file, e perché nessun altro lo prova
//
// Gli altri presidi di questa shell provano dei *moduli*, e li provano bene:
// `rules/` è pura, `state/` è isolato, i due pannelli con una regola dentro
// hanno la loro. Ciò che nessuno guarda è il **cablaggio** — che il click su
// una riga apra quel documento, che la battuta successiva arrivi alla porta
// giusta con la base giusta, che una rinomina migri l'identità di ciò che è
// aperto, che una view del backend disegnata dalla shell rimandi la sua azione
// a chi l'ha disegnata. Sono tutte cose che vivono *fra* i moduli, e che oggi
// si scoprivano aprendo l'app.
//
// Qui si monta `main.ts` — il vero punto di montaggio, non una sua imitazione —
// sulla scocca vera (`index.html`), contro l'host finto (`host/fake.ts`). Ciò
// che resta finto è **il di là del confine**, e il §1.3 lo ha reso un file
// solo: è esattamente il modo in cui la
// [decisione 0015](../../docs/decisions/0190-sessioni-documento-e-undo.md) diceva
// che questi giri sarebbero diventati possibili.
//
// # Trentasette gesti, contati da fuori
//
// I gesti sono **trentasette** [conta: gesti-della-shell], e il numero è contato da
// `conteggi.mjs` invece che ricordato. Non è pedanteria: la
// [0109](../../docs/decisions/0192-impostazioni-locale-e-temi.md)
// ha misurato che *una suite che si svuota in silenzio è indistinguibile da una
// suite verde*, e un file come questo si svuota nel modo più facile che ci sia
// — un `.skip` messo per sbloccare un giro e mai tolto. La prima forma del
// conto leggeva `^  it(`, cioè **il rientro di oggi**: misurato, un `.skip` sui
// sei `describe`, che stanno in colonna zero, lasciava il conto a sette e
// `npm run test` verde con `7 skipped`. Adesso il rientro non conta e un
// `.skip`/`.only`/`.todo` — su un `describe` o su un `it` — azzera il conto:
// una suite che si può *non eseguire* non si scala, si spegne rumorosamente.
//
// # I limiti, dichiarati qui perché nessuno li deduca
//
// Non è un E2E dell'**app**: il ponte Tauri, la webview e il kernel restano
// fuori (il perché sta in `host/fake.ts`). E non è un presidio di layout: in
// `happy-dom` non c'è né CSS né misura, quindi si asserisce su *cosa* c'è e
// mai su *dove*.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendToTextEditor as typeInEditor,
  mountedTextEditors as editorViews,
  undoDepth,
} from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { KernelNotice, SettingEntry, CommandSpec } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Cosa risponde la modale di conferma del sistema. È l'unica altra cosa che
  /// la shell chiede al di là del confine (§1.3), e negli e2e è un `true`.
  confirm: true,
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
    onClose: (first: () => Promise<void>) => now().onClose(first),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(box.confirm),
  pickFolder: () => Promise.resolve("/vault"),
}));

const { createFakeHost, TRASH_VIEW, testViewSpec } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

/// La scocca vera, rimessa in piedi come la webview la trova.
function mountShell(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
}

/// Monta la shell su un vault finto **senza aspettare l'avvio**, con le porte
/// nominate tenute in volo.
///
/// I freni vanno messi prima di importare `main.ts`, perché l'avvio parte
/// all'import: è l'unico modo di guardare *dentro* l'apertura di un vault
/// invece che a cose fatte. Chi non ne ha bisogno usa `avvia`.
async function mount(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  throttles: string[] = [],
  notice: KernelNotice | null = null,
  commands: CommandSpec[] = [],
): Promise<{ host: FakeHost; startup: Promise<void>; unlock: Map<string, () => void> }> {
  vi.resetModules();
  box.confirm = true;
  const host = createFakeHost({
    file,
    view: [testViewSpec(TRASH_VIEW, "left_sidebar")],
    settings,
    root,
    sessionNotice: notice,
    commands,
  });
  box.host = host;
  const unlock = new Map(throttles.map((p) => [p, host.throttle(p)]));
  mountShell();
  const main = await import("./main");
  return { host, startup: main.startup, unlock };
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
async function start(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  notice: KernelNotice | null = null,
  commands: CommandSpec[] = [],
): Promise<FakeHost> {
  const { host, startup } = await mount(file, settings, root, [], notice, commands);
  await startup;
  await settle();
  return host;
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
/// Lascia girare ciò che è stato messo in coda: la shell fa quasi tutto con
/// delle promesse, e un gesto ne accende sempre qualcuna che il gesto non
/// attende.
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
/// Flushes promise continuations without turning a timing guess into an
/// ordering primitive. Command gates below decide when the destructive action
/// runs; this helper only lets the shell observe already-resolved work.
async function microtasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/// Aspetta che una condizione diventi vera, o fallisce dicendo cosa aspettava.
/// Serve ai due pezzi che hanno un timer loro — il debounce della ricerca e
/// quello del salvataggio — e a nient'altro.
async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

function rowsOfNote(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.note")];
}

function row(name: string): HTMLElement {
  const found = rowsOfNote().find((r) => r.textContent?.trim() === name);
  if (!found) {
    const views = rowsOfNote().map((r) => r.textContent?.trim());
    throw new Error(`nell'albero non c'è «${name}», ci sono: ${views.join(", ")}`);
  }
  return found;
}

/// Apre il menu contestuale su una riga e sceglie la voce con quell'etichetta.
async function contextMenu(on: HTMLElement, entry: string): Promise<void> {
  on.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.getElementById("context-menu");
  if (!menu) throw new Error("il menu contestuale non si è aperto");
  const buttons = [...menu.querySelectorAll("button")];
  const selected = buttons.find((b) => b.textContent === entry);
  if (!selected) {
    throw new Error(`nel menu non c'è «${entry}», ci sono: ${buttons.map((b) => b.textContent)}`);
  }
  selected.click();
  await settle();
}

/// Una riga di impostazione che è la scorciatoia di un comando **della shell**,
/// come la manda il backend: di macchina, col dichiarato per default.
function shortcut(id: keyof typeof SHELL_KEYS): SettingEntry {
  return {
    spec: {
      key: `keys.${id}`,
      label: id,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: SHELL_KEYS[id] ?? "" },
      program_writable: false,
    },
    value: SHELL_KEYS[id] ?? "",
    source: "default",
  };
}

/// Apre le impostazioni sulla scheda delle scorciatoie e rende il campo della
/// riga che porta quel titolo.
async function shortcutField(label: string): Promise<HTMLInputElement> {
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await settle();
  document.querySelector<HTMLButtonElement>('#settings-tabs button[data-tab="shortcuts"]')!
    .click();
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>("#settings-body .setting-row")];
  const row = rows.find((r) => r.querySelector("label")?.textContent === label);
  if (!row) {
    const views = rows.map((r) => r.querySelector("label")?.textContent);
    throw new Error(`fra le scorciatoie non c'è «${label}», ci sono: ${views.join(", ")}`);
  }
  const field = row.querySelector("input");
  if (!field) throw new Error(`la scorciatoia «${label}» è di sola lettura: non ha un field`);
  return field;
}

/// Il testo dell'editor, letto dal DOM di CodeMirror come lo legge chi guarda.
function textToVideo(): string {
  const rows = [...document.querySelectorAll(".cm-content .cm-line")];
  return rows.map((r) => r.textContent).join("\n");
}

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "note/Spesa.md": "pane, latte, arance\n",
};

function editorTexts(): string[] {
  return [...document.querySelectorAll(".cm-content")].map((content) =>
    [...content.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n"),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

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
    expect(host.atGate("viewState").map((c) => c.args[0])).toEqual([
      "layout",
      "mode",
      "expanded",
      "activeSpace",
    ]);

    unlock.get("viewState")!();
    await settle();
    expect(host.atGate("listViews")).toHaveLength(1);
    expect(host.atGate("listCommands")).toHaveLength(1);

    unlock.get("listViews")!();
    await startup;
    await settle();

    // Il vault che l'host propone all'avvio, non uno scelto da qui.
    expect(document.querySelector("#vault-path")?.textContent).toBe("/vault");
    expect(rowsOfNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);
    expect(textToVideo()).toContain("Il primo documento");

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
});

describe("scrivi", () => {
  it("ciò che si batte arriva al disco, e discende dalla revisione che si era letta", async () => {
    const host = await start(VAULT);
    const reads = host.atGate("readDocument");
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
    repair();
  });

  it("ricarica un cambio watcher quando il buffer è pulito", async () => {
    const host = await start(VAULT);
    const readsBefore = host.atGate("readDocument").length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await waitFor(
      "il documento viene riletto dopo il cambio watcher",
      () => host.atGate("readDocument").length > readsBefore,
    );
    await waitFor(
      "il testo watcher arriva all'editor",
      () => textToVideo().includes("testo arrivato dal watcher"),
    );
    expect(textToVideo()).toContain("testo arrivato dal watcher");
  });

  it("non sovrascrive il buffer sporco quando il watcher cambia il file", async () => {
    const host = await start(VAULT);
    typeInEditor("testo locale non salvato");
    const readsBefore = host.atGate("readDocument").length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await settle();
    expect(host.atGate("readDocument").length).toBe(readsBefore);
    expect(textToVideo()).toContain("testo locale non salvato");
    expect(textToVideo()).not.toContain("testo arrivato dal watcher");
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
    const readsAtSplit = host.atGate("readDocument").length;
    const initial = editorTexts();
    expect(initial).toHaveLength(1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    expect(host.atGate("readDocument").length).toBe(readsAtSplit);
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
    await waitFor("la rinomina arriva al kernel", () => host.atGate("invokeCommand").length > 0);
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
    await waitFor("la nota si apre", () => host.atGate("readDocument").length > 1);
    await settle();

    // Una scrittura sola, e nessun conflitto: il flush ha aspettato quella in
    // volo invece di affiancarle una gemella con la base di prima.
    expect(host.atGate("writeDocument").length).toBe(1);
    expect(host.files()["Benvenuto.md"]).toContain("Prima battuta.");
  });
});

describe("rinomina", () => {
  it("il nome pagina cambia, cartella ed estensione restano, e la nota aperta segue", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    await waitFor("la rinomina arriva al kernel", () => host.atGate("invokeCommand").length > 0);
    await settle();

    const invoked = host.atGate("invokeCommand")[0];
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
    expect(host.atGate("invokeCommand").filter((c) => c.args[0] === "note.rename")).toHaveLength(0);

    unlock();
    await waitFor(
      "la rinomina parte dopo il salvataggio",
      () => host.atGate("invokeCommand").some((c) => c.args[0] === "note.rename"),
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
});

describe("chiudere linguette e superfici", () => {
  it("chiude una linguetta senza chiudere le altre", async () => {
    const host = await start(VAULT);
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);

    row("Riunione").click();
    await waitFor("la seconda linguetta si apre", () =>
      textToVideo().includes("Appunti della riunione"),
    );
    const tabs = [...document.querySelectorAll<HTMLElement>(".pane .tab")];
    expect(tabs).toHaveLength(2);

    const close = tabs[1]?.querySelector<HTMLElement>(".tab-close");
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await waitFor(
      "resta la linguetta iniziale",
      () => document.querySelectorAll(".pane .tab").length === 1,
    );
    expect(textToVideo()).toContain("Il primo documento");
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  it("chiude l'ultima linguetta, salva una volta e non lascia timer", async () => {
    const host = await start(VAULT);
    typeInEditor("testo prima di chiudere la linguetta");

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await waitFor(
      "l'ultima linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );
    await waitFor("il salvataggio della linguetta parte", () =>
      host.atGate("writeDocument").length === 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("testo prima di chiudere la linguetta");
    expect(editorViews()).toHaveLength(1);

    // This integration must let the real save/debounce deadlines pass: a
    // residual timer is the behavior under test, not an injectable callback.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(1);
  });

  it("una riapertura prenotata durante il flush conserva lo stesso owner", async () => {
    const host = await start(VAULT);
    const { documentSessions } = await import("./state/document-session");
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const unlock = host.throttle("writeDocument");

    typeInEditor("battuta prima di chiudere");
    await waitFor("la prima scrittura parte", () => host.atGate("writeDocument").length === 1);

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await waitFor(
      "la linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );

    // Il click arriva mentre il rilascio dell'ultima linguetta aspetta la
    // scrittura frenata: l'intento di apertura deve precederla, non arrivare
    // dopo che l'owner è già stato chiuso.
    row("Benvenuto").click();
    await settle();
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    unlock();
    await waitFor(
      "la nota si riapre",
      () =>
        document.querySelectorAll(".pane .tab").length === 1 &&
        textToVideo().includes("battuta prima di chiudere"),
    );
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    const writesBeforeReopen = host.atGate("writeDocument").length;
    typeInEditor(" e dopo la riapertura");
    await waitFor(
      "la battuta dopo la riapertura viene salvata",
      () => host.atGate("writeDocument").length === writesBeforeReopen + 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("e dopo la riapertura");
  });

  it("distrugge la superficie del riquadro chiuso", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);

    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    const removed = editorViews()[1]!;
    panes[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "w",
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    await waitFor("il riquadro si chiude", () => document.querySelectorAll(".pane").length === 1);
    expect(editorViews()).toHaveLength(1);
    expect(removed.dom.isConnected).toBe(false);
  });

  it("non fa risorgere una nota sporca appena cancellata", async () => {
    const host = await start(VAULT);
    typeInEditor("testo della nota cancellata");
    const unlock = host.throttle("invokeCommand");

    await contextMenu(row("Benvenuto"), "Elimina");
    await waitFor(
      "la cancellazione arriva al kernel",
      () => host.atGate("invokeCommand").some((c) => c.args[0] === "note.trash"),
    );

    // Keep the delete command in flight past the save debounce. If the delete
    // left a timer armed, its write would recreate the now-missing path here.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");

    unlock();
    await waitFor("la bozza viene scartata", () => host.atGate("discardDraft").length > 0);
    await settle();
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("blocca un input reale durante una cancellazione lenta e non resuscita la bozza", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da cancellare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const unlock = host.throttle("invokeCommand");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(host.atGate("invokeCommand").some((c) => c.args[0] === "note.trash")).toBe(true);
    expect(view.state.readOnly).toBe(true);

    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    expect(host.atGate("writeDocument")).toHaveLength(0);

    unlock();
    await deleting;
    await microtasks();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(host.atGate("saveDraft")).toHaveLength(0);
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
    expect(documentSessions.get("Benvenuto.md")).toBeUndefined();
  });

  it("scongela lo stesso owner dopo un rifiuto e salva il primo input successivo", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da conservare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const historyBefore = undoDepth(view.state);
    const unlock = host.throttle("invokeCommand");
    const repair = host.fault("invokeCommand", "cancellazione rifiutata");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(view.state.readOnly).toBe(true);
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
    expect(host.trash()).toHaveLength(0);
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    unlock();
    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    repair();

    expect(documentSessions.get("Benvenuto.md")).toBe(owner);
    expect(view.state.readOnly).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    expect(documentSessions.inspect("Benvenuto.md")).toMatchObject({
      dirty: true,
      pendingDeletion: false,
      text: before,
    });
    expect(undoDepth(view.state)).toBe(historyBefore);

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    const after = view.state.doc.toString();
    expect(after).not.toBe(before);
    await waitFor(
      "il primo input dopo il rifiuto viene salvato",
      () => host.atGate("writeDocument").length > 0,
    );
    expect(host.files()["Benvenuto.md"]).toBe(after);
    expect(documentSessions.inspect("Benvenuto.md")?.dirty).toBe(false);
  });
});

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

    const renames = host.atGate("invokeCommand").filter((c) => c.args[0] === "note.rename");
    expect(
      renames,
      "il file si è mosso mentre il testo battuto era solo in RAM: la " +
        "riscrittura dei wikilink del kernel finirà sotto il salvataggio dopo",
    ).toEqual([]);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");
    // E chi guarda lo sa: il rifiuto è una frase, non un gesto che non fa niente.
    expect(document.body.textContent).toContain("Benvenuto.md non è sul disco");

    repair();
  });

  /// L'altra metà: `convertToFolder` sposta il file esattamente come la
  /// rinomina — è una rinomina — e non metteva in salvo niente affatto.
  it("la conversione in cartella mette in salvo prima di muovere", async () => {
    const host = await start(VAULT);
    typeInEditor("battuta prima di convertire");

    await contextMenu(row("Benvenuto"), "Converti in cartella");
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
  });
});

describe("cerca", () => {
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

    const results = [...document.querySelectorAll<HTMLElement>("#search-results li")];
    expect(results.map((r) => r.textContent)).toHaveLength(1);
    expect(results[0].textContent).toContain("Spesa");

    results[0].click();
    await waitFor("il documento cercato si apre", () =>
      host.atGate("readDocument").some((c) => c.args[0] === "note/Spesa.md"),
    );
    await settle();
    expect(textToVideo()).toContain("pane, latte, arance");
  });
});

describe("ripristina", () => {
  it("una nota cestinata torna dalla view del cestino, che la shell non conosce", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Elimina");
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

    // La combinazione nuova apre la palette, premuta sul documento come da un
    // browser: è la riga che dice che il giro è chiuso — scritta, riletta, e
    // onorata senza riavviare niente.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, altKey: true }),
    );
    await settle();
    expect(document.getElementById("command-palette")).not.toBeNull();

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

    expect(host.atGate("sessionNotice").length).toBe(1);
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
});

describe("segui un link dentro la nota", () => {
  it("un `[[#Sezione]]` chiede al kernel col documento che lo ospita", async () => {
    // Il gesto è ctrl-click su un wikilink **senza pagina**, e la cosa che si
    // guarda sta di qua dal confine: *quale domanda* è partita. Un
    // `[[#Sezione]]` non nomina una nota, nomina questa — e chi lo risolve non
    // può saperlo se non gli si dice da dove si sta guardando. La shell si
    // fermava un passo prima, con un `if (!page) return`: nessuna domanda,
    // nessuna risposta, un click che non faceva niente e non diceva perché.
    const host = await start({
      "Benvenuto.md": "Vedi [[#Appunti]] più sotto.\n\n## Appunti\n\nEccoli.\n",
    });
    const link = document.querySelector<HTMLElement>(".cm-fub-wikilink");
    expect(link, "il live preview non ha decorato il wikilink").not.toBeNull();
    link!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true }));
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
  };

  it("un buffer sporco si salva prima che note.create parta", async () => {
    const host = await start(VAULT, [], undefined, null, [specNoteCreate]);
    typeInEditor("testo non ancora salvato");

    // La palette si apre con la scorciatoia di default, come da un browser.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(document.getElementById("command-palette")).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Nuova nota";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();

    // Il comando ha un parametro facoltativo: la palette mostra il form.
    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "Appunti.md";
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
    };
    const host = await start(VAULT, [], undefined, null, [specSearchOpen]);
    typeInEditor("testo non ancora salvato");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Cerca nel vault";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();

    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "rust";
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(host.atGate("invokeCommand").some((c) => c.args[0] === "search.open")).toBe(true);
    expect(
      host.atGate("writeDocument"),
      "un comando di sola lettura non deve salvare i buffer",
    ).toHaveLength(0);
  });
});
