// @vitest-environment happy-dom
// Ciò che il pannello legge dagli oggetti scelti (i fatti della selezione e
// le sfumature) si legge una volta per volta che serve: lo rifanno la scena,
// la scelta, il livello e il lucchetto delle proporzioni; non lo rifà ciò che
// cambia solo attorno, come una sezione che si apre.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawEditor, type DrawEditorOptions } from "./editor";
import { gradientView } from "./gradients";
import { outlinesOf } from "./outline";
import { LAYER } from "./test-support";

// Le letture si contano: la prima è dei fatti della selezione, la seconda
// delle sfumature. Chi le chiama è sempre lo stesso `syncProperties`.
vi.mock("./outline", async (real) => {
  const actual = await real<typeof import("./outline")>();
  return { ...actual, outlinesOf: vi.fn(actual.outlinesOf) };
});
vi.mock("./gradients", async (real) => {
  const actual = await real<typeof import("./gradients")>();
  return { ...actual, gradientView: vi.fn(actual.gradientView) };
});

const A = "o1a2b3c4d";
const B = "ob2b2b2b2";
const SOURCE = doc(
  `${LAYER}<rect id="${A}" x="60" y="60" width="20" height="20" fill="#0072b2" stroke="#000000" stroke-width="2"/>` +
    `<rect id="${B}" x="10" y="20" width="10" height="10" fill="#000000"/></g>`,
);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  owner.close();
  host.remove();
  vi.mocked(outlinesOf).mockClear();
  vi.mocked(gradientView).mockClear();
});

function mount(options: DrawEditorOptions = {}): void {
  editor = createDrawEditor(host, SceneEngine.open(SOURCE), owner, { level: "standard", ...options });
  host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const properties = (): HTMLElement => host.querySelector<HTMLElement>(".draw-properties")!;
const property = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;
const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;

function key(name: string, init: KeyboardEventInit = {}): void {
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

/// Quante volte il pannello ha letto i fatti della selezione e le sfumature
/// dei suoi riempimenti e contorni, dall'inizio della prova.
const reads = (): { readonly facts: number; readonly gradients: number } => ({
  facts: vi.mocked(outlinesOf).mock.calls.length,
  gradients: vi.mocked(gradientView).mock.calls.length,
});

/// Ciò che `action` fa leggere di nuovo al pannello.
function rereads(action: () => void): { readonly facts: number; readonly gradients: number } {
  const before = reads();
  action();
  const after = reads();
  return { facts: after.facts - before.facts, gradients: after.gradients - before.gradients };
}

describe("la lettura degli oggetti scelti, nel pannello delle proprietà", () => {
  it("la prima volta legge i fatti e le sfumature di riempimento e contorno, una volta sola", () => {
    mount();
    const first = rereads(() => editor.select([A]));
    // Due sfumature: una per il riempimento e una per il contorno.
    expect(first).toEqual({ facts: 1, gradients: 2 });
    expect(propertyInput("width").value).toBe("22");
  });

  it("una sezione che si apre o si chiude non rilegge niente, e il pannello la mostra", () => {
    mount();
    editor.select([A]);
    const toggle = properties().querySelector<HTMLButtonElement>(".draw-properties-section:not([hidden]) .draw-properties-toggle")!;
    const open = toggle.getAttribute("aria-expanded");
    const closed = editor.grid.closed;
    const again = rereads(() => {
      toggle.click();
      toggle.click();
    });
    expect(again).toEqual({ facts: 0, gradients: 0 });
    expect(toggle.getAttribute("aria-expanded")).toBe(open);
    expect(editor.grid.closed).toEqual(closed);
    // Chiusa, la sezione si vede chiusa: il pannello non è rimasto com'era.
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).not.toBe(open);
    expect(editor.grid.closed).not.toEqual(closed);
  });

  it("cambiando la scelta si rilegge, e il pannello mostra quella nuova", () => {
    mount();
    editor.select([A]);
    expect(propertyInput("width").value).toBe("22");
    expect(rereads(() => editor.select([B]))).toEqual({ facts: 1, gradients: 2 });
    expect(propertyInput("width").value).toBe("10");
    expect(rereads(() => editor.select([A, B]))).toEqual({ facts: 1, gradients: 2 });
    // Tornare alla scelta di prima non è la stessa lettura: il pannello ha
    // tenuto solo l'ultima.
    expect(rereads(() => editor.select([A]))).toEqual({ facts: 1, gradients: 2 });
  });

  it("cambiando il livello si rilegge", () => {
    mount();
    editor.select([A]);
    expect(rereads(() => editor.setLevel("expert"))).toEqual({ facts: 1, gradients: 2 });
    // Lo stesso livello non cambia niente.
    expect(rereads(() => editor.setLevel("expert"))).toEqual({ facts: 0, gradients: 0 });
    expect(rereads(() => editor.setLevel("standard"))).toEqual({ facts: 1, gradients: 2 });
  });

  it("cambiando la scena si rilegge, e il pannello mostra la scena nuova", () => {
    mount();
    editor.select([A]);
    expect(propertyInput("x").value).toBe("59");
    expect(rereads(() => key("ArrowRight"))).toEqual({ facts: 1, gradients: 2 });
    expect(propertyInput("x").value).toBe("60");
    // Annullare è un'altra scena: lo stesso conto.
    expect(rereads(() => editor.undo())).toEqual({ facts: 1, gradients: 2 });
    expect(propertyInput("x").value).toBe("59");
    expect(rereads(() => editor.redo())).toEqual({ facts: 1, gradients: 2 });
    expect(propertyInput("x").value).toBe("60");
  });

  it("cambiando l'unità del documento si rilegge, e le misure sono nell'unità nuova", () => {
    mount();
    editor.select([A]);
    Object.defineProperty(surface(), "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(surface(), "clientHeight", { configurable: true, value: 300 });
    key("R", { shiftKey: true });
    expect(property("width").querySelector("label")!.textContent).toBe("Larghezza (px)");
    const reread = rereads(() => {
      surface().dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
      const entries = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitemradio"]')];
      entries.find((entry) => entry.querySelector(".menu-label")!.textContent === "Millimetri")!.click();
    });
    expect(reread).toEqual({ facts: 1, gradients: 2 });
    expect(editor.engine.text).toContain('fub:units="mm"');
    expect(property("width").querySelector("label")!.textContent).toBe("Larghezza (mm)");
    expect(propertyInput("width").value).toBe("5,821");
  });

  it("il lucchetto delle proporzioni si rilegge, e il pannello lo mostra chiuso", () => {
    mount();
    editor.select([A]);
    const lock = (): HTMLButtonElement => property("ratio").querySelector<HTMLButtonElement>("button")!;
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    // Il lucchetto non cambia le sfumature, ma i fatti sì: il lucchetto
    // chiuso è uno di loro.
    const pressed = rereads(() => lock().click());
    expect(pressed.facts).toBe(1);
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    expect(rereads(() => lock().click()).facts).toBe(1);
    expect(lock().getAttribute("aria-pressed")).toBe("false");
  });
});
