// @vitest-environment happy-dom
// La parità della GUI (R7): la tela mostra gli id che l'inventario dichiara
// (menu, barra, campi, appunti), ogni voce trova il suo id, i gesti e i tasti
// sono quelli delle costanti `GESTURES` e `KEYS`, e ogni tasto delle voci
// cambia il file se e solo se la voce dice `writes: "file"`. R8 (T23): ogni
// voce in codice con un menu, un bottone, un campo o un tasto scrive con la
// GUI la stessa lavagna della sua forma in codice. Le regole R1–R6
// stanno in `crates/fub-canvas-core/tests/parity.rs`; come si aggiunge un
// gesto, in `docs/development/canvas-parity.md`.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenu, SurfaceMenuEntry } from "../core/editor-menu";
import { CardCache } from "./card-cache";
import { createCardRegistry } from "./cards";
import type { CanvasEngine, CanvasNotesPort } from "./engine";
import type { PartsPickerPort } from "./parts-picker";
import { mountCanvas } from "./test-mount";
import { canvasCoreReady, openCoreNow, type CanvasIntentOp } from "./wasm/core";
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

/** I tipi di `gui` che R8 prova: gesti e appunti sono di T24. */
const R8_GUI: readonly GuiKind[] = ["menu", "toolbar", "field", "key"];

/**
 * Le voci di R8: in codice (`code` o `composed`), che scrivono il file, di una
 * fonte in `merged`, con almeno un menu, un bottone, un campo o un tasto.
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
  /** I passi d'annulla dell'azione: di serie uno. */
  readonly undos?: number;
}

type R8Setup = R8Run | { readonly skip: string };

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

/**
 * Come R8 fa ogni voce. Una voce nuova in codice con una GUI va qui: senza,
 * R8 fallisce. `skip` vale solo per una voce che non si può confrontare, e
 * dice perché; non più di `R8_MAX_SKIPS`.
 */
const SETUP: Readonly<Record<string, R8Setup>> = {
  "main.card.add_text": {
    ...runCommand("canvas.add.text"),
    ops: ({ host }) => [{ op: "add_card", text: "", ...bornAtCenter(host, 320, 160) }],
    why: "la scheda nasce vuota al centro della vista, con la misura di sempre della GUI; il testo si scrive dopo",
  },
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
  "main.card.edit": {
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
  "main.card.move": pressKey("ArrowRight"),
  "main.color.preset": runCommand("canvas.color.1"),
  "main.color.none": {
    via: "canvas.color.none",
    // t1 non ha colore nella lavagna di prova: prima lo prende, poi lo perde.
    act: ({ engine }) => {
      run(engine, "canvas.color.3");
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
  "main.edge.connect": {
    ...runCommand("canvas.connect"),
    ops: () => [{ op: "connect", from: "t2", to: "f1", sides: { from: "left", to: "top" } }],
    why: "Collega della GUI scrive i lati più vicini (`nearestSides`), qui sinistra e sopra; `sides: auto` del nucleo confronta i centri e darebbe sotto e sopra",
  },
  "main.edge.reconnect": { via: "edge-toNode", act: ({ host }) => setField(host, "edge-toNode", "f1") },
  "main.edge.reverse": {
    skip: "la GUI tiene le punte sulla loro scheda (#353), `reverse` le tiene sul ruolo e sposta la freccia: le regole non coincidono (rapporto di T23)",
  },
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
    skip: "il bottone sceglie l'evidenziatore; il tratto lo scrive il gesto della penna, che è di T24",
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
    skip: "la voce raccoglie quattro gesti (pagine, zona, sezioni, ritaglio): «Parti…» fa solo le sezioni sul posto, e il ritaglio è un gesto, che porta T24 insieme alla scrittura del selettore con `excerpt`",
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
  });
  try {
    const targets = setup.select ?? opIds(voice.ops ?? []);
    targets.forEach((id, index) => {
      if (BOARD_EDGES.has(id)) chooseEdge(host, id);
      else if (BOARD_NODES.has(id)) select(host, id, index > 0);
    });
    const context = { engine, host };
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
    if (engine.getDoc() !== expected) {
      problems.push(`\`${voice.id}\`: la GUI scrive\n${engine.getDoc()}\nla forma in codice\n${expected}`);
    }
    for (let step = 0; step < (setup.undos ?? 1); step++) engine.undo();
    if (engine.getDoc() !== BOARD) problems.push(`\`${voice.id}\`: ${setup.undos ?? 1} annulla non tornano a board.json`);
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

  it.each(R8_VOICES.map((voice) => [voice.id, voice] as const))("%s", async (_id, voice) => {
    const setup = SETUP[voice.id];
    if (!setup || "skip" in setup) return;
    expect(await r8Problems(voice, setup)).toEqual([]);
  });
});
