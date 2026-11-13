// @vitest-environment happy-dom
// La parità della GUI (R7): la tela mostra gli id che l'inventario dichiara
// (menu, barra, campi, appunti), ogni voce trova il suo id, i gesti e i tasti
// sono quelli delle costanti `GESTURES` e `KEYS`, e ogni tasto delle voci
// cambia il file se e solo se la voce dice `writes: "file"`. Le regole R1–R6
// stanno in `crates/fub-canvas-core/tests/parity.rs`; come si aggiunge un
// gesto, in `docs/development/canvas-parity.md`.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenu, SurfaceMenuEntry } from "../core/editor-menu";
import type { CanvasEngine } from "./engine";
import { mountCanvas } from "./test-mount";
import { canvasCoreReady } from "./wasm/core";
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
];

/** I tasti dell'annulla: si premono dopo una mossa, perché annullano qualcosa. */
const AFTER_A_MOVE = new Set(["Mod+Z", "Mod+Shift+Z", "Mod+Y"]);
/** I tasti del ripeti rifanno ciò che l'annulla ha tolto: prima si annulla. */
const AFTER_AN_UNDO = new Set(["Mod+Shift+Z", "Mod+Y"]);

/** Uno stato della tela: la selezione che R7 monta, e il punto dove si apre il menu. */
interface State {
  readonly name: string;
  readonly select: (host: HTMLElement) => void;
  /** Una scheda, un arco (`edge:<id>`), o `null` per il vuoto. */
  readonly at: string | null;
}

const STATES: readonly State[] = [
  { name: "vuoto", select: () => {}, at: null },
  { name: "t1", select: (host) => select(host, "t1"), at: "t1" },
  { name: "f1", select: (host) => select(host, "f1"), at: "f1" },
  { name: "l1", select: (host) => select(host, "l1"), at: "l1" },
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
    const { engine, host } = mountCanvas(BOARD, { onPickFile: () => null });
    state.select(host);
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
