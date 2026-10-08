// @vitest-environment happy-dom
// Un passo che cambia scelta, cornici e controlli costa al browser una sola
// rimisura: la misura del foglio si legge una volta, prima di scrivere, e la
// barra della selezione si mette una volta, dov'è alla fine. Con centinaia di
// oggetti scelti ogni lettura dopo una scrittura vuol dire ricalcolare
// l'impaginazione di tutto il disegno.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

const IDS = Array.from({ length: 30 }, (_, at) => `o${String(at).padStart(8, "0")}`);
const SOURCE = doc(`${LAYER}${IDS.map((id, at) => `<rect id="${id}" x="${at * 12}" y="10" width="10" height="10" fill="#0072b2"/>`).join("")}</g>`);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
});

afterEach(() => {
  owner.close();
  host.remove();
});

/// L'editor montato su `source`, con il foglio di 400 × 300; le letture della
/// sua misura si contano, e si conta quante cadono dopo una scrittura al
/// disegno, di quelle che un browser paga con una rimisura.
function mount(source: string, options: DrawEditorOptions = {}) {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { level: "standard", ...options });
  const surface = host.querySelector<HTMLElement>(".draw-surface")!;
  const bar = host.querySelector<HTMLElement>(".draw-arrange")!;
  const written = new MutationObserver(() => {});
  written.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  const barWrites = new MutationObserver(() => {});
  barWrites.observe(bar, { attributes: true });
  let reads = 0;
  let afterWrite = 0;
  const read = (value: number) => (): number => {
    reads++;
    if (written.takeRecords().length > 0) afterWrite++;
    return value;
  };
  Object.defineProperty(surface, "clientWidth", { configurable: true, get: read(400) });
  Object.defineProperty(surface, "clientHeight", { configurable: true, get: read(300) });
  return {
    surface,
    bar,
    /// Ciò che `run` fa leggere della misura del foglio, e scrivere alla barra.
    measured(run: () => void): { readonly reads: number; readonly afterWrite: number; readonly barWrites: number } {
      written.takeRecords();
      barWrites.takeRecords();
      reads = 0;
      afterWrite = 0;
      run();
      return { reads, afterWrite, barWrites: barWrites.takeRecords().filter((record) => record.attributeName === "style").length };
    },
  };
}

function arrow(surface: HTMLElement, name: string, init: KeyboardEventInit = {}): void {
  surface.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

describe("la misura del foglio e la barra, in un passo", () => {
  const SHOWN = { shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: true, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true } as const;

  for (const [name, options] of [
    ["con il foglio com'è", {}],
    ["con griglia, righelli e guide", { grid: SHOWN as unknown as NonNullable<DrawEditorOptions["grid"]> }],
  ] as const) {
    describe(name, () => {
      it("scegliere, spostare e annullare leggono la misura una volta, prima di scrivere", () => {
        const view = mount(SOURCE, options);
        editor.setTool("select");
        const once = { reads: 2, afterWrite: 0 };
        // Larghezza e altezza: due letture, di una misura sola.
        expect(view.measured(() => editor.select(IDS))).toMatchObject(once);
        expect(view.measured(() => arrow(view.surface, "ArrowRight"))).toMatchObject(once);
        expect(view.measured(() => arrow(view.surface, "ArrowDown", { shiftKey: true }))).toMatchObject(once);
        expect(view.measured(() => editor.undo())).toMatchObject(once);
        expect(view.measured(() => editor.redo())).toMatchObject(once);
        expect(view.measured(() => editor.select([]))).toMatchObject(once);
      });

      it("la barra si mette una volta per passo, dove la metterebbe un editor nuovo", () => {
        const view = mount(SOURCE, options);
        editor.setTool("select");
        expect(view.measured(() => editor.select(IDS)).barWrites).toBe(1);
        expect(view.measured(() => arrow(view.surface, "ArrowRight")).barWrites).toBe(1);
        expect(view.measured(() => arrow(view.surface, "ArrowDown", { shiftKey: true })).barWrites).toBe(1);
        expect(view.bar.style.transform).toMatch(/^translate\(/);
        expect(view.measured(() => editor.undo()).barWrites).toBe(1);
        expect(view.measured(() => editor.redo()).barWrites).toBe(1);
        // Nessun passo la lascia dov'era prima del passo.
        const placed = view.bar.style.transform;
        expect(reopened(options).bar.style.transform).toBe(placed);
      });
    });
  }

  it("la barra e il pannello di un oggetto con la cornice ruotata, dopo un passo, sono quelli di un editor nuovo", () => {
    const rotated = doc(
      `${LAYER}<rect id="${IDS[0]}" x="40" y="40" width="20" height="10" fill="#0072b2" transform="rotate(30 50 45)"/>` +
        `<rect id="${IDS[1]}" x="120" y="40" width="20" height="10" fill="#000000"/></g>`,
    );
    const view = mount(rotated);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
    editor.setTool("select");
    editor.select([IDS[0]!]);
    arrow(view.surface, "ArrowRight");
    arrow(view.surface, "ArrowDown", { shiftKey: true });
    expect(editor.engine.text).toContain('transform="matrix(');
    const fields = (): string[] => [...host.querySelectorAll<HTMLInputElement>(".draw-properties-input")].map((input) => `${input.closest<HTMLElement>("[data-field]")?.dataset.field}=${input.value}`);
    const before = { bar: view.bar.style.transform, fields: fields() };
    expect(before.fields.length).toBeGreaterThan(4);
    const again = reopened({}, true);
    expect(again.bar.style.transform).toBe(before.bar);
    expect(fields()).toEqual(before.fields);
  });
});

/// Lo stesso disegno e la stessa scelta in un editor nuovo, con il pannello
/// aperto se `panel`; `editor` è quello nuovo.
function reopened(options: DrawEditorOptions, panel = false): { readonly bar: HTMLElement } {
  const text = editor.engine.text;
  const chosen = [...editor.selection];
  owner.close();
  host.replaceChildren();
  owner = openLifetime();
  const fresh = mount(text, options);
  if (panel) host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  editor.setTool("select");
  editor.select(chosen);
  return { bar: fresh.bar };
}
