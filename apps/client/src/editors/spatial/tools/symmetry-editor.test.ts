// @vitest-environment happy-dom
// La penna in simmetria nell'editor, dal livello Standard: la sezione
// «Simmetria» del pannello con la penna e l'evidenziatore, i tratti che
// scrivono le loro copie in un passo d'annulla, le forme dal tratto con le
// loro, e il centro che si prende, si tira e si aggancia.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

/// Una pagina vuota di 400 × 400: il centro della simmetria parte da
/// (200, 200).
const PAGE = doc(`<title>Prova</title>${LAYER}</g>`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

/// Due tavole di 400 × 200, una accanto all'altra.
const BOARDS = doc(
  '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
    '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
    '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
    '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
    `${LAYER}</g>`,
);

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;
let clock = 100;

function mount(source = PAGE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), level: "standard", ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
const menu = (): HTMLButtonElement[] => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')];
};
const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
/// Le voci del menu aperto: il nome, il ruolo e se è segnata.
const entries = (): Array<[string, string | null, string | null]> => menu().map((entry) => [labelOf(entry), entry.getAttribute("role"), entry.getAttribute("aria-checked")]);

type Init = PointerEventInit;

/// Un evento del mouse in `x`, `y`, col suo tempo: l'inchiostro lo legge.
function pointer(type: string, x: number, y: number, init: Init = {}): PointerEvent {
  const event = new PointerEvent(type, {
    ...MOUSE,
    bubbles: true,
    cancelable: true,
    composed: true,
    isPrimary: true,
    button: type === "pointermove" ? -1 : 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : 0.5,
    clientX: x,
    clientY: y,
    ...init,
  });
  Object.defineProperty(event, "timeStamp", { value: (clock += 8) });
  return event;
}

/// Un trascinamento col mouse: la camera parte dall'identità, quindi i
/// punti sono anche quelli della scena.
function drag(points: readonly (readonly [number, number])[], init: Init = {}): void {
  const target = surface();
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", x0, y0, init));
  for (const [x, y] of points.slice(1)) target.dispatchEvent(pointer("pointermove", x, y, init));
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", x1, y1, init));
}

function key(name: string, init: KeyboardEventInit = {}): void {
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

/// Un tratto a mano, in basso a sinistra del centro della pagina.
const STROKE: ReadonlyArray<readonly [number, number]> = [
  [100, 100],
  [110, 106],
  [122, 114],
  [136, 126],
  [150, 140],
];

/// I tratti scritti da `tool`, nell'ordine del file.
const strokes = (tool = "pen"): string[] => [...editor.engine.text.matchAll(new RegExp(`<path id="(o[a-z0-9]{8})" fub:tool="${tool}"`, "g"))].map((found) => found[1]!);

/// Il riquadro del contorno del tratto `id`, arrotondato: i numeri del suo
/// `d` sono tutti coppie di coordinate.
function box(id: string): [number, number, number, number] {
  const d = new RegExp(`<path id="${id}"[^>]* d="([^"]+)"`).exec(editor.engine.text)![1]!;
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((found) => Number(found[0]));
  const xs = numbers.filter((_, k) => k % 2 === 0);
  const ys = numbers.filter((_, k) => k % 2 === 1);
  return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
}

/// Il pannello delle proprietà, un suo campo e ciò che vi si scrive.
const properties = (): HTMLElement => host.querySelector<HTMLElement>(".draw-properties")!;
const property = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;
const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;
const face = (id: string): HTMLButtonElement => property(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
const flip = (id: string): void => property(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
const section = (): HTMLElement | null => host.querySelector<HTMLElement>('.draw-properties-section[data-section="symmetry"]');
/// Vero se il pannello è aperto e mostra «Simmetria».
const sectionShown = (): boolean => {
  const panel = host.querySelector<HTMLElement>(".draw-properties");
  return panel !== null && !panel.hidden && panel.closest("[hidden]") === null && section() !== null && !section()!.hidden;
};
/// I campi di «Simmetria» che si vedono, col valore: il tipo, poi i numeri
/// e lo specchio col loro nome.
const symmetryRows = (): string[] =>
  [...properties().querySelectorAll<HTMLElement>('.draw-properties-field[data-field^="symmetry"]')]
    .filter((field) => !field.hidden)
    .map((field) => {
      const name = field.querySelector("label")?.textContent ?? "";
      const box = field.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (box !== null) return `${name}: ${box.checked ? "sì" : "no"}`;
      const input = field.querySelector<HTMLInputElement>(".draw-properties-input");
      return input === null ? field.querySelector(".draw-properties-menu")!.textContent! : `${name}: ${input.value}`;
    });

/// Apre il pannello delle proprietà dalla barra degli strumenti.
const openPanel = (): void => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();

/// Sceglie il tipo `label` dal menu di «Simmetria», col pannello aperto.
function choose(label: string): void {
  if (!sectionShown()) openPanel();
  face("symmetry").click();
  item(label).click();
}

/// Scrive `text` nel campo e lo fa partire con Invio.
function enter(target: HTMLInputElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
  clock += 1000;
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  owner.close();
  host.remove();
});

describe("la sezione «Simmetria» del pannello", () => {
  it("c'è con la penna e l'evidenziatore senza niente di scelto, dopo «Forma», e all'Essenziale no", () => {
    mount();
    openPanel();
    expect(sectionShown()).toBe(true);
    expect(section()!.querySelector(".draw-properties-toggle-text")!.textContent).toBe("Simmetria");
    const order = [...properties().querySelectorAll<HTMLElement>(".draw-properties-section")].map((each) => each.dataset.section);
    expect(order.indexOf("symmetry")).toBe(order.indexOf("shape") + 1);
    // Spenta, si vede solo il tipo.
    expect(symmetryRows()).toEqual(["Nessuna"]);
    face("symmetry").click();
    expect(entries()).toEqual([
      ["Nessuna", "menuitemradio", "true"],
      ["Asse verticale", "menuitemradio", "false"],
      ["Asse orizzontale", "menuitemradio", "false"],
      ["Radiale", "menuitemradio", "false"],
    ]);
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
    closeContextMenu();
    editor.setTool("highlighter");
    expect(sectionShown()).toBe(true);
    editor.setTool("rect");
    expect(sectionShown()).toBe(false);
    editor.setTool("pen");
    expect(sectionShown()).toBe(true);
    editor.setLevel("essential");
    expect(sectionShown()).toBe(false);
  });

  it("una radiale mostra gli spicchi, lo specchio e il centro, e i campi la cambiano senza toccare il disegno", () => {
    mount();
    choose("Radiale");
    expect(symmetryRows()).toEqual(["Radiale", "Spicchi: 8", "Specchiata: sì", "Centro X (px): 200", "Centro Y (px): 200"]);
    enter(propertyInput("symmetrySlices"), "5");
    flip("symmetryMirror");
    enter(propertyInput("symmetryX"), "150");
    expect(symmetryRows()).toEqual(["Radiale", "Spicchi: 5", "Specchiata: no", "Centro X (px): 150", "Centro Y (px): 200"]);
    // Gli spicchi stanno fra 2 e 12.
    enter(propertyInput("symmetrySlices"), "40");
    expect(symmetryRows()[1]).toBe("Spicchi: 12");
    enter(propertyInput("symmetrySlices"), "5");
    // Quando si torna alla penna, si sente come disegna.
    editor.setTool("rect");
    editor.setTool("pen");
    expect(spoken()).toBe("Strumento: Penna. Simmetria radiale a 5 spicchi.");
    flip("symmetryMirror");
    editor.setTool("highlighter");
    expect(spoken()).toBe("Strumento: Evidenziatore. Simmetria radiale a 5 spicchi specchiati.");
    // «Rimetti al centro» c'è solo con la simmetria accesa.
    face("symmetry").click();
    expect(entries()).toEqual([
      ["Nessuna", "menuitemradio", "false"],
      ["Asse verticale", "menuitemradio", "false"],
      ["Asse orizzontale", "menuitemradio", "false"],
      ["Radiale", "menuitemradio", "true"],
      ["Rimetti al centro", "menuitem", null],
    ]);
    item("Rimetti al centro").click();
    expect(spoken()).toBe("Simmetria rimessa al centro: x 200, y 200.");
    expect(symmetryRows().slice(3)).toEqual(["Centro X (px): 200", "Centro Y (px): 200"]);
    choose("Asse verticale");
    expect(symmetryRows()).toEqual(["Asse verticale", "Centro X (px): 200", "Centro Y (px): 200"]);
    choose("Nessuna");
    expect(symmetryRows()).toEqual(["Nessuna"]);
    editor.setTool("pen");
    expect(spoken()).toBe("Strumento: Penna.");
    // La simmetria è dello strumento: il disegno non è cambiato.
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(PAGE);
  });
});

describe("i tratti in simmetria", () => {
  it("con l'asse verticale un tratto scrive anche la sua immagine, in un passo d'annulla", () => {
    mount();
    choose("Asse verticale");
    drag(STROKE);
    const [source, copy] = strokes();
    expect(strokes()).toHaveLength(2);
    const [x0, y0, x1, y1] = box(source!);
    expect(box(copy!)).toEqual([400 - x1, y0, 400 - x0, y1]);
    expect(x1).toBeLessThan(200);
    expect(spoken()).toBe("Tratto aggiunto. Con 1 copia in simmetria. Il disegno ha 2 oggetti.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(spoken()).toBe("Annullato: Tratto.");
    expect(editor.engine.text).toBe(PAGE);
  });

  it("una radiale specchiata a otto spicchi scrive sedici tratti, una a quattro senza specchio quattro", () => {
    mount();
    choose("Radiale");
    drag(STROKE);
    expect(strokes()).toHaveLength(16);
    expect(spoken()).toBe("Tratto aggiunto. Con 15 copie in simmetria. Il disegno ha 16 oggetti.");
    editor.undo();
    expect(editor.engine.text).toBe(PAGE);
    flip("symmetryMirror");
    enter(propertyInput("symmetrySlices"), "4");
    drag(STROKE);
    const ids = strokes();
    expect(ids).toHaveLength(4);
    // Un quarto di giro alla volta, in senso orario sullo schermo: il
    // tratto in alto a sinistra va in alto a destra, in basso a destra, in
    // basso a sinistra.
    const [x0, y0, x1, y1] = box(ids[0]!);
    expect(ids.slice(1).map(box)).toEqual([
      [400 - y1, x0, 400 - y0, x1],
      [400 - x1, 400 - y1, 400 - x0, 400 - y0],
      [y0, 400 - x1, y1, 400 - x0],
    ]);
  });

  it("l'evidenziatore scrive le sue copie, e con l'asse orizzontale si specchia dall'alto in basso", () => {
    mount();
    editor.setTool("highlighter");
    choose("Asse orizzontale");
    drag(STROKE);
    const [source, copy] = strokes("highlighter");
    const [x0, y0, x1, y1] = box(source!);
    expect(box(copy!)).toEqual([x0, 400 - y1, x1, 400 - y0]);
    expect(spoken()).toBe("Evidenziatura aggiunta. Con 1 copia in simmetria. Il disegno ha 2 oggetti.");
  });

  it("senza la parte «Simmetria» la penna scrive un tratto solo, e la simmetria scelta torna con lei", () => {
    mount();
    choose("Asse verticale");
    editor.setLevel("essential");
    drag(STROKE);
    expect(strokes()).toHaveLength(1);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 1 oggetto.");
    editor.setLevel("standard");
    drag(STROKE.map(([x, y]) => [x, y + 150] as const));
    expect(strokes()).toHaveLength(3);
  });

  describe("le forme dal tratto", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    /// I punti di una mano senza tremito lungo gli spigoli `corners`, uno
    /// ogni quattro pixel.
    const trace = (corners: readonly (readonly [number, number])[]): Array<[number, number]> => {
      const out: Array<[number, number]> = [[corners[0]![0], corners[0]![1]]];
      for (let i = 1; i < corners.length; i++) {
        const [ax, ay] = corners[i - 1]!;
        const [bx, by] = corners[i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
        for (let k = 1; k <= steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
      }
      return out;
    };

    it("un tratto tenuto fermo diventa una forma, e anche le sue copie, in un passo", () => {
      mount();
      choose("Asse verticale");
      const points = trace([[60, 100], [160, 100], [160, 180], [60, 180], [60, 100]]);
      const target = surface();
      target.dispatchEvent(pointer("pointerdown", points[0]![0], points[0]![1]));
      for (const [x, y] of points.slice(1)) target.dispatchEvent(pointer("pointermove", x, y));
      clock += 500;
      vi.advanceTimersByTime(500);
      expect(spoken()).toBe("Rettangolo.");
      target.dispatchEvent(pointer("pointerup", 60, 100));
      const rects = [...editor.engine.text.matchAll(/<rect id="o[a-z0-9]{8}" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((found) => found.slice(1).join(" "));
      expect(rects).toEqual(["60 100 100 80", "240 100 100 80"]);
      expect(editor.engine.text).not.toContain("fub:ink");
      expect(spoken()).toBe("Rettangolo dal tratto. Con 1 copia in simmetria. Il disegno ha 2 oggetti.");
      // Annulla riporta l'inchiostro, con le sue copie, poi niente.
      editor.undo();
      expect(strokes()).toHaveLength(2);
      editor.undo();
      expect(editor.engine.text).toBe(PAGE);
    });
  });
});

describe("il centro della simmetria", () => {
  it("si prende e si tira col puntatore, senza disegnare, e vicino al centro della pagina si aggancia", () => {
    mount();
    choose("Asse verticale");
    surface().dispatchEvent(pointer("pointermove", 203, 198, { buttons: 0 }));
    expect(surface().dataset.grip).toBe("move");
    drag([[201, 199], [230, 215], [261, 229]]);
    expect(strokes()).toEqual([]);
    expect(spoken()).toBe("Centro della simmetria spostato: x 260, y 230.");
    expect(symmetryRows().slice(1)).toEqual(["Centro X (px): 260", "Centro Y (px): 230"]);
    expect(surface().dataset.grip).toBeUndefined();
    drag([[260, 230], [230, 215], [203, 198]]);
    expect(spoken()).toBe("Centro della simmetria al centro della pagina: x 200, y 200.");
    // Con Ctrl non si aggancia.
    drag([[200, 200], [210, 205], [203, 198]], { ctrlKey: true });
    expect(spoken()).toBe("Centro della simmetria spostato: x 203, y 198.");
    // Il tratto dopo si specchia sull'asse nuovo.
    drag(STROKE);
    const [source, copy] = strokes();
    const [x0, y0, x1, y1] = box(source!);
    expect(box(copy!)).toEqual([406 - x1, y0, 406 - x0, y1]);
    expect(changes).toHaveLength(1);
  });

  it("Esc mentre lo si tira lo rimette dov'era, e un tocco fermo non lo sposta e non disegna", () => {
    mount();
    choose("Radiale");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", 200, 200));
    target.dispatchEvent(pointer("pointermove", 240, 230));
    expect(symmetryRows().slice(3)).toEqual(["Centro X (px): 240", "Centro Y (px): 230"]);
    key("Escape");
    target.dispatchEvent(pointer("pointerup", 240, 230));
    expect(symmetryRows().slice(3)).toEqual(["Centro X (px): 200", "Centro Y (px): 200"]);
    drag([[200, 200], [201, 200]]);
    expect(symmetryRows().slice(3)).toEqual(["Centro X (px): 200", "Centro Y (px): 200"]);
    expect(changes).toEqual([]);
    // Con la simmetria spenta il centro non si prende: lì si disegna.
    choose("Nessuna");
    drag([[200, 200], [230, 215], [260, 230]]);
    expect(strokes()).toHaveLength(1);
  });

  it("con le tavole parte dal centro della prima e si aggancia al centro di ognuna; un altro disegno lo rimette a posto", () => {
    mount(BOARDS, { level: "expert" });
    choose("Asse verticale");
    expect(symmetryRows().slice(1)).toEqual(["Centro X (px): 200", "Centro Y (px): 100"]);
    drag([[200, 100], [400, 100], [677, 103]]);
    expect(spoken()).toBe("Centro della simmetria al centro della tavola: x 680, y 100.");
    editor.load(SceneEngine.open(PAGE));
    expect(symmetryRows().slice(1)).toEqual(["Centro X (px): 200", "Centro Y (px): 200"]);
  });
});
