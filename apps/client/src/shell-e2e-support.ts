// La shell vera sull'host finto: il montaggio e gli aiuti comuni delle prove
// `shell-*.e2e.test.ts`, che prima stavano in un file solo.
//
// **I cinque gesti, dall'inizio alla fine** (§17.2): apri un vault, scrivi,
// rinomina, cerca, ripristina.
//
// # Cosa provano questi file, e perché nessun altro lo prova
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
// # Nessun gesto spento in silenzio
//
// La [0109](../../docs/decisions/0192-impostazioni-locale-e-temi.md) ha
// misurato che *una suite che si svuota in silenzio è indistinguibile da una
// suite verde*, e un file come questo si svuota nel modo più facile che ci sia
// — un `.skip` messo per sbloccare un giro e mai tolto. Nessun conteggio lo
// presidia: un `.skip`, `.only` o `.todo` qui si toglie prima di chiudere il
// giro, e `npm test` lo mostra fra i saltati.
//
// # I limiti, dichiarati qui perché nessuno li deduca
//
// Non è un E2E dell'**app**: il ponte Tauri, la webview e il kernel restano
// fuori (il perché sta in `host/fake.ts`). E non è un presidio di layout: in
// `happy-dom` non c'è né CSS né misura, quindi si asserisce su *cosa* c'è e
// mai su *dove*.
//
// # Come si usa
//
// Ogni file di prova tiene la sua scatola (`vi.hoisted`) e i due `vi.mock`
// (`./host/ipc`, `./host/dialog`), copiati uguali: i mock sono del file, e
// dopo `vi.resetModules()` la scatola deve essere la stessa che la factory
// legge. Poi chiama `useShellHarness(box)`, che la dà a questi aiuti e
// registra i ganci di prima e dopo.
import { afterAll, beforeEach, vi } from "vitest";
import { waiter } from "./test-wait";
import { mountedTextEditors as editorViews } from "./editors/text/test-support";
import type { Call, FakeHost } from "./host/fake";
import type { KernelNotice, SettingEntry, CommandSpec, KnownVault } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";

/// La scatola dell'host finto, quella che ogni file di prova issa.
export interface ShellBox {
  host: FakeHost | null;
  confirm: boolean;
  asked: number;
  known: KnownVault[];
}

let box: ShellBox;

let activeStop: (() => void) | null = null;
let stopAnswering = (): void => {};

export const { createFakeHost, TRASH_VIEW, testViewSpec } = await import("./host/fake");
export const rawHtml = (await import("../index.html?raw")).default;

/// Lo Scrittoio chiede le conferme col dialogo del kit, dentro la finestra
/// (`shells/scrittoio/confirm.ts`). Il banco risponde a quello vero, premendo
/// il pulsante che `box.confirm` sceglie, e conta le domande come contava
/// quelle del dialogo di sistema.
///
/// Guarda a intervalli e non con un `MutationObserver`: happy-dom tiene la
/// funzione dell'osservatore in un `WeakRef`, e in un file lungo una raccolta
/// della memoria lo zittisce a metà.
export function answerConfirms(): () => void {
  const answered = new WeakSet<Element>();
  const timer = setInterval(() => {
    for (const dialog of document.querySelectorAll(".kit-dialog")) {
      if (answered.has(dialog)) continue;
      const button = dialog.querySelector<HTMLElement>(`[data-action="${box.confirm ? "confirm" : "cancel"}"]`);
      if (!button) continue;
      answered.add(dialog);
      box.asked++;
      button.click();
    }
  }, 5);
  return () => clearInterval(timer);
}

/// La scocca vera, rimessa in piedi come la webview la trova.
export function mountShell(): void {
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
export async function mount(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  throttles: string[] = [],
  notice: KernelNotice | readonly KernelNotice[] | null = null,
  commands: CommandSpec[] = [],
  prepare: (host: FakeHost) => void = () => {},
): Promise<{ host: FakeHost; startup: Promise<() => void>; unlock: Map<string, () => void> }> {
  vi.resetModules();
  box.confirm = true;
  const host = createFakeHost({
    file,
    view: [testViewSpec(TRASH_VIEW, "left_sidebar")],
    settings,
    root,
    sessionNotice: notice,
    commands,
    knownVaults: box.known,
  });
  box.known = [];
  box.host = host;
  const unlock = new Map(throttles.map((p) => [p, host.throttle(p)]));
  prepare(host);
  mountShell();
  const main = await import("./main");
  // Quello del montaggio prima, se il suo avvio non è mai arrivato in fondo.
  stopAnswering();
  const answering = answerConfirms();
  stopAnswering = answering;
  const startup = main.startup.then((stop) => {
    const tracked = () => {
      stop();
      answering();
      if (activeStop === tracked) activeStop = null;
    };
    activeStop = tracked;
    return tracked;
  });
  return { host, startup, unlock };
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
export async function start(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  notice: KernelNotice | readonly KernelNotice[] | null = null,
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
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
/// Flushes promise continuations without turning a timing guess into an
/// ordering primitive. Command gates below decide when the destructive action
/// runs; this helper only lets the shell observe already-resolved work.
export async function microtasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/// Aspetta che una condizione diventi vera, contando i giri del ciclo degli
/// eventi invece dell'orologio (`test-wait.ts`, #396).
export const waitFor = waiter(2000);

/// Le letture di un documento, in ordine: quelle semplici e quelle di una
/// sessione sotto la sua chiave di apertura. Tutte e due hanno l'id per primo.
export function documentReads(host: FakeHost): Call[] {
  return host.calls.filter((call) => call.gate === "readDocument" || call.gate === "openDocument");
}

export function rowsOfNote(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.note")];
}

export function row(name: string): HTMLElement {
  const found = rowsOfNote().find((r) => r.textContent?.trim() === name);
  if (!found) {
    const views = rowsOfNote().map((r) => r.textContent?.trim());
    throw new Error(`nell'albero non c'è «${name}», ci sono: ${views.join(", ")}`);
  }
  return found;
}

/// Apre il menu contestuale su una riga e sceglie la voce con quell'etichetta.
export async function contextMenu(on: HTMLElement, ...path: string[]): Promise<void> {
  on.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  let menu = document.getElementById("context-menu");
  if (!menu) throw new Error("il menu contestuale non si è aperto");
  // L'etichetta, non il testo intero: accanto può esserci la scorciatoia.
  const label = (b: Element) => b.querySelector(".menu-label")?.textContent ?? b.textContent;
  // Ogni nome prima dell'ultimo apre un sottomenu.
  for (const [i, entry] of path.entries()) {
    const buttons = [...menu.querySelectorAll("button")];
    const selected = buttons.find((b) => label(b) === entry);
    if (!selected) {
      throw new Error(`nel menu non c'è «${entry}», ci sono: ${buttons.map(label)}`);
    }
    selected.click();
    await settle();
    if (i < path.length - 1) {
      const sub = document.querySelector<HTMLElement>(".context-submenu");
      if (!sub) throw new Error(`«${entry}» non ha aperto il suo sottomenu`);
      menu = sub;
    }
  }
}

/// Una riga di impostazione che è la scorciatoia di un comando **della shell**,
/// come la manda il backend: di macchina, col dichiarato per default.
export function shortcut(id: keyof typeof SHELL_KEYS): SettingEntry {
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
export async function shortcutField(label: string): Promise<HTMLInputElement> {
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
export function textToVideo(): string {
  const rows = [...document.querySelectorAll(".pane-editor .cm-content .cm-line")];
  return rows.map((r) => r.textContent).join("\n");
}

export const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "note/Spesa.md": "pane, latte, arance\n",
};

export function editorTexts(): string[] {
  // `.cm-scroller > `: il livello dei fantasmi dei Blocchi (`blocks/motion.ts`)
  // porta la classe del contenuto, ma non è un editor; `.pane-editor`: quelli
  // delle schede messe da parte sono nascosti, in `.pane-editor-riposo`.
  return [...document.querySelectorAll(".pane-editor .cm-scroller > .cm-content")].map((content) =>
    [...content.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n"),
  );
}

/// Divide dal registro e non col tasto: una tastiera dei gesti precedenti,
/// su un `document` che nessuno smonta, riceverebbe anche lei l'accordo.
export async function splitRight(): Promise<void> {
  const registry = await import("./ui/commands");
  await registry.allCommands().find((entry) => entry.id === "shell.pane.split.right")?.run?.();
}

/// Due riquadri: il primo su Benvenuto, il secondo su Riunione, col fuoco.
export async function twoPanes(): Promise<void> {
  await splitRight();
  await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
  await settle();
  document.querySelector<HTMLElement>("#file-list .tree-row.folder")?.click();
  await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
  [...document.querySelectorAll<HTMLElement>(".pane")][1]!
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  row("Riunione").click();
  await waitFor(
    "Riunione arriva nel secondo riquadro",
    () => editorViews()[1]?.state.doc.toString().includes("Appunti") === true,
  );
  await settle();
}

/// Dà la scatola del file di prova agli aiuti e registra i ganci: prima di ogni
/// prova la shell di prima si ferma e la pagina si svuota; alla fine del file
/// si ferma l'ultimo montaggio.
export function useShellHarness(shared: ShellBox): void {
  box = shared;
  // L'ultimo montaggio non ha un successore che fermi il suo intervallo: senza
  // questo, un giro dopo lo smontaggio dell'ambiente cerca un `document` che non
  // c'è più.
  afterAll(() => stopAnswering());

  beforeEach(() => {
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  // L'ultimo montaggio del file non ha un `beforeEach` dopo di sé: il suo
  // risponditore si ferma qui, prima che l'ambiente se ne vada.
  afterAll(() => {
    activeStop?.();
    activeStop = null;
    stopAnswering();
  });
}
