// @vitest-environment happy-dom
// I suggerimenti brevi nell'editor: la riga sotto il foglio, mai sopra il
// disegno; quando nasce ognuno, dopo il gesto che gli somiglia; il gesto
// fatto che lo chiude per sempre; la memoria di chi monta l'editor, e la
// casella che li spegne.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

/// Un foglio di 600 × 600 con un quadrato: i tratti e le forme ci stanno
/// senza farlo crescere.
const SOURCE = doc(`<title>Prova</title>${LAYER}<rect id="o1a2b3c4d" x="500" y="500" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`).replace(
  'viewBox="0 0 100 100"',
  'viewBox="0 0 600 600"',
);

/// Lo stesso foglio senza forme.
const EMPTY = SOURCE.replace(/<rect[^>]*\/>/, "");

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;
const FINGER = { pointerId: 9, pointerType: "touch", isPrimary: true } as const;

type Init = PointerEventInit & { readonly timeStamp?: number };

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;
let clock = 100;
/// Ciò che l'editor chiede a chi lo monta.
let seen: string[][];
let switched: boolean[];

function mount(options: DrawEditorOptions = {}, source = SOURCE): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, {
    onChange: (change) => changes.push(change),
    suggestions: { on: true, seen: [] },
    onSuggestedChange: (next) => seen.push([...next]),
    onSuggestionsSwitch: (on) => switched.push(on),
    ...options,
  });
  Object.defineProperty(surface(), "clientWidth", { configurable: true, value: 600 });
  Object.defineProperty(surface(), "clientHeight", { configurable: true, value: 600 });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const row = (): HTMLElement => host.querySelector<HTMLElement>(".draw-suggestion")!;
const text = (): string => row().querySelector(".draw-suggestion-text")!.textContent ?? "";
const said = (): string => (host.querySelector(".draw-suggestions [aria-live]")?.textContent ?? "").trim();
const box = (): HTMLInputElement => row().querySelector<HTMLInputElement>('.draw-suggestion-off input[type="checkbox"]')!;
const closer = (): HTMLButtonElement => row().querySelector<HTMLButtonElement>(".draw-suggestion-close")!;
/// Il suggerimento a schermo, o `null`.
const showing = (): string | null => (row().hidden ? null : (row().dataset.suggestion ?? null));

function pointer(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, ...rest });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

/// I punti di una mano senza tremito lungo gli spigoli `corners`, uno ogni
/// quattro pixel.
function trace(corners: readonly (readonly [number, number])[]): Array<[number, number]> {
  const out: Array<[number, number]> = [[corners[0]![0], corners[0]![1]]];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!;
    const [bx, by] = corners[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let k = 1; k <= steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
  }
  return out;
}
const RECT = trace([[100, 100], [300, 100], [300, 220], [100, 220], [100, 100]]);
const SCRIBBLE = trace([[100, 300], [140, 330], [120, 360], [180, 320], [150, 390]]);

/// Un tratto da `points`, col puntatore `who`; `hold` millisecondi fermo
/// alla fine, prima di alzarsi.
function stroke(points: readonly (readonly [number, number])[], who: PointerEventInit = MOUSE, hold = 0): void {
  const [x0, y0] = points[0]!;
  surface().dispatchEvent(pointer("pointerdown", { ...who, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0, timeStamp: (clock += 8) }));
  for (const [x, y] of points.slice(1)) surface().dispatchEvent(pointer("pointermove", { ...who, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  if (hold > 0) {
    clock += hold;
    vi.advanceTimersByTime(hold);
  }
  const [x1, y1] = points[points.length - 1]!;
  surface().dispatchEvent(pointer("pointerup", { ...who, button: 0, buttons: 0, pressure: 0, clientX: x1, clientY: y1, timeStamp: (clock += 8) }));
}

/// Due dita che scendono e scorrono insieme di `dx`: spostano il foglio.
function pan(dx: number): void {
  const finger = (type: string, id: number, x: number, y: number): void => {
    const up = type === "pointerup";
    surface().dispatchEvent(
      pointer(type, { pointerId: id, pointerType: "touch", isPrimary: false, button: type === "pointermove" ? -1 : 0, buttons: up ? 0 : 1, pressure: up ? 0 : 0.5, clientX: x, clientY: y, timeStamp: (clock += 16) }),
    );
  };
  finger("pointerdown", 11, 200, 200);
  finger("pointerdown", 12, 300, 200);
  for (let step = 1; step <= 4; step++) {
    finger("pointermove", 11, 200 + (dx * step) / 4, 200);
    finger("pointermove", 12, 300 + (dx * step) / 4, 200);
  }
  finger("pointerup", 11, 200 + dx, 200);
  finger("pointerup", 12, 300 + dx, 200);
}

function key(name: string, init: KeyboardEventInit = {}, target: HTMLElement = surface()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
  seen = [];
  switched = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  owner.close();
  host.remove();
  vi.restoreAllMocks();
});

describe("i suggerimenti nell'editor", () => {
  it("stanno in una riga sotto il foglio, nascosta finché non serve, e senza memoria non si mostrano", () => {
    mount({ suggestions: undefined });
    const editorRoot = host.querySelector<HTMLElement>(".draw-editor")!;
    const children = [...editorRoot.children];
    const body = host.querySelector(".draw-body")!;
    const line = host.querySelector(".draw-suggestions")!;
    expect(children.indexOf(line)).toBe(children.indexOf(body) + 1);
    expect(row().hidden).toBe(true);
    stroke(SCRIBBLE, FINGER);
    expect(changes).toHaveLength(1);
    expect(showing()).toBeNull();
    expect(seen).toEqual([]);
    // La memoria arriva: dal prossimo tratto, sì.
    editor.setSuggestions({ on: true, seen: [] });
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBe("two-fingers");
  });

  it("dopo il primo tratto col dito dice delle due dita, lo legge, e lo ricorda come visto", () => {
    mount();
    stroke(SCRIBBLE, MOUSE);
    expect(showing()).toBeNull();
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBe("two-fingers");
    expect(text()).toBe("Con due dita sposti il foglio; allargandole o stringendole lo avvicini o lo allontani.");
    expect(said()).toBe(`Suggerimento: ${text()}`);
    expect(row().getAttribute("role")).toBe("group");
    expect(row().getAttribute("aria-label")).toBe("Suggerimento");
    expect(seen).toEqual([["two-fingers"]]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Il tratto è un passo solo: il suggerimento non ne aggiunge.
    expect(changes).toHaveLength(2);
  });

  it("dal livello Standard, coi gesti, dice anche dei tocchi che annullano e ripetono", () => {
    mount({ level: "standard" });
    stroke(SCRIBBLE, FINGER);
    expect(text()).toBe("Con due dita sposti il foglio; allargandole o stringendole lo avvicini o lo allontani. Un tocco di due dita annulla, uno di tre ripete.");
    editor.setGrid({ ...editor.grid, taps: false });
    expect(text()).toBe("Con due dita sposti il foglio; allargandole o stringendole lo avvicini o lo allontani.");
  });

  it("chi sposta il foglio con due dita non lo vede più; se è a schermo, si chiude", () => {
    mount();
    pan(40);
    expect(seen).toEqual([["two-fingers"]]);
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBeNull();

    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    seen = [];
    mount();
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBe("two-fingers");
    pan(40);
    expect(showing()).toBeNull();
    // Visto e fatto: lo si ricorda una volta sola.
    expect(seen).toEqual([["two-fingers"]]);
  });

  it("quelli già visti, dalla memoria, non tornano", () => {
    mount({ suggestions: { on: true, seen: ["two-fingers", "a-newer-one"] } });
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBeNull();
    expect(seen).toEqual([]);
  });

  it("uno alla volta: un altro che arriva mentre uno è a schermo aspetta la sua occasione dopo", () => {
    mount({ level: "standard" });
    stroke(SCRIBBLE, FINGER);
    expect(showing()).toBe("two-fingers");
    // Un rettangolo a mano non tenuto: la forma pulita aspetta.
    stroke(RECT, MOUSE);
    expect(showing()).toBe("two-fingers");
    closer().click();
    expect(showing()).toBeNull();
    stroke(RECT, MOUSE);
    expect(showing()).toBe("hold-shape");
    expect(text()).toBe("Alla fine di un tratto resta fermo mezzo secondo prima di lasciare: il tratto diventa una forma pulita.");
    expect(seen).toEqual([["two-fingers"], ["two-fingers", "hold-shape"]]);
  });

  it("il tratto tenuto fermo dice della forma pulita soltanto dove si riconosce, e dopo un tratto che somiglia a una forma", () => {
    mount();
    // All'Essenziale le forme dal tratto non ci sono.
    stroke(RECT, MOUSE);
    expect(showing()).toBeNull();
    editor.setLevel("standard");
    stroke(SCRIBBLE, MOUSE);
    expect(showing()).toBeNull();
    stroke(RECT, MOUSE);
    expect(showing()).toBe("hold-shape");
  });

  it("chi tiene fermo un tratto e ne fa una forma non lo vede più", () => {
    mount({ level: "standard" }, EMPTY);
    stroke(RECT, MOUSE, 500);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="100" y="100" width="200" height="120"/);
    expect(seen[0]).toEqual(["hold-shape"]);
    stroke(RECT, MOUSE);
    expect(showing()).toBeNull();
  });

  it("dopo la seconda forma senza testo dice come si scrive dentro una forma; scritta un'etichetta, non torna", () => {
    mount({ level: "standard", suggestions: { on: true, seen: ["two-fingers", "hold-shape"] } }, EMPTY);
    editor.setTool("rect");
    stroke([[100, 100], [200, 160]]);
    expect(showing()).toBeNull();
    stroke([[300, 100], [400, 160]]);
    expect(showing()).toBe("label-shape");
    expect(text()).toBe("Per scrivere dentro una forma, fai doppio clic o due tocchi su di lei, oppure sceglila e premi F2.");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    seen = [];
    mount({ level: "standard", suggestions: { on: true, seen: ["two-fingers", "hold-shape"] } }, EMPTY);
    editor.setTool("rect");
    stroke([[100, 100], [200, 160]]);
    editor.setTool("select");
    editor.select([/<rect id="([^"]+)"/.exec(editor.engine.text)![1]!]);
    surface().focus();
    key("F2");
    const input = host.querySelector<HTMLElement>(".draw-text-input")!;
    input.textContent = "Inizio";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    key("Escape", {}, input);
    expect(editor.engine.text).toContain("fub:inside=");
    expect(seen).toEqual([["two-fingers", "hold-shape", "label-shape"]]);
    editor.setTool("rect");
    stroke([[300, 100], [400, 160]]);
    stroke([[100, 300], [200, 360]]);
    expect(showing()).toBeNull();
  });

  it("senza lo strumento Testo non dice di scrivere nelle forme", () => {
    mount({ suggestions: { on: true, seen: ["two-fingers", "hold-shape"] } });
    editor.setTool("rect");
    stroke([[100, 100], [200, 160]]);
    stroke([[300, 100], [400, 160]]);
    expect(showing()).toBeNull();
  });

  it("la croce ed Esc lo chiudono e ridanno il fuoco al foglio; non se ne va da solo", () => {
    mount();
    stroke(SCRIBBLE, FINGER);
    vi.advanceTimersByTime(60_000);
    expect(showing()).toBe("two-fingers");
    expect(closer().getAttribute("aria-label")).toBe("Chiudi il suggerimento");
    closer().focus();
    closer().click();
    expect(showing()).toBeNull();
    expect(document.activeElement).toBe(surface());

    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    mount();
    stroke(SCRIBBLE, FINGER);
    box().focus();
    key("Escape", {}, box());
    expect(showing()).toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it("la casella li spegne tutti e lo scrive; tolto il segno, tornano", () => {
    mount({ level: "standard" });
    stroke(SCRIBBLE, FINGER);
    expect(box().checked).toBe(false);
    expect(box().closest("label")!.textContent).toBe("Non mostrare più suggerimenti");
    box().click();
    expect(switched).toEqual([false]);
    // Quello a schermo resta, così si legge fino in fondo.
    expect(showing()).toBe("two-fingers");
    closer().click();
    stroke(RECT, MOUSE);
    expect(showing()).toBeNull();
    // L'impostazione riletta dice lo stesso; poi la si riaccende altrove.
    editor.setSuggestions({ on: false, seen: ["two-fingers"] });
    stroke(RECT, MOUSE);
    expect(showing()).toBeNull();
    editor.setSuggestions({ on: true, seen: ["two-fingers"] });
    stroke(RECT, MOUSE);
    expect(showing()).toBe("hold-shape");
  });

});
