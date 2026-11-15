// @vitest-environment happy-dom
// La parità della GUI (R7): la tela mostra gli id che l'inventario dichiara
// (menu, barra, campi, appunti), ogni voce trova il suo id, i gesti e i tasti
// sono quelli delle costanti `GESTURES` e `KEYS`, e ogni tasto delle voci
// cambia il file se e solo se la voce dice `writes: "file"`. R8 (T23): ogni
// voce in codice con un menu, un bottone, un campo o un tasto scrive con la
// GUI la stessa lavagna della sua forma in codice; T24 aggiunge i gesti e
// gli appunti. Le regole R1–R6
// stanno in `crates/fub-canvas-core/tests/parity.rs`; come si aggiunge un
// gesto, in `docs/development/canvas-parity.md`.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenu, SurfaceMenuEntry } from "../core/editor-menu";
import { CardCache } from "./card-cache";
import { CARD_PANEL_ID, createCanvasInspector } from "./chrome/inspector";
import { createCardRegistry, type CardCellBox, type CardPageBox, type CardRenderer } from "./cards";
import type { CanvasEngine, CanvasEngineOptions, CanvasNotesPort } from "./engine";
import type { PartsPickerPort } from "./parts-picker";
import { mountCanvas } from "./test-mount";
import { canvasCoreReady, openCoreNow, type CanvasIntentOp } from "./wasm/core";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { decodeInk, inkLength, inkPoint } from "../spatial/ink/codec";
import boardFile from "../../__fixtures__/canvas-parity/board.json";
import mainFile from "../../__fixtures__/canvas-parity/main.json";
import n4File from "../../__fixtures__/canvas-parity/n4.json";
import n6File from "../../__fixtures__/canvas-parity/n6.json";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

/** I tipi di `gui`: dove sta la voce nella GUI. */
type GuiKind = "menu" | "toolbar" | "field" | "key" | "gesture" | "clipboard" | "plan";

/** La parte di una voce che R7 legge. Il JSON non porta i tipi: li dice questo. */
interface Voice {
  readonly id: string;
  readonly source: string;
  readonly gui: ReadonlyArray<Partial<Record<GuiKind, string>>>;
  readonly writes: "file" | "nothing" | "other-file";
  readonly state: string;
  readonly ops?: readonly CanvasIntentOp[];
}

/** Un valore di `gui` dichiarato da una voce. */
interface Declared {
  readonly voice: Voice;
  readonly value: string;
}

const VOICES = [...mainFile.entries, ...n4File.entries, ...n6File.entries] as unknown as readonly Voice[];
/** Le voci delle fonti in `merged`: le sole che R7 controlla (R2 e R7 saltano le altre). */
const MERGED = VOICES.filter((voice) => boardFile.merged.includes(voice.source));
/** La lavagna di prova, come testo: la legge il nucleo. */
const BOARD = JSON.stringify(boardFile.board);

/**
 * I gesti che la tela fa, con la riga che dice che cosa fa. Un gesto nuovo va
 * qui e nel file della sua fonte: R7 confronta le due liste. Il DOM non li
 * mostra, per questo la lista è la sola a dirli.
 */
const GESTURES: Readonly<Record<string, string>> = {
  "dblclick-empty": "doppio clic sul vuoto: una scheda di testo nel punto",
  "drop-files": "trascina file dal sistema sulla tela: una scheda file per ciascuno",
  "paste-text": "incolla testo: una scheda di testo, o di link se è un indirizzo",
  "drop-text": "trascina testo sulla tela: una scheda di testo, o di link se è un indirizzo",
  "drop-on-file-card": "trascina un file su una scheda file: la scheda cambia file",
  "dblclick-card": "doppio clic su una scheda: apre il suo campo di testo",
  "edit-commit": "il campo di una scheda si chiude e il testo si registra",
  "drag-card": "trascina una scheda dalla sua testata: la sposta",
  "drag-group": "trascina un gruppo dalla sua testata: si muovono anche le schede dentro",
  "resize-handle": "trascina l'angolo di una scheda: ne cambia le misure",
  "click-select": "clic su una scheda o su un arco: lo sceglie; Maiusc aggiunge o toglie",
  "wheel-zoom": "Ctrl con la rotella: ingrandisce o riduce; la sola rotella sposta la vista",
  pan: "trascina sul vuoto: sposta la vista",
  "connect-handle": "trascina dal pulsante «→» di una scheda su un'altra: crea un arco",
  "reconnect-end": "trascina un estremo di un arco su un'altra scheda: lo ricollega",
  "convert-to-note": "il pulsante di una scheda di testo la trasforma in nota e in file",
  "pen-on-card": "la penna, o il mouse che scrive, traccia sopra una scheda: il tratto va nella scheda",
  "pen-free": "la penna, o il mouse che scrive, traccia sul vuoto: un tratto libero della lavagna",
  "erase-stroke": "la gomma (la punta che cancella, o lo strumento Gomma) passa su un tratto: lo toglie intero",
  "erase-piece": "la gomma «Solo il pezzo» strofina un tratto: ne taglia il pezzo toccato",
  "drop-vault-file": "trascina un file dall'albero del vault sulla tela: una scheda file, con la misura della sua specie",
  "drop-vault-files": "trascina molti file dall'albero: una scheda ciascuno, in griglia",
  "type-grows": "si scrive in una scheda di testo: la scheda cresce col testo",
  "write-next-below": "Ctrl+Invio mentre si scrive in una scheda di testo: una scheda nuova sotto",
  "write-next-right": "Ctrl+Maiusc+Invio mentre si scrive in una scheda di testo: una scheda nuova a destra",
  "dblclick-handle": "doppio clic su una maniglia: la scheda prende la misura del suo contenuto",
  "connect-to-card": "Collega lascia il filo su una scheda: il filo va ai lati più vicini",
  "connect-to-empty": "Collega lascia il filo nel vuoto: nasce una scheda, col filo",
  "pen-on-page": "la penna traccia sopra una pagina di un PDF: il tratto va con la pagina",
  "pen-on-cell": "la penna traccia sopra un foglio: il tratto va con la sua cella",
  "lasso-move": "il Lazo sceglie dei tratti e li trascina: si spostano, anche in un'altra scheda",
  "lasso-restyle": "con dei tratti scelti col Lazo, la barra della selezione ne cambia colore o spessore",
  "pen-shape": "la penna ferma a fine tratto, o Maiusc: il tratto diventa una forma",
  "write-in-card": "si scrive dentro una scheda di nota o di foglio: cambia il file della scheda",
  "inspector-edit": "l'ispettore cambia i numeri o il nodo grezzo di una scheda",
  "put-page": "una pagina di un PDF messa sulla lavagna: una scheda di quella pagina",
  "snap-guides": "trascinando una scheda, le guide e la griglia la agganciano",
  "board-settings": "le Impostazioni della lavagna, fuori dalla tela",
};

/**
 * I tasti che la tela ascolta, come li scrive l'inventario. Come `GESTURES`:
 * il DOM non li mostra, e R7 confronta questa lista con le voci `key`.
 */
const KEYS: readonly string[] = [
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+Y",
  "Mod+A",
  "Mod+D",
  "Mod+=",
  "Mod++",
  "Mod+-",
  "Mod+0",
  "Delete",
  "Backspace",
  "Enter",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Shift+ArrowLeft",
  "Shift+ArrowRight",
  "Shift+ArrowUp",
  "Shift+ArrowDown",
  "D",
  "Mod+G",
];

/** I tasti dell'annulla: si premono dopo una mossa, perché annullano qualcosa. */
const AFTER_A_MOVE = new Set(["Mod+Z", "Mod+Shift+Z", "Mod+Y"]);
/** I tasti del ripeti rifanno ciò che l'annulla ha tolto: prima si annulla. */
const AFTER_AN_UNDO = new Set(["Mod+Shift+Z", "Mod+Y"]);

/**
 * Le note e le parti finte: con loro la tela offre i comandi delle schede di
 * nota (Estrai in una nota, Copia il testo qui, Parti…), che R7 deve vedere.
 * Nessuno li esegue: le risposte non contano.
 */
const NOTES: CanvasNotesPort = {
  freeName: async (_folder, name) => name,
  create: async (folder, name) => `${folder}/${name}.md`,
  read: async () => "",
};
const PARTS: PartsPickerPort = { outline: async () => [] };

/** Uno stato della tela: la selezione che R7 monta, e il punto dove si apre il menu. */
interface State {
  readonly name: string;
  readonly select: (host: HTMLElement, engine: CanvasEngine) => void;
  /** Una scheda, un arco (`edge:<id>`), o `null` per il vuoto. */
  readonly at: string | null;
}

const STATES: readonly State[] = [
  { name: "vuoto", select: () => {}, at: null },
  { name: "t1", select: (host) => select(host, "t1"), at: "t1" },
  { name: "f1", select: (host) => select(host, "f1"), at: "f1" },
  { name: "l1", select: (host) => select(host, "l1"), at: "l1" },
  { name: "p1", select: (host) => select(host, "p1"), at: "p1" },
  { name: "n1", select: (host) => select(host, "n1"), at: "n1" },
  // La riga della penna (N4): il suo menu c'è solo con uno strumento d'inchiostro.
  { name: "penna", select: (_host, engine) => run(engine, "canvas.tool.pen"), at: null },
  {
    name: "t1+t2",
    select: (host) => {
      select(host, "t1");
      select(host, "t2", true);
    },
    at: "t1",
  },
  {
    name: "t1+t2+f1",
    select: (host) => {
      select(host, "t1");
      select(host, "t2", true);
      select(host, "f1", true);
    },
    at: "t1",
  },
  { name: "e1", select: (host) => chooseEdge(host, "e1"), at: "edge:e1" },
  { name: "g1", select: (host) => select(host, "g1"), at: "g1" },
];

/** Ciò che la tela mostra, unito su tutti gli stati. */
interface Shown {
  readonly menus: Set<string>;
  readonly actions: Set<string>;
  readonly fields: Set<string>;
  readonly clipboard: Set<string>;
}

/** I valori di un tipo di `gui` delle voci in `merged`, con la voce che li dice. */
function declared(kind: GuiKind): Declared[] {
  return MERGED.flatMap((voice) =>
    voice.gui.flatMap((gui): Declared[] => {
      const value = gui[kind];
      return value === undefined ? [] : [{ voice, value }];
    }),
  );
}

/** Esegue il comando `id` del catalogo della tela, come la ricerca dei comandi. */
function run(engine: CanvasEngine, id: string): void {
  const command = engine.commands().find((one) => one.id === id);
  if (!command) throw new Error(`la tela non ha il comando «${id}»`);
  command.run();
}

function viewportOf(host: HTMLElement): HTMLElement {
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport");
  if (!viewport) throw new Error("la tela non ha il suo viewport");
  return viewport;
}

/** La scheda o l'arco di `at` nel DOM della tela. */
function elementOf(host: HTMLElement, at: string): Element {
  const found = at.startsWith("edge:")
    ? host.querySelector(`.canvas-edge-hit[data-edge="${at.slice("edge:".length)}"]`)
    : host.querySelector(`.canvas-node[data-node="${at}"]`);
  if (!found) throw new Error(`la tela non mostra «${at}»`);
  return found;
}

/** Un clic su una scheda, come lo fa il puntatore: `additive` è Maiusc. */
function select(host: HTMLElement, id: string, additive = false): void {
  elementOf(host, id).dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, shiftKey: additive, clientX: 0, clientY: 0 }),
  );
  viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
}

/** Sceglie un arco dal selettore della barra, come fa l'utente. */
function chooseEdge(host: HTMLElement, id: string): void {
  const picker = host.querySelector<HTMLSelectElement>('select[data-canvas-field="select-edge"]');
  if (!picker) throw new Error("la barra non ha il selettore degli archi");
  picker.value = id;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Un tasto come lo scrive l'inventario (`Mod+Shift+Z`, `Mod++`, `Shift+ArrowLeft`)
 * in un evento della tastiera. `Mod` è Ctrl, come nei test della tela.
 */
function press(target: HTMLElement, spec: string): void {
  const match = /^((?:Mod\+|Shift\+)*)(.+)$/.exec(spec);
  if (!match) throw new Error(`il tasto «${spec}» non si legge`);
  const modifiers = match[1] ?? "";
  const name = match[2] ?? "";
  const shiftKey = modifiers.includes("Shift+");
  const key = shiftKey || name.length > 1 ? name : name.toLowerCase();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, ctrlKey: modifiers.includes("Mod+"), shiftKey, bubbles: true, cancelable: true }),
  );
}

function addMenuIds(entry: SurfaceMenuEntry, into: Set<string>): void {
  if (typeof entry === "string") return;
  into.add(entry.id);
  for (const child of entry.items ?? []) addMenuIds(child, into);
}

function readDom(host: HTMLElement, shown: Shown): void {
  for (const el of host.querySelectorAll<HTMLElement>("[data-canvas-action]")) {
    shown.actions.add(el.dataset.canvasAction ?? "");
  }
  for (const el of host.querySelectorAll<HTMLElement>("[data-canvas-field]")) {
    shown.fields.add(el.dataset.canvasField ?? "");
  }
}

/** Il menu del tasto destro sul punto `target`, con i suoi id e gli appunti che offre. */
function openMenu(engine: CanvasEngine, target: Element, shown: Shown): void {
  const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
  let menu: SurfaceMenu | null;
  try {
    menu = engine.contextMenu({ x: 10, y: 10 });
  } finally {
    spy.mockRestore();
  }
  if (!menu) throw new Error("la tela non dà un menu in quel punto");
  for (const entry of menu.context ?? []) addMenuIds(entry, shown.menus);
  for (const [op, offered] of Object.entries(menu.clipboard?.offers ?? {})) {
    if (offered) shown.clipboard.add(op);
  }
}

/** Monta la tela in ogni stato e raccoglie ciò che mostra: menu, barra, campi, appunti. */
function showAll(): Shown {
  const shown: Shown = { menus: new Set(), actions: new Set(), fields: new Set(), clipboard: new Set() };
  for (const state of STATES) {
    const { engine, host } = mountCanvas(BOARD, { onPickFile: () => null, notes: NOTES, parts: PARTS });
    state.select(host, engine);
    readDom(host, shown);
    // Il menu del punto dello stato, e quello del vuoto: due menu diversi.
    const points = state.at === null ? [viewportOf(host)] : [elementOf(host, state.at), viewportOf(host)];
    for (const point of points) {
      openMenu(engine, point, shown);
      readDom(host, shown);
    }
    engine.destroy();
  }
  return shown;
}

/** Ogni id che la tela mostra ha una voce, e ogni voce trova il suo id. */
function compare(kind: string, shown: ReadonlySet<string>, values: readonly Declared[]): string[] {
  const wanted = new Set(values.map((entry) => entry.value));
  return [
    ...[...shown]
      .filter((id) => !wanted.has(id))
      .map((id) => `${kind} «${id}» nella tela: nessuna voce di una fonte in merged`),
    ...values
      .filter((entry) => !shown.has(entry.value))
      .map((entry) => `\`${entry.voice.id}\`: il ${kind} «${entry.value}» non c'è nella tela`),
  ];
}

/** Preme `key` con la scheda t1 selezionata: dice se il documento è cambiato. */
function pressOnT1(key: string): { changed: boolean; problem?: string } {
  const { engine, host } = mountCanvas(BOARD, { onPickFile: () => null });
  try {
    select(host, "t1");
    const viewport = viewportOf(host);
    if (AFTER_A_MOVE.has(key)) press(viewport, "ArrowRight");
    if (AFTER_AN_UNDO.has(key)) press(viewport, "Mod+Z");
    const before = engine.getDoc();
    press(viewport, key);
    if (key === "Enter") {
      // Invio apre il campo: chi scrive dentro lo registra, e lì il file cambia.
      const editor = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
      if (!editor) return { changed: false, problem: "Invio non apre il campo della scheda" };
      editor.value = `${editor.value} (prova)`;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      engine.commitPending();
    }
    return { changed: engine.getDoc() !== before };
  } finally {
    engine.destroy();
  }
}

/** Un tasto delle voci: cambia il file se e solo se la voce dice `writes: "file"`. */
function keyProblems({ voice, value }: Declared): string[] {
  const outcome = pressOnT1(value);
  if (outcome.problem) return [`\`${voice.id}\`: ${outcome.problem}`];
  if (outcome.changed === (voice.writes === "file")) return [];
  const verb = outcome.changed ? "cambia" : "non cambia";
  return [`\`${voice.id}\`: il tasto «${value}» ${verb} il documento, ma la voce dice writes «${voice.writes}»`];
}

describe("la parità della tela (R7)", () => {
  it("la lavagna di board.json si monta con le sue schede e i suoi archi", () => {
    const { engine, host } = mountCanvas(BOARD);
    expect(host.querySelectorAll(".canvas-node")).toHaveLength(boardFile.board.nodes.length);
    expect(host.querySelectorAll(".canvas-edge-hit")).toHaveLength(boardFile.board.edges.length);
    engine.destroy();
  });

  it("ogni id che la tela mostra ha una voce, e ogni voce trova il suo id", () => {
    const shown = showAll();
    expect([
      ...compare("menu", shown.menus, declared("menu")),
      ...compare("barra", shown.actions, declared("toolbar")),
      ...compare("campo", shown.fields, declared("field")),
      ...compare("appunti", shown.clipboard, declared("clipboard")),
    ]).toEqual([]);
  });

  it("i gesti delle voci sono quelli della costante GESTURES", () => {
    const named = declared("gesture");
    const ids = new Set(named.map((entry) => entry.value));
    const known = new Set(Object.keys(GESTURES));
    expect([
      ...[...known].filter((id) => !ids.has(id)).map((id) => `GESTURES ha «${id}», nessuna voce gesture lo dice`),
      ...named
        .filter((entry) => !known.has(entry.value))
        .map((entry) => `\`${entry.voice.id}\`: il gesto «${entry.value}» non è in GESTURES`),
    ]).toEqual([]);
  });

  it("i tasti delle voci sono quelli della costante KEYS", () => {
    const named = declared("key");
    const ids = new Set(named.map((entry) => entry.value));
    const known = new Set(KEYS);
    expect([
      ...KEYS.filter((key) => !ids.has(key)).map((key) => `KEYS ha «${key}», nessuna voce key lo dice`),
      ...named
        .filter((entry) => !known.has(entry.value))
        .map((entry) => `\`${entry.voice.id}\`: il tasto «${entry.value}» non è in KEYS`),
    ]).toEqual([]);
  });

  it("ogni tasto delle voci cambia il file se e solo se la voce dice writes: file", () => {
    expect(declared("key").flatMap(keyProblems)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R8 (T23): la GUI scrive come la forma in codice.
// ---------------------------------------------------------------------------

/** I tipi di `gui` che R8 prova: menu, barra, campi e tasti (T23), gesti e appunti (T24). */
const R8_GUI: readonly GuiKind[] = ["menu", "toolbar", "field", "key", "gesture", "clipboard"];

/**
 * Le voci di R8: in codice (`code` o `composed`), che scrivono il file, di una
 * fonte in `merged`, con almeno un menu, un bottone, un campo, un tasto, un
 * gesto o un gesto degli appunti.
 */
const R8_VOICES = MERGED.filter(
  (voice) =>
    (voice.state === "code" || voice.state === "composed")
    && voice.writes === "file"
    && voice.gui.some((gui) => R8_GUI.some((kind) => gui[kind] !== undefined)),
);

/** Il tetto delle voci che R8 non confronta (PLAN.md, R8). */
const R8_MAX_SKIPS = 5;

/** Le risposte del selettore dei file e delle note finte. */
interface R8Answers {
  readonly pickFile?: string;
  readonly newNote?: string;
  readonly noteText?: string;
  /** Le pagine del PDF per «Spargi le pagine»: con questo la tela ha il lettore, senza misure. */
  readonly pdfPageCount?: number;
}

/** La tela montata su cui R8 fa una voce. */
interface R8Context {
  readonly engine: CanvasEngine;
  readonly host: HTMLElement;
  readonly voice: Voice;
}

interface R8Run {
  /** Il valore di `gui` della voce che l'azione usa: deve essere della voce. */
  readonly via: string;
  /** Le schede o gli archi da scegliere prima; di serie gli id delle `ops`. */
  readonly select?: readonly string[];
  /** L'azione della GUI, come la fa l'utente. */
  readonly act: (context: R8Context) => void | Promise<void>;
  /**
   * Le operazioni da confrontare quando quelle della voce non possono dire il
   * posto o il contenuto che la GUI sceglie: le stesse operazioni (lo stesso
   * `op`), con i campi che la GUI scrive. `why` dice perché.
   */
  readonly ops?: (context: R8Context) => readonly CanvasIntentOp[];
  readonly why?: string;
  readonly answers?: R8Answers;
  /** Le porte in più della tela per il gesto (allegati, misure, `newId`). */
  readonly options?: () => Partial<CanvasEngineOptions>;
  /**
   * Ciò che il confronto lascia fuori dalle due lavagne, quando la GUI scrive
   * un campo che la forma in codice non può sapere (l'ora del tratto). `why`
   * dice perché.
   */
  readonly normalize?: (doc: string) => string;
  /** I passi d'annulla dell'azione: di serie uno. */
  readonly undos?: number;
}

/**
 * Come R8 fa una voce: un giro, o un giro per ogni gesto della voce (il
 * piano chiede la sequenza di ogni gesto), o `skip` col perché.
 */
type R8Setup = R8Run | readonly R8Run[] | { readonly skip: string };

/** I giri di una riga di `SETUP`: nessuno per una voce saltata. */
function runsOf(setup: R8Setup | undefined): readonly R8Run[] {
  if (!setup || "skip" in setup) return [];
  return Array.isArray(setup) ? setup : [setup as R8Run];
}

/** Il centro della vista in coordinate della lavagna, dalla trasformazione della scena. */
function worldCenter(host: HTMLElement): { x: number; y: number } {
  const stage = host.querySelector<HTMLElement>(".canvas-stage");
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(stage?.style.transform ?? "");
  if (!match) throw new Error("la scena della tela non dice la sua trasformazione");
  const [x, y, zoom] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // happy-dom non misura: la tela prende la vista di serie, 800×600.
  return { x: (400 - x) / zoom, y: (300 - y) / zoom };
}

/** Il posto di una scheda nata dal menu: centrata sul centro della vista, agganciata a 8. */
function bornAtCenter(host: HTMLElement, width: number, height: number) {
  const center = worldCenter(host);
  const snap = (value: number) => Math.round(value / 8) * 8;
  return { x: snap(center.x - 160), y: snap(center.y - 80), width, height };
}

function buttonOf(root: ParentNode, action: string): HTMLElement {
  const button = root.querySelector<HTMLElement>(`[data-canvas-action="${action}"]`);
  if (!button) throw new Error(`la barra non ha il bottone «${action}»`);
  return button;
}

/** Un campo della barra cambiato, come quando l'utente lo lascia. */
function setField(host: HTMLElement, field: string, value: string): void {
  const control = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-canvas-field="${field}"]`);
  if (!control) throw new Error(`la barra non ha il campo «${field}»`);
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Lascia finire le promesse della tela (selettore dei file, note, dialoghi). */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const runCommand = (id: string) => ({ via: id, act: ({ engine }: R8Context) => run(engine, id) });
const pressKey = (key: string) => ({ via: key, act: ({ host }: R8Context) => press(viewportOf(host), key) });

/** Il punto dello schermo di un punto della lavagna, dalla trasformazione della scena. */
function screenOf(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
  const stage = host.querySelector<HTMLElement>(".canvas-stage");
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(stage?.style.transform ?? "");
  if (!match) throw new Error("la scena della tela non dice la sua trasformazione");
  const [tx, ty, zoom] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { clientX: x * zoom + tx, clientY: y * zoom + ty };
}

/** Il punto della lavagna sotto il punto `(clientX, clientY)` dello schermo (la vista parte da 0,0). */
function worldOf(host: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const origin = screenOf(host, 0, 0);
  const unit = screenOf(host, 1, 0).clientX - origin.clientX;
  return { x: (clientX - origin.clientX) / unit, y: (clientY - origin.clientY) / unit };
}

const snap8 = (value: number) => Math.round(value / 8) * 8;

/**
 * La lavagna al 100%, subito: la penna scrive lo spessore diviso per lo
 * zoom (resta uguale sullo schermo), e la forma in codice è quella al 100%.
 */
function atFullSize(engine: CanvasEngine, host: HTMLElement): void {
  setReducedMotionPreference(true);
  try {
    run(engine, "canvas.zoom_reset");
  } finally {
    setReducedMotionPreference(false);
  }
  const unit = screenOf(host, 1, 0).clientX - screenOf(host, 0, 0).clientX;
  if (unit !== 1) throw new Error(`la lavagna non è al 100% ma al ${unit * 100}%`);
}

let penClock = 0;

/** Un evento del puntatore come lo dà il browser: il mouse di serie, col tasto principale. */
function pointerAt(target: EventTarget, type: string, at: { clientX: number; clientY: number }, init: PointerEventInit & { timeStamp?: number } = {}): void {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, azimuthAngle: 0,
    button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", ...at, ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
}

/**
 * Un tratto della penna (o della gomma, con `eraser`) sui punti `points`
 * della lavagna, a partire da `target`. `beforeLift` gira con la punta
 * ancora giù sull'ultimo punto.
 */
function penStroke(host: HTMLElement, target: Element, points: readonly (readonly [number, number])[], eraser = false, beforeLift?: () => void): void {
  const tip = eraser
    ? { pointerId: 9, pointerType: "pen", button: 5, buttons: 32, pressure: 0.5 }
    : { pointerId: 8, pointerType: "pen", button: 0, buttons: 1, pressure: 0.5 };
  pointerAt(target, "pointerdown", screenOf(host, ...points[0]!), { ...tip, timeStamp: penClock });
  for (const point of points.slice(1)) {
    penClock += 8;
    pointerAt(target, "pointermove", screenOf(host, ...point), { ...tip, button: -1, timeStamp: penClock });
  }
  beforeLift?.();
  const end = penClock + 4;
  penClock += 100;
  pointerAt(document, "pointerup", screenOf(host, ...points[points.length - 1]!), { ...tip, buttons: 0, pressure: 0, timeStamp: end });
}

/** Il mouse da `from` a `to` (punti della lavagna), premuto su `target`; `move` sono i tasti durante il movimento. */
function mouseDrag(host: HTMLElement, target: Element, from: readonly [number, number], to: readonly [number, number], move: PointerEventInit = {}): void {
  pointerAt(target, "pointerdown", screenOf(host, ...from));
  pointerAt(viewportOf(host), "pointermove", screenOf(host, ...to), move);
  pointerAt(viewportOf(host), "pointerup", screenOf(host, ...to), { ...move, buttons: 0 });
}

/** Un rilascio di file (dal sistema o dall'albero: li risolve la porta) nel punto `(x, y)` della lavagna. */
function dropAt(host: HTMLElement, x: number, y: number, altKey = false): void {
  const event = new DragEvent("drop", { bubbles: true, cancelable: true, altKey });
  const at = screenOf(host, x, y);
  const data = { files: [], items: [], types: ["Files"], getData: () => "" };
  Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: at.clientX }, clientY: { value: at.clientY } });
  viewportOf(host).dispatchEvent(event);
}

/** Un testo trascinato e lasciato nel punto `(x, y)` della lavagna. */
function dropTextAt(host: HTMLElement, x: number, y: number, text: string): void {
  const event = new DragEvent("drop", { bubbles: true, cancelable: true });
  const at = screenOf(host, x, y);
  const data = { files: [], items: [], types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? text : "") };
  Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: at.clientX }, clientY: { value: at.clientY } });
  viewportOf(host).dispatchEvent(event);
}

/** Un doppio clic del mouse su `target`, nel punto `(x, y)` della lavagna. */
function doubleClickAt(host: HTMLElement, target: Element, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, ...screenOf(host, x, y) }));
}

/** Scrive `text` nel campo aperto della scheda, al posto di quello che c'era. */
function typeInField(host: HTMLElement, text: string): HTMLTextAreaElement {
  const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
  if (!field) throw new Error("il campo della scheda non è aperto");
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return field;
}

/**
 * Il filo tirato da `handle` fino al punto `(x, y)` della lavagna, dove sta
 * `onto`: la tela chiede al documento che cosa c'è sotto il puntatore, che
 * happy-dom non sa.
 */
function pullWire(host: HTMLElement, handle: Element, from: readonly [number, number], to: readonly [number, number], onto: Element | null): void {
  const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(onto);
  try {
    mouseDrag(host, handle, from, to);
  } finally {
    pointing.mockRestore();
  }
}

/** Le schede finte per l'inchiostro di pagina e di cella, come `engine-ink-anchors.test.ts`. */
function anchorCards(page: CardPageBox | null, cell: CardCellBox | null): Partial<CanvasEngineOptions> {
  const pdf: CardRenderer = {
    kinds: ["pdf"],
    mount(_node, host) {
      host.append(document.createElement("div"));
      return { setMode: () => {}, page: () => page?.page ?? 1, pageBox: () => page, destroy: () => {} };
    },
  };
  const sheet: CardRenderer = {
    kinds: ["sheet"],
    mount(_node, host) {
      host.append(document.createElement("div"));
      const inside = (x: number, y: number) =>
        cell !== null && x >= cell.rect.x && x < cell.rect.x + cell.rect.width && y >= cell.rect.y && y < cell.rect.y + cell.rect.height;
      return {
        setMode: () => {},
        cellAt: ({ x, y }) => (inside(x, y) ? cell : null),
        cellRect: (name, address) => (cell && cell.sheet === name && cell.cell === address ? cell : null),
        destroy: () => {},
      };
    },
  };
  return { cards: { registry: createCardRegistry([pdf, sheet]), snapshots: new CardCache(), watch: () => () => {} } };
}

/**
 * La pagina 3 (A4, 595 × 842 punti) nella scheda p1 (360 × 480 in 560,400):
 * dall'angolo 12,44 della scheda, metà della misura, con le proporzioni della
 * pagina come `pageBox()`: la penna e la resa hanno la stessa scala.
 */
const PAGE_THREE: CardPageBox = { page: 3, size: { width: 595, height: 842 }, rect: { x: 12, y: 44, width: 297.5, height: 421 } };
/** B3 di «Foglio1» nella scheda f1 (in 0,400), in 104,60 della scheda, al 100%. */
const CELL_B3: CardCellBox = { sheet: "Foglio1", cell: "B3", rect: { x: 104, y: 60, width: 64, height: 20 }, zoom: 1 };

/** Un incolla sulla lavagna: senza puntatore visto, nel punto dello schermo 0,0. */
function pasteOn(host: HTMLElement, values: Record<string, string>): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const data = { files: [], items: [], types: Object.keys(values), getData: (type: string) => values[type] ?? "" };
  Object.defineProperty(event, "clipboardData", { value: data });
  viewportOf(host).dispatchEvent(event);
}

/** Il punto agganciato dove nasce ciò che si incolla senza puntatore. */
function pastePoint(host: HTMLElement): { x: number; y: number } {
  const point = worldOf(host, 0, 0);
  return { x: snap8(point.x), y: snap8(point.y) };
}

/** Gli `id` dati in fila, per `newId` della tela. */
function idsInOrder(...ids: string[]): () => string {
  let next = 0;
  return () => ids[next++] ?? `extra-${next}`;
}

/** Il documento con ogni tratto passato da `change`. */
function eachStroke(doc: string, change: (stroke: Record<string, unknown>) => void): string {
  const value = JSON.parse(doc) as Record<string, unknown> & { nodes?: Record<string, unknown>[] };
  const visit = (holder: Record<string, unknown> | undefined) => {
    const layer = holder?.["fub:ink"] as { strokes?: Record<string, unknown>[] } | undefined;
    for (const stroke of layer?.strokes ?? []) change(stroke);
  };
  visit(value);
  for (const node of value.nodes ?? []) visit(node);
  return JSON.stringify(value);
}

/** Il documento senza l'ora dei tratti (`at`): la GUI la scrive, la forma in codice no. */
function withoutStrokeTime(doc: string): string {
  return eachStroke(doc, (stroke) => {
    delete stroke.at;
  });
}

/**
 * Il documento senza l'ora dei tratti e con l'inchiostro di ogni tratto
 * detto dal riquadro dei suoi punti: una forma della GUI e quella di `draw`
 * hanno gli stessi lati ma i punti presi in modo diverso.
 */
function withShapeBox(doc: string): string {
  return eachStroke(doc, (stroke) => {
    delete stroke.at;
    const ink = decodeInk(String(stroke.ink));
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < inkLength(ink); i++) {
      const [x, y] = inkPoint(ink, i);
      [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
    }
    stroke.ink = `riquadro ${Math.round(left)},${Math.round(top)} ${Math.round(right)},${Math.round(bottom)}`;
  });
}

/**
 * Sceglie nel menu della penna, aperto da `open`, le voci `choices` (gruppo
 * → valore) e lo spessore `width` in pixel dello schermo, come l'utente; poi
 * lo chiude.
 */
function pickPen(open: () => void, choices: Readonly<Record<string, string>>, width: number): void {
  open();
  const popover = document.querySelector<HTMLElement>(".canvas-pen-popover");
  if (!popover) throw new Error("il menu della penna non si apre");
  for (const [group, value] of Object.entries(choices)) {
    const found = popover.querySelector<HTMLElement>(`[role="radio"][data-group="${group}"][data-value="${value}"]`);
    if (!found) throw new Error(`il menu della penna non ha ${group} «${value}»`);
    found.click();
  }
  const slider = popover.querySelector<HTMLInputElement>(".canvas-pen-width");
  if (!slider) throw new Error("il menu della penna non ha lo spessore");
  slider.value = String(width);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/** La penna di `draw` di serie: la biro di 2 unità, al 100%. */
function ballpointAtFullSize(engine: CanvasEngine, host: HTMLElement): void {
  atFullSize(engine, host);
  pickPen(() => run(engine, "canvas.pen_menu"), { tool: "pen", kind: "ballpoint" }, 2);
}

/** Il tipo degli appunti con le schede di Fub (N6 T68). */
const CLIPBOARD_TYPE = "application/x-fub-canvas+json";

/**
 * Apre il campo della scheda di testo `id` (Invio), poi Ctrl+Invio (con
 * Maiusc a destra) fa la scheda dopo, e ci si scrive `text`.
 */
function writeNext(engine: CanvasEngine, host: HTMLElement, id: string, beside: boolean, text: string): void {
  select(host, id);
  press(viewportOf(host), "Enter");
  const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
  if (!field) throw new Error(`Invio non apre il campo di ${id}`);
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: beside, bubbles: true, cancelable: true }));
  const next = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
  if (!next || next === field) throw new Error("Ctrl+Invio non apre la scheda dopo");
  next.value = text;
  next.dispatchEvent(new Event("input", { bubbles: true }));
  engine.commitPending();
}

/** Lo spessore del pennarello di `draw`, in unità: al 100% è quello del menu. */
const SHAPE_WIDTH = 6;

const STROKE_TIME = "la GUI scrive l'ora del tratto (`at`), che la forma in codice non sa: il confronto la toglie dalle due lavagne";

/**
 * Come R8 fa ogni voce. Una voce nuova in codice con una GUI va qui: senza,
 * R8 fallisce. `skip` vale solo per una voce che non si può confrontare, e
 * dice perché; non più di `R8_MAX_SKIPS`.
 */
const SETUP: Readonly<Record<string, R8Setup>> = {
  "main.card.add_text": [
    {
      ...runCommand("canvas.add.text"),
      ops: ({ host }) => [{ op: "add_card", text: "", ...bornAtCenter(host, 320, 160) }],
      why: "la scheda nasce vuota al centro della vista, con la misura di sempre della GUI; il testo si scrive dopo",
    },
    {
      via: "dblclick-empty",
      select: [],
      act: ({ engine, host }) => {
        doubleClickAt(host, viewportOf(host), 1400, 1000);
        typeInField(host, "Idea");
        engine.commitPending();
      },
      ops: () => [{ op: "add_card", text: "Idea", x: 1400, y: 1000, width: 320, height: 160 }],
      why: "la scheda nasce con l'angolo nel punto del doppio clic, agganciato a 8, con la misura di sempre della GUI, e ci si scrive",
      // La scheda nasce vuota (un passo), poi ci si scrive (un altro).
      undos: 2,
    },
  ],
  "main.card.add_file": {
    via: "canvas.add.file",
    answers: { pickFile: "Corsi/appunti.md" },
    act: async ({ engine }) => {
      run(engine, "canvas.add.file");
      await settle();
    },
    ops: ({ host }) => [{ op: "add_card", file: "Corsi/appunti.md", ...bornAtCenter(host, 320, 160) }],
    why: "al centro della vista e 320×160 per ogni specie, come prima di T23",
  },
  "main.card.add_link": {
    ...runCommand("canvas.add.link"),
    ops: ({ host }) => [{ op: "add_card", url: "https://", ...bornAtCenter(host, 320, 120) }],
    why: "il collegamento nasce con «https://» da completare, al centro della vista",
  },
  "main.card.add_group": {
    via: "add-group",
    act: ({ host }) => buttonOf(host, "add-group").click(),
    ops: ({ host }) => [{ op: "add_card", label: "", ...bornAtCenter(host, 480, 320) }],
    why: "il gruppo nasce senza nome al centro della vista",
  },
  "main.card.edit": [
    {
      via: "Enter",
      act: ({ engine, host }) => {
        press(viewportOf(host), "Enter");
        const editor = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
        if (!editor) throw new Error("Invio non apre il campo della scheda");
        editor.value = "Perché la media è così bassa?";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        engine.commitPending();
      },
    },
    {
      via: "dblclick-card",
      select: [],
      act: ({ engine, host }) => {
        doubleClickAt(host, host.querySelector('.canvas-node[data-node="t1"]')!, 100, 80);
        typeInField(host, "Perché la media è così bassa?");
        engine.commitPending();
      },
    },
    {
      // Il campo si chiude con Esc: il testo si registra senza aspettare la pausa.
      via: "edit-commit",
      act: ({ host }) => {
        press(viewportOf(host), "Enter");
        const field = typeInField(host, "Perché la media è così bassa?");
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        if (host.querySelector(".canvas-text-editor")) throw new Error("Esc non chiude il campo");
      },
    },
  ],
  "main.card.move": [
    pressKey("ArrowRight"),
    {
      // Di 27 a destra e 3 in giù: il riquadro di t1 si aggancia a 24,0. Di 8
      // come la voce non si può: la guida del bordo sinistro di f1 lo riporta a 0.
      via: "drag-card",
      select: [],
      act: ({ host }) => {
        mouseDrag(host, host.querySelector('.canvas-node[data-node="t1"] .canvas-node-handle')!, [100, 10], [127, 13]);
      },
      ops: () => [{ op: "move", ids: ["t1"], dx: 24, dy: 0 }],
      why: "il trascinamento aggancia il riquadro a 8 (27 → 24, 3 → 0); uno spostamento di 8 la guida di f1 lo riporta a 0",
    },
  ],
  "main.color.preset": runCommand("canvas.color.1"),
  "main.color.none": {
    via: "canvas.color.none",
    // t1 non ha colore nella lavagna di prova: prima lo prende, poi lo perde.
    act: ({ engine }) => {
      run(engine, "canvas.color.3");
      // Senza il colore 3 scritto, «nessun colore» non toglierebbe niente e
      // la voce passerebbe a vuoto.
      if (engine.getDoc() === BOARD) throw new Error("`canvas.color.3` non ha scritto il colore");
      run(engine, "canvas.color.none");
    },
    undos: 2,
  },
  "main.color.hex": {
    via: "canvas.color.other",
    act: ({ engine }) => {
      run(engine, "canvas.color.other");
      const code = document.querySelector<HTMLInputElement>(".kit-color-input");
      if (!code) throw new Error("«Altro…» non apre il selettore del colore");
      code.value = "#0064b0";
      code.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    },
  },
  "main.duplicate": pressKey("Mod+D"),
  "main.delete": pressKey("Delete"),
  "main.order.front": runCommand("canvas.bring_front"),
  "main.order.back": runCommand("canvas.send_back"),
  "main.align": runCommand("canvas.align.left"),
  "main.distribute": runCommand("canvas.distribute_x"),
  "main.edge.connect": [
    runCommand("canvas.connect"),
    {
      via: "connect-handle",
      select: [],
      act: ({ host }) => {
        const handle = host.querySelector('.canvas-node[data-node="t2"] [data-connect]');
        if (!handle) throw new Error("t2 non ha il pulsante «→»");
        const body = host.querySelector('.canvas-node[data-node="f1"] .canvas-card-body') ?? host.querySelector('.canvas-node[data-node="f1"]');
        pullWire(host, handle, [700, 20], [200, 500], body);
      },
    },
  ],
  "main.edge.reconnect": [
    { via: "edge-toNode", act: ({ host }) => setField(host, "edge-toNode", "f1") },
    {
      // L'estremo di arrivo di e1 (sul lato sinistro di t2, in 400,80) lasciato sul corpo di f1.
      via: "reconnect-end",
      act: ({ host }) => {
        const end = host.querySelector('[data-reconnect="e1"][data-endpoint="to"]');
        if (!end) throw new Error("e1 scelto non ha la maniglia dell'estremo di arrivo");
        const body = host.querySelector('.canvas-node[data-node="f1"] .canvas-card-body') ?? host.querySelector('.canvas-node[data-node="f1"]');
        pullWire(host, end, [400, 80], [200, 500], body);
      },
      ops: () => [{ op: "set", id: "e1", fields: { toNode: "f1", toSide: "top" } }],
      why: "la GUI riattacca l'estremo al lato di f1 più vicino all'altro capo (in alto): la regola dei lati per l'estremo riattaccato resta in TypeScript (DECISIONS, T24)",
    },
  ],
  "main.edge.reverse": runCommand("canvas.edge.reverse"),
  "main.edge.label": { via: "edge-label", act: ({ host }) => setField(host, "edge-label", "perché") },
  // La voce dice il sottomenu «Colore» (`canvas.color`): la sua voce 4.
  "main.edge.color": { via: "canvas.color", act: ({ engine }) => run(engine, "canvas.color.4") },
  "main.edge.sides": {
    via: "edge-fromSide",
    act: ({ host }) => {
      setField(host, "edge-fromSide", "bottom");
      setField(host, "edge-toSide", "top");
    },
    undos: 2,
  },
  "main.edge.ends": { via: "edge-fromEnd", act: ({ host }) => setField(host, "edge-fromEnd", "arrow") },
  "N4.ink.highlighter": {
    via: "ink-pen",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      run(engine, "canvas.tool.highlighter");
      // Il bottone della penna apre il suo menu: l'evidenziatore giallo di 16 (quello di `draw`), poi il tratto.
      pickPen(() => buttonOf(host, "ink-pen").click(), { color: "#f0e442" }, 16);
      penStroke(host, host.querySelector('.canvas-node[data-node="t1"]')!, [[20, 40], [220, 40]]);
    },
    normalize: withoutStrokeTime,
    why: STROKE_TIME,
  },
  "N6.text.style": {
    via: "text-size-l",
    act: ({ host }) => {
      buttonOf(host, "text-size-l").click();
      buttonOf(host, "text-align-center").click();
    },
    undos: 2,
  },
  "N6.color.names": runCommand("canvas.color.blue"),
  "N6.group.selection": pressKey("Mod+G"),
  "N6.convert.extract": {
    via: "canvas.extract_note",
    answers: { newNote: "Corsi/Ripasso.md" },
    act: async ({ engine }) => {
      run(engine, "canvas.extract_note");
      await settle();
      const confirm = document.querySelector<HTMLElement>('.kit-dialog [data-action="extract"]');
      if (!confirm) throw new Error("Estrai in una nota non chiede il nome");
      confirm.click();
      await settle();
    },
  },
  "N6.convert.copy_here": {
    via: "canvas.copy_note_text",
    select: ["n1"],
    answers: { noteText: "(il testo letto)" },
    act: async ({ engine }) => {
      run(engine, "canvas.copy_note_text");
      await settle();
    },
    // n1 sta in 1000,400 ed è 320×200: a destra a 24, larga e alta come lei.
    ops: () => [{ op: "add_card", text: "(il testo letto)", x: 1344, y: 400, width: 320, height: 200 }],
    why: "la scheda va accanto alla nota (n1: f1 non è una nota) al primo posto libero a 24, larga e alta come lei; `near` lascia 48 e nasce con la misura del testo",
  },
  "N6.pages.spread": {
    via: "canvas.spread_pages",
    answers: { pdfPageCount: 12 },
    act: async ({ engine }) => {
      run(engine, "canvas.spread_pages");
      await settle();
      const field = document.querySelector<HTMLInputElement>(".kit-dialog .kit-field-input");
      if (!field) throw new Error("Spargi le pagine non chiede quali");
      field.value = "1-2";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLElement>('.kit-dialog [data-action="spread"]')?.click();
      await settle();
    },
  },
  "N6.parts.excerpt": {
    skip: "la voce raccoglie quattro gesti (pagine, zona, sezioni, ritaglio): «Parti…» fa solo le sezioni sul posto, e il selettore che scrive `excerpt` lo porta T26",
  },
  // --- I gesti e gli appunti (T24) ---------------------------------------
  "main.card.drop_files": {
    via: "drop-files",
    options: () => ({
      attachments: { deposit: async () => [], resolvePaths: async () => ["Corsi/b.md", "Corsi/a.md"] },
      newId: idsInOrder("a", "b"),
    }),
    act: async ({ host }) => {
      dropAt(host, 1400, 0);
      await settle();
    },
    ops: ({ voice }) => [...(voice.ops ?? []).slice(0, 2), { ...voice.ops![2]!, x: 1400, y: 0 }],
    why: "la griglia parte dal punto del rilascio, che la voce non dice",
  },
  "main.card.paste_text": [
    {
      via: "paste-text",
      act: async ({ host }) => {
        pasteOn(host, { "text/plain": "Testo incollato" });
        await settle();
      },
      ops: ({ host }) => [{ op: "add_card", text: "Testo incollato", ...pastePoint(host) }],
      why: "nel punto dell'incolla, agganciato a 8, con la forma breve: la misura la dà il nucleo",
    },
    {
      via: "drop-text",
      act: async ({ host }) => {
        dropTextAt(host, 1403, 997, "Testo incollato");
        await settle();
      },
      ops: () => [{ op: "add_card", text: "Testo incollato", x: 1400, y: 1000 }],
      why: "nel punto del rilascio, agganciato a 8, con la forma breve: la misura la dà il nucleo",
    },
  ],
  "main.card.replace_file": {
    via: "drop-on-file-card",
    options: () => ({ attachments: { deposit: async () => [], resolvePaths: async () => ["Corsi/voti-2.xlsx"] } }),
    act: async ({ host }) => {
      const body = host.querySelector('.canvas-node[data-node="f1"]');
      const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(body);
      try {
        dropAt(host, 100, 500);
        await settle();
      } finally {
        pointing.mockRestore();
      }
    },
  },
  "main.card.convert_to_note": {
    via: "convert-to-note",
    answers: { newNote: "Corsi/Perché la media è bassa.md" },
    select: [],
    act: async ({ host }) => {
      const button = host.querySelector<HTMLElement>('.canvas-node[data-node="t1"] .canvas-convert-note');
      if (!button) throw new Error("la scheda di testo non ha il pulsante «Estrai in una nota»");
      button.click();
      await settle();
      const confirm = document.querySelector<HTMLElement>('.kit-dialog [data-action="extract"]');
      if (!confirm) throw new Error("Estrai in una nota non chiede il nome");
      confirm.click();
      await settle();
    },
  },
  "main.group.drag": {
    via: "drag-group",
    select: [],
    // Alt durante il movimento: niente griglia né guide, lo spostamento del puntatore.
    act: ({ host }) => {
      const head = host.querySelector('.canvas-node[data-node="g1"] .canvas-node-handle');
      if (!head) throw new Error("il gruppo non ha la testata");
      mouseDrag(host, head, [0, -60], [40, -60], { altKey: true });
    },
  },
  "main.card.resize": {
    via: "resize-handle",
    act: ({ host }) => {
      const grip = host.querySelector('.canvas-node[data-node="t1"] .canvas-resize[data-corner="se"]');
      if (!grip) throw new Error("t1 non ha la maniglia in basso a destra");
      mouseDrag(host, grip, [320, 160], [400, 200]);
    },
  },
  "N4.ink.pen_card": {
    via: "pen-on-card",
    act: ({ engine, host }) => {
      ballpointAtFullSize(engine, host);
      penStroke(host, host.querySelector('.canvas-node[data-node="f1"]')!, [[40, 460], [44, 460], [48, 460]]);
    },
    normalize: withoutStrokeTime,
    why: STROKE_TIME,
  },
  "N4.ink.pen_free": {
    via: "pen-free",
    act: ({ engine, host }) => {
      ballpointAtFullSize(engine, host);
      penStroke(host, viewportOf(host), [[1500, 0], [1504, 4]]);
    },
    normalize: withoutStrokeTime,
    why: STROKE_TIME,
  },
  "N6.ink.owner": {
    via: "pen-on-card",
    act: ({ engine, host }) => {
      ballpointAtFullSize(engine, host);
      penStroke(host, host.querySelector('.canvas-node[data-node="f1"]')!, [[40, 460], [44, 460]]);
    },
    normalize: withoutStrokeTime,
    why: STROKE_TIME,
  },
  "N4.ink.erase_stroke": {
    via: "erase-stroke",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      // s1 di f1 parte da 40,60 della scheda (40, 460 sulla lavagna) e va a destra di 4.
      penStroke(host, viewportOf(host), [[42, 440], [42, 480]], true);
    },
  },
  "N4.ink.erase_piece": {
    via: "erase-piece",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      engine.setInkEraser("piece");
      // Di traverso su s1 di f1 (da 40,460 a 44,460 sulla lavagna).
      penStroke(host, viewportOf(host), [[42, 440], [42, 480]], true);
    },
    // La gomma è larga 8 px di raggio sullo schermo: 16 unità al 100%.
    ops: () => [{ op: "erase_along", points: [[42, 40], [42, 80]], size: 16, on: "f1" }],
    why: "il cammino della voce non tocca nessun tratto di board.json; la GUI taglia s1 di f1 nelle coordinate della scheda (`on`), con la larghezza della gomma al 100%",
  },
  "N6.card.drop_vault": {
    via: "drop-vault-file",
    options: () => ({
      attachments: { deposit: async () => [], resolvePaths: async () => ["Corsi/foto.png"] },
      measureImage: async () => ({ width: 4032, height: 3024 }),
      newId: idsInOrder("foto"),
    }),
    // Alt: niente selettore delle parti dopo il rilascio (T74).
    act: async ({ host }) => {
      dropAt(host, 1400, 0, true);
      await settle();
    },
    ops: () => [{ op: "add_card", id: "foto", file: "Corsi/foto.png", content_size: [4032, 3024], x: 1400, y: 0 }],
    why: "nel punto del rilascio, con l'id che dà `newId`",
  },
  "N6.card.drop_many": {
    via: "drop-vault-files",
    options: () => ({
      attachments: { deposit: async () => [], resolvePaths: async () => ["Corsi/b.md", "Corsi/a.md"] },
      newId: idsInOrder("a", "b"),
    }),
    act: async ({ host }) => {
      dropAt(host, 1400, 0);
      await settle();
    },
    ops: () => [
      { op: "add_card", id: "a", file: "Corsi/a.md" },
      { op: "add_card", id: "b", file: "Corsi/b.md" },
      { op: "layout", ids: ["a", "b"], kind: "grid", x: 1400, y: 0 },
    ],
    why: "la griglia parte dal punto del rilascio",
  },
  "N6.text.grow": {
    skip: "la scheda cresce con la misura del testo che dà il DOM, che happy-dom non impagina; `resize` con `fit` misura il testo nel nucleo",
  },
  "N6.text.new_below": {
    via: "write-next-below",
    select: [],
    options: () => ({ newId: idsInOrder("poi") }),
    act: ({ engine, host }) => {
      writeNext(engine, host, "t1", false, "Poi");
    },
    ops: () => [{ op: "add_card", id: "poi", text: "Poi", x: 0, y: 184, width: 320, height: 160 }],
    why: "la scheda va sotto t1 al primo posto libero a 24, larga e alta come lei; `near` lascia 48 e nasce con la misura del testo",
    // La scheda nasce vuota (un passo), poi ci si scrive (un altro).
    undos: 2,
  },
  "N6.text.new_right": {
    via: "write-next-right",
    select: [],
    options: () => ({ newId: idsInOrder("n") }),
    act: ({ engine, host }) => {
      writeNext(engine, host, "t2", true, "Perché");
    },
    ops: () => [
      { op: "add_card", id: "n", text: "Perché", x: 744, y: 144, width: 320, height: 160 },
      { op: "connect", from: "t2", to: "n", sides: { from: "right", to: "left" } },
    ],
    why: "si scrive in una scheda di testo (l1 è un collegamento: t2); la scheda va a destra al primo posto libero a 24 (sotto l1 e accanto a t2 il primo è 744,144), larga e alta come lei",
    undos: 2,
  },
  "N6.resize.fit": {
    skip: "la misura del contenuto la legge la tela dal DOM (i pixel dell'immagine o della pagina mostrata), che happy-dom non dà",
  },
  "N6.edge.nearest": {
    via: "connect-to-card",
    select: [],
    act: ({ engine, host }) => {
      run(engine, "canvas.tool.connect");
      const target = host.querySelector('.canvas-node[data-node="f1"] .canvas-card-body') ?? host.querySelector('.canvas-node[data-node="f1"]');
      const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
      try {
        mouseDrag(host, host.querySelector('.canvas-node[data-node="t1"]')!, [100, 80], [200, 500]);
      } finally {
        pointing.mockRestore();
      }
    },
  },
  "N6.edge.drop_empty": {
    via: "connect-to-empty",
    select: [],
    options: () => ({ newId: idsInOrder("n") }),
    act: ({ engine, host }) => {
      run(engine, "canvas.tool.connect");
      const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewportOf(host));
      try {
        mouseDrag(host, host.querySelector('.canvas-node[data-node="f1"]')!, [100, 500], [100, 1000]);
      } finally {
        pointing.mockRestore();
      }
      engine.commitPending();
    },
    ops: () => [
      { op: "add_card", id: "n", text: "", x: -56, y: 1000, width: 320, height: 160 },
      { op: "connect", from: "f1", to: "n", sides: "auto" },
    ],
    why: "la scheda nasce dove si lascia il filo (centrata sul puntatore in 100, agganciata a 8), con la misura di sempre della GUI",
  },
  "N6.clipboard.paste": {
    via: "paste",
    select: [],
    act: async ({ host, voice }) => {
      const fragment = (voice.ops?.[0] as { fragment?: unknown } | undefined)?.fragment;
      viewportOf(host).focus();
      pasteOn(host, { [CLIPBOARD_TYPE]: JSON.stringify(fragment), "text/plain": "Perché la media è bassa?" });
      await settle();
    },
    ops: ({ host, voice }) => [{ ...voice.ops![0]!, ...pastePoint(host) }],
    why: "nel punto dell'incolla, agganciato a 8",
  },
  "N6.clipboard.cut": {
    via: "cut",
    act: ({ host }) => {
      viewportOf(host).focus();
      const values: Record<string, string> = {};
      const event = new Event("cut", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData: (type: string, value: string) => { values[type] = value; }, getData: (type: string) => values[type] ?? "" } });
      document.dispatchEvent(event);
      if (!values[CLIPBOARD_TYPE]) throw new Error("Taglia non ha messo le schede negli appunti");
    },
  },
  "N6.ink.lasso": {
    via: "lasso-move",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      run(engine, "canvas.tool.lasso");
      const viewport = viewportOf(host);
      const loop: [number, number][] = [[1480, -20], [1530, -20], [1530, 30], [1480, 30], [1480, -18]];
      pointerAt(viewport, "pointerdown", screenOf(host, ...loop[0]!));
      for (const point of loop.slice(1)) pointerAt(viewport, "pointermove", screenOf(host, ...point));
      pointerAt(viewport, "pointerup", screenOf(host, ...loop[loop.length - 1]!), { buttons: 0 });
      mouseDrag(host, viewport, [1502, 2], [1542, 2]);
    },
  },
  "N6.ink.restyle": {
    via: "lasso-restyle",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      run(engine, "canvas.tool.lasso");
      const viewport = viewportOf(host);
      const loop: [number, number][] = [[1480, -20], [1530, -20], [1530, 30], [1480, 30], [1480, -18]];
      pointerAt(viewport, "pointerdown", screenOf(host, ...loop[0]!));
      for (const point of loop.slice(1)) pointerAt(viewport, "pointermove", screenOf(host, ...point));
      pointerAt(viewport, "pointerup", screenOf(host, ...loop[loop.length - 1]!), { buttons: 0 });
      const color = host.querySelector<HTMLElement>('[data-command="canvas.stroke_color"]');
      if (!color) throw new Error("la barra della selezione non ha il colore dei tratti");
      color.click();
      const swatch = document.querySelector<HTMLElement>('.canvas-stroke-popover .canvas-pen-swatch[data-value="#d55e00"]');
      if (!swatch) throw new Error("il colore dei tratti non ha il vermiglio");
      swatch.click();
    },
  },
  "N6.ink.shapes": {
    via: "pen-shape",
    select: [],
    act: ({ engine, host }) => {
      atFullSize(engine, host);
      pickPen(() => run(engine, "canvas.pen_menu"), { tool: "pen", kind: "marker", color: "#d55e00" }, SHAPE_WIDTH);
      // Un rettangolo coi punti di mezzo dei lati; la penna ferma mezzo secondo prima di alzarsi.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        penStroke(host, viewportOf(host), [
          [1400, 0], [1500, 0], [1600, 0], [1600, 50], [1600, 100], [1500, 100], [1400, 100], [1400, 50], [1400, 0],
        ], false, () => vi.advanceTimersByTime(500));
      } finally {
        vi.useRealTimers();
      }
    },
    normalize: withShapeBox,
    why: "la GUI scrive l'ora del tratto e prende i punti della forma dal tratto, con l'inclinazione; `draw` li prende a passi suoi: il confronto guarda tutti i campi del tratto e il riquadro dei punti",
    // Il tratto (un passo), poi la forma che lo sostituisce (un altro).
    undos: 2,
  },
  "N6.ink.page": {
    via: "pen-on-page",
    select: [],
    options: () => anchorCards(PAGE_THREE, null),
    act: ({ engine, host }) => {
      ballpointAtFullSize(engine, host);
      // 72,100 e 300,100 della pagina: 560 + 12 + 72/2 e 400 + 44 + 100/2 sulla lavagna.
      penStroke(host, host.querySelector('.canvas-node[data-node="p1"]')!, [[608, 494], [722, 494]]);
    },
    ops: ({ voice }) => [{ ...voice.ops![0]!, size: 4 }],
    normalize: withoutStrokeTime,
    why: `la penna scrive lo spessore che si vede: la biro di 2 unità sulla pagina mostrata a metà sono 4 punti della pagina, e \`draw\` prende \`size\` in punti della pagina; ${STROKE_TIME}`,
  },
  "N6.ink.cell": {
    via: "pen-on-cell",
    select: [],
    options: () => anchorCards(null, CELL_B3),
    act: ({ engine, host }) => {
      ballpointAtFullSize(engine, host);
      // 2,10 e 60,10 della cella: 104 + 2 e 400 + 60 + 10 sulla lavagna.
      penStroke(host, host.querySelector('.canvas-node[data-node="f1"]')!, [[106, 470], [164, 470]]);
    },
    normalize: withoutStrokeTime,
    why: STROKE_TIME,
  },
  "N6.inspector.raw": {
    via: "inspector-edit",
    act: ({ engine }) => {
      // L'ispettore della shell sulla tela, come lo monta l'app: «Avanzate» della scheda scelta.
      const inspector = createCanvasInspector({
        source: () => engine.getDoc(),
        reveal: () => false,
        edit: {
          selection: () => engine.selection(),
          doc: () => engine.doc(),
          commit: (patches) => engine.commitPatches(patches),
          readOnly: () => false,
        },
      });
      inspector.offer(true);
      const panel = inspector.panels.list().find((each) => each.id === CARD_PANEL_ID);
      if (!panel) throw new Error("l'ispettore non ha il pannello della scheda");
      const place = document.createElement("div");
      document.body.append(place);
      const unmount = panel.mount(place);
      try {
        place.querySelector<HTMLButtonElement>(".canvas-inspector-disclosure")?.click();
        const x = [...place.querySelectorAll<HTMLTableRowElement>(".canvas-inspector-raw tr")]
          .find((row) => row.querySelector("th")?.textContent === "x")
          ?.querySelector<HTMLInputElement>("input");
        if (!x) throw new Error("il nodo grezzo non ha il campo x");
        x.value = "16";
        x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      } finally {
        unmount();
      }
    },
    ops: () => [{ op: "set", id: "t1", fields: { x: 16 } }],
    why: "il nodo grezzo cambia i campi che la scheda ha già: un campo nuovo (`fub:nota`) non si aggiunge dall'ispettore",
  },
  "N6.put_page": {
    skip: "la tela non ha un gesto che metta una pagina di PDF in una scheda sua (`#page=`): le pagine arrivano con «Spargi le pagine» (`N6.pages.spread`, confrontata) e la voce `put-page` non ha ancora un'azione da fare",
  },
  "N6.card.relink": {
    via: "canvas.replace_file",
    answers: { pickFile: "Archivio/voti.xlsx" },
    act: async ({ engine }) => {
      run(engine, "canvas.replace_file");
      await settle();
    },
  },
};

/** Gli id che le operazioni della voce nominano: le schede e gli archi da scegliere. */
function opIds(ops: readonly CanvasIntentOp[]): string[] {
  const ids: string[] = [];
  for (const op of ops) {
    for (const key of ["ids", "id", "from", "to"]) {
      const value = op[key];
      for (const one of Array.isArray(value) ? value : [value]) {
        if (typeof one === "string" && !ids.includes(one)) ids.push(one);
      }
    }
  }
  return ids;
}

const BOARD_EDGES = new Set(boardFile.board.edges.map((edge) => edge.id));
const BOARD_NODES = new Set(boardFile.board.nodes.map((node) => node.id));

/** Dove due lavagne cominciano a essere diverse, con un po' di testo attorno. */
function differs(gui: string, code: string): string {
  let at = 0;
  while (at < gui.length && at < code.length && gui[at] === code[at]) at++;
  const from = Math.max(0, at - 160);
  return `la GUI scrive\n…${gui.slice(from, at + 240)}…\nla forma in codice\n…${code.slice(from, at + 240)}…`;
}

/** Fa la voce con la GUI e con la sua forma in codice: dice che cosa non torna. */
async function r8Problems(voice: Voice, setup: R8Run): Promise<string[]> {
  const declaredGui = voice.gui.flatMap((gui) => R8_GUI.map((kind) => gui[kind]).filter((value) => value !== undefined));
  if (!declaredGui.includes(setup.via)) return [`\`${voice.id}\`: SETUP usa «${setup.via}», che non è nella sua gui`];
  const answers = setup.answers ?? {};
  const { engine, host } = mountCanvas(BOARD, {
    seed: () => 1n,
    onPickFile: () => answers.pickFile ?? null,
    notes: {
      freeName: async (_folder, name) => name,
      create: async () => answers.newNote ?? "nota.md",
      read: async () => answers.noteText ?? "",
    },
    parts: PARTS,
    ...(answers.pdfPageCount === undefined ? {} : {
      cards: {
        registry: createCardRegistry([]),
        snapshots: new CardCache(),
        watch: () => () => {},
        pdfPages: { count: async () => answers.pdfPageCount!, sizes: async (_path, pages) => pages.map(() => null) },
      },
    }),
    ...setup.options?.(),
  });
  try {
    const targets = setup.select ?? opIds(voice.ops ?? []);
    targets.forEach((id, index) => {
      if (BOARD_EDGES.has(id)) chooseEdge(host, id);
      else if (BOARD_NODES.has(id)) select(host, id, index > 0);
    });
    const context = { engine, host, voice };
    const ops = setup.ops ? setup.ops(context) : voice.ops ?? [];
    if (ops.map((op) => op.op).join() !== (voice.ops ?? []).map((op) => op.op).join()) {
      return [`\`${voice.id}\`: le operazioni di SETUP non sono quelle della voce`];
    }
    await setup.act(context);
    const core = openCoreNow(BOARD);
    if (!core) throw new Error("il nucleo non è pronto");
    let expected: string;
    try {
      expected = core.preview(core.compile(ops, 1n).patches);
    } finally {
      core.close();
    }
    const problems: string[] = [];
    const normalize = setup.normalize ?? ((doc: string) => doc);
    if (normalize(engine.getDoc()) !== normalize(expected)) {
      problems.push(`\`${voice.id}\`: ${differs(normalize(engine.getDoc()), normalize(expected))}`);
    }
    // Esattamente `undos` passi d'annulla: ognuno annulla qualcosa, l'ultimo
    // torna a board.json, e dopo non resta nessun passo.
    const undos = setup.undos ?? 1;
    for (let step = 0; step < undos; step++) {
      if (!engine.undo()) {
        problems.push(`\`${voice.id}\`: la GUI ha fatto ${step} passi d'annulla, non ${undos}`);
        break;
      }
      if (step < undos - 1 && engine.getDoc() === BOARD) {
        problems.push(`\`${voice.id}\`: ${step + 1} annulla tornano già a board.json, non ${undos}`);
      }
    }
    if (engine.getDoc() !== BOARD) problems.push(`\`${voice.id}\`: ${undos} annulla non tornano a board.json`);
    if (engine.undo()) problems.push(`\`${voice.id}\`: la GUI ha fatto più di ${undos} passi d'annulla`);
    return problems;
  } finally {
    engine.destroy();
  }
}

describe("la GUI scrive come la forma in codice (R8)", () => {
  it("ogni voce di R8 ha il suo SETUP, e le voci saltate sono al più cinque", () => {
    const ids = R8_VOICES.map((voice) => voice.id);
    expect(ids.filter((id) => !(id in SETUP))).toEqual([]);
    expect(Object.keys(SETUP).filter((id) => !ids.includes(id))).toEqual([]);
    const skipped = Object.values(SETUP).filter((setup) => "skip" in setup);
    expect(skipped.length).toBeLessThanOrEqual(R8_MAX_SKIPS);
  });

  it("ogni gesto e ogni gesto degli appunti di una voce confrontata ha il suo giro", () => {
    const missing = R8_VOICES.flatMap((voice) => {
      const runs = runsOf(SETUP[voice.id]);
      if (runs.length === 0) return [];
      const vias = new Set(runs.map((one) => one.via));
      return voice.gui
        .flatMap((gui) => [gui.gesture, gui.clipboard])
        .filter((value): value is string => value !== undefined && !vias.has(value))
        .map((value) => `${voice.id}: ${value}`);
    });
    expect(missing).toEqual([]);
  });

  const RUNS = R8_VOICES.flatMap((voice) =>
    runsOf(SETUP[voice.id]).map((one) => [`${voice.id} (${one.via})`, voice, one] as const),
  );
  it.each(RUNS)("%s", async (_name, voice, one) => {
    expect(await r8Problems(voice, one)).toEqual([]);
  });
});
