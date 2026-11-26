// Gli aiuti condivisi dalle prove dell'editor del disegno (`editor*.test.ts`):
// montare l'editor, premere, trascinare, leggere le operazioni scritte.
import { afterEach, beforeEach, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

export const SOURCE = doc(
  `<title>Prova</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);

export const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

export type Init = PointerEventInit & { readonly timeStamp?: number };

export function pointer(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, ...rest });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

export const banco: {
  host: HTMLElement;
  owner: Lifetime;
  changes: DrawChange[];
  editor: DrawEditor;
  clock: number;
} = {
  host: undefined as unknown as HTMLElement,
  owner: undefined as unknown as Lifetime,
  changes: undefined as unknown as DrawChange[],
  editor: undefined as unknown as DrawEditor,
  clock: 100,
};

export function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  banco.editor = createDrawEditor(banco.host, SceneEngine.open(source), banco.owner, { onChange: (change) => banco.changes.push(change), ...options });
  return banco.editor;
}

export const surface = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-surface")!;

/// Ciò che l'editor ha detto per ultimo, dalla sua regione viva: l'albero ha
/// la sua riga di stato, e l'elenco delle tavole la sua.
export const spoken = (): string => (banco.host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

/// Un trascinamento col mouse, sullo schermo: la camera parte dall'identità,
/// quindi i punti sono anche quelli della scena.
export function drag(points: readonly (readonly [number, number])[], init: Init = {}): void {
  const target = surface();
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0, timeStamp: (banco.clock += 8), ...init }));
  for (const [x, y] of points.slice(1)) {
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (banco.clock += 8), ...init }));
  }
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x1, clientY: y1, timeStamp: (banco.clock += 8), ...init }));
}

export function key(key: string, init: KeyboardEventInit = {}, target: HTMLElement = surface()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Le caselle della colonna degli strumenti.
export const railSlots = (): HTMLButtonElement[] => [...banco.host.querySelectorAll<HTMLButtonElement>(".draw-rail .kit-rail-slot")];

/// Gli strumenti di una casella, coi nomi e i tasti, come li dice la sua
/// tendina; una casella sola dice il suo.
export function slotTools(slot: HTMLButtonElement): { name: string; keys: string }[] {
  if (!slot.hasAttribute("aria-haspopup")) return [{ name: slot.getAttribute("aria-label")!, keys: slot.getAttribute("aria-keyshortcuts") ?? "" }];
  slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.querySelector<HTMLElement>(".kit-rail-flyout")!;
  const tools = [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")].map((row) => ({
    name: row.querySelector(".kit-rail-flyout-label")!.textContent!,
    keys: row.querySelector(".kit-rail-flyout-keys")?.textContent ?? "",
  }));
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return tools;
}

/// I nomi degli strumenti della colonna, tendine comprese, nell'ordine.
export const railNames = (): string[] => railSlots().flatMap((slot) => slotTools(slot).map((tool) => tool.name));

/// Lo strumento `name` nella colonna: il nome col tasto e se è scelto;
/// `hidden` se il livello non lo offre.
export function railTool(name: string): { hidden: boolean; title: string; checked: boolean } {
  for (const slot of railSlots()) {
    const tool = slotTools(slot).find((each) => each.name === name);
    if (tool === undefined) continue;
    const shown = slot.getAttribute("aria-label") === name;
    return { hidden: false, title: `${name} (${tool.keys})`, checked: shown && slot.getAttribute("aria-pressed") === "true" };
  }
  return { hidden: true, title: "", checked: false };
}

/// Il pozzo del colore nella barra.
export function well(): HTMLButtonElement {
  return banco.host.querySelector<HTMLButtonElement>(".draw-toolbar .kit-color-well-button")!;
}

/// Dà al foglio una misura, che happy-dom non calcola.
export function size(width: number, height: number): void {
  Object.defineProperty(surface(), "clientWidth", { configurable: true, value: width });
  Object.defineProperty(surface(), "clientHeight", { configurable: true, value: height });
}

/// La finestra aperta per ultima.
export const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};

export const field = (name: string): HTMLInputElement | HTMLTextAreaElement => dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;

/// Conferma la finestra e aspetta che l'editor riceva la risposta.
export async function submit(): Promise<void> {
  dialog().querySelector("form")!.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/// Il pannello delle proprietà, un suo campo e ciò che vi si scrive.
export const properties = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-properties")!;

export const property = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;

export const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;

/// Scrive `text` nel campo, come chi lo digita.
export function typeIn(target: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Scrive `text` nel campo e lo fa partire con Invio.
export function enter(target: HTMLInputElement, text: string): void {
  typeIn(target, text);
  key("Enter", {}, target);
}

beforeEach(() => {
  banco.host = document.createElement("div");
  document.body.append(banco.host);
  banco.owner = openLifetime();
  banco.changes = [];
});

afterEach(() => {
  banco.owner.close();
  banco.host.remove();
  vi.unstubAllGlobals();
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
  vi.restoreAllMocks();
});
