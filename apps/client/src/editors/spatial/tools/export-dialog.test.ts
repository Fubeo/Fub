// @vitest-environment happy-dom
// La finestra «Esporta»: le scelte, l'anteprima con la sua misura, la
// richiesta che torna.

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import type { FontSheets } from "../picture";
import { exportDialog, labelOf, measureText, type ExportDialogOptions } from "./export-dialog";
import type { ExportScene, ExportState } from "./export-plan";

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';

/// Due tavole affiancate, 400 × 300 ciascuna.
const BOARDS_TEXT = `${HEAD} viewBox="0 0 880 300" width="880" height="300">
  <title>Prova</title>
  <rect id="p1" fub:role="paper" fub:board="b1" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <rect id="p2" fub:role="paper" fub:board="b2" x="480" y="0" width="400" height="300" fill="#fff8e7"/>
  <view id="b1" fub:role="board" viewBox="0 0 400 300">
    <title>Copertina</title>
  </view>
  <view id="b2" fub:role="board" viewBox="480 0 400 300">
    <title>Evaporazione</title>
  </view>
  <g id="l1" fub:layer="Livello 1">
    <rect id="o1" x="10" y="10" width="100" height="50" fill="#0072b2"/>
    <ellipse id="o2" cx="300" cy="200" rx="40" ry="30" fill="#d55e00"/>
  </g>
</svg>
`;

const BOARDS: ExportScene = {
  selection: null,
  boards: [
    { id: "b1", name: "Copertina" },
    { id: "b2", name: "Evaporazione" },
  ],
};

/// Un foglio di 800 × 600 senza tavole, con l'ellisse `o2` scelta.
const PAGE_TEXT = `${HEAD} viewBox="0 0 800 600" width="800" height="600">
  <title>Prova</title>
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="800" height="600" fill="#ffffff"/>
  <g id="l1" fub:layer="Livello 1">
    <rect id="o1" x="10" y="10" width="100" height="50" fill="#0072b2"/>
    <ellipse id="o2" cx="300" cy="200" rx="40" ry="30" fill="#d55e00"/>
  </g>
</svg>
`;

const SELECTED: ExportScene = { selection: { count: 1, ids: ["o2"], box: [258, 168, 84, 64] }, boards: [] };

const FONTS: FontSheets = { now: () => "", load: async () => "" };

const open = (patch: Partial<ExportDialogOptions> = {}) =>
  exportDialog({ name: "Ciclo dell'acqua", text: BOARDS_TEXT, scene: BOARDS, memory: null, fonts: FONTS, ...patch });

const dialog = (): HTMLElement => {
  const all = document.querySelectorAll<HTMLElement>(".modale");
  return all[all.length - 1]!;
};
const option = (label: string): HTMLInputElement => {
  const found = [...dialog().querySelectorAll<HTMLLabelElement>("label.draw-export-option")].find((each) => each.textContent === label);
  if (found === undefined) throw new Error(`nessuna scelta «${label}»`);
  return found.querySelector("input")!;
};
const choose = (label: string): void => {
  const input = option(label);
  input.checked = input.type === "checkbox" ? !input.checked : true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const button = (label: string): HTMLButtonElement =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label || each.getAttribute("aria-label") === label)!;
const measure = (): string => dialog().querySelector(".draw-export-measure")!.textContent ?? "";
const page = (): string => dialog().querySelector(".draw-export-page")!.textContent ?? "";
const image = (): HTMLImageElement => dialog().querySelector<HTMLImageElement>(".draw-export-image")!;
const width = (): HTMLInputElement => dialog().querySelector<HTMLInputElement>(".draw-export-width input")!;
const submit = (): void => dialog().querySelector("form")!.requestSubmit();
const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  vi.restoreAllMocks();
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
});

describe("exportDialog", () => {
  it("parte dalle tavole, in PNG a 2× con la carta, col fuoco sulla scelta di adesso", () => {
    void open();
    expect(dialog().querySelector("h2")!.textContent).toBe("Esporta «Ciclo dell'acqua»");
    const legends = [...dialog().querySelectorAll("legend")].map((each) => each.textContent);
    expect(legends).toEqual(["Che cosa", "Formato", "Misura", "Sfondo"]);
    expect(option("Le tavole").checked).toBe(true);
    expect(document.activeElement).toBe(option("Le tavole"));
    expect(option("Copertina").checked).toBe(true);
    expect(option("Evaporazione").checked).toBe(true);
    expect(option("PNG").checked).toBe(true);
    expect(option("2×").checked).toBe(true);
    expect(option("La carta").checked).toBe(true);
    expect(dialog().querySelector('[aria-label="Le tavole da esportare"]')!.getAttribute("role")).toBe("group");
    expect(dialog().textContent).toContain("Un’immagine, trasparente dove il disegno non ha niente.");
    expect(measure()).toBe("800 × 600 pixel");
    expect(page()).toBe("File 1 di 2: Copertina");
    expect(image().alt).toBe("Anteprima della tavola «Copertina»");
    expect(dialog().querySelector<HTMLElement>(".draw-export-stage")!.dataset.backdrop).toBe("checker");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
  });

  it("l'anteprima è la derivazione dell'export, e si sfoglia un file alla volta", async () => {
    const created = vi.spyOn(URL, "createObjectURL");
    void open();
    const first = created.mock.calls[created.mock.calls.length - 1]![0] as Blob;
    expect(await first.text()).toContain('viewBox="0 0 400 300" width="400" height="300"');
    expect(button("Anteprima precedente").disabled).toBe(true);
    button("Anteprima successiva").click();
    expect(page()).toBe("File 2 di 2: Evaporazione");
    expect(image().alt).toBe("Anteprima della tavola «Evaporazione»");
    expect(button("Anteprima successiva").disabled).toBe(true);
    // In fondo il fuoco passa all'altro pulsante, che c'è ancora.
    expect(document.activeElement).toBe(button("Anteprima precedente"));
    const second = created.mock.calls[created.mock.calls.length - 1]![0] as Blob;
    expect(await second.text()).toContain('viewBox="480 0 400 300"');
  });

  it("toglie le tavole una per una, e senza nessuna non esporta e lo dice", async () => {
    const answer = open();
    choose("Copertina");
    expect(dialog().querySelector<HTMLElement>(".draw-export-pager")!.hidden).toBe(true);
    expect(measure()).toBe("800 × 600 pixel");
    choose("Evaporazione");
    expect(measure()).toBe("Scegli almeno una tavola.");
    expect(image().hidden).toBe(true);
    submit();
    choose("Copertina");
    submit();
    const choice = await answer;
    expect(choice!.options).toEqual({ background: "paper", scope: "boards", boards: ["b1"], scale: 2 });
    expect(choice!.label).toBe("PNG di 1 tavola");
    expect(choice!.memory.off).toEqual(["b2"]);
  });

  it("le caselle delle tavole valgono solo con «Le tavole»", () => {
    void open();
    choose("Il disegno intero");
    expect(option("Copertina").disabled).toBe(true);
    expect(measure()).toBe("1760 × 600 pixel");
    expect(dialog().querySelector<HTMLElement>(".draw-export-pager")!.hidden).toBe(true);
    choose("Le tavole");
    expect(option("Copertina").disabled).toBe(false);
  });

  it("il PDF non ha misura in pixel: dice le pagine in millimetri, sul bianco", async () => {
    const answer = open();
    choose("PDF");
    expect(dialog().querySelectorAll<HTMLFieldSetElement>("fieldset")[2]!.hidden).toBe(true);
    expect(measure()).toBe("105,8 × 79,4 mm");
    expect(page()).toBe("Pagina 1 di 2: Copertina");
    expect(dialog().querySelector<HTMLElement>(".draw-export-stage")!.dataset.backdrop).toBe("white");
    submit();
    const choice = await answer;
    expect(choice).toMatchObject({ target: "draw.pdf", options: { background: "paper", scope: "boards", boards: ["b1", "b2"] }, label: "PDF di 2 tavole" });
    expect(choice!.options).not.toHaveProperty("scale");
  });

  it("l'SVG dice le unità, e può essere trasparente", async () => {
    const answer = open();
    choose("SVG");
    choose("Trasparente");
    expect(measure()).toBe("400 × 300 unità");
    submit();
    expect((await answer)!.options).toEqual({ background: "none", scope: "boards", boards: ["b1", "b2"] });
  });

  it("il JPEG ha sempre la carta, e lo dice", async () => {
    const answer = open();
    choose("Trasparente");
    choose("JPEG");
    expect(option("Trasparente").disabled).toBe(true);
    expect(option("La carta").checked).toBe(true);
    const hint = dialog().querySelector<HTMLElement>(`#${option("Trasparente").getAttribute("aria-describedby")}`)!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe("Il JPEG non ha la trasparenza.");
    expect(dialog().querySelector<HTMLElement>(".draw-export-stage")!.dataset.backdrop).toBe("white");
    submit();
    expect(await answer).toMatchObject({ target: "draw.jpeg", options: { background: "paper", scale: 2 } });
  });

  it("la larghezza parte dalla misura di adesso, e una sbagliata non esporta", async () => {
    const answer = open();
    choose("3×");
    expect(measure()).toBe("1200 × 900 pixel");
    expect(width().disabled).toBe(true);
    choose("Larghezza");
    expect(width().disabled).toBe(false);
    expect(width().value).toBe("1200");
    expect(document.activeElement).toBe(width());
    type(width(), "1000");
    expect(measure()).toBe("1000 × 750 pixel");
    type(width(), "0");
    expect(width().validationMessage).toBe("Scrivi una larghezza intera in pixel, da 1 a 16.384.");
    submit();
    type(width(), "640.5");
    submit();
    type(width(), "640");
    submit();
    const choice = await answer;
    expect(choice!.options).toEqual({ background: "paper", scope: "boards", boards: ["b1", "b2"], width: 640 });
    expect(choice!.memory.size).toEqual({ pixels: 640 });
  });

  it("una misura oltre i limiti di un'immagine esce ridotta, e lo dice", () => {
    const huge = `${HEAD} viewBox="0 0 10000 100" width="10000" height="100"/>`;
    void exportDialog({ name: "Striscia", text: huge, scene: { selection: null, boards: [] }, memory: null, fonts: FONTS });
    expect(measure()).toBe("16.384 × 164 pixel: la misura scelta passa i limiti di un’immagine, 16.384 pixel per lato, ed esce ridotta.");
  });

  it("esporta la selezione coi suoi id, il suo riquadro e la parola del nome del file", async () => {
    const answer = exportDialog({ name: "Prova", text: PAGE_TEXT, scene: SELECTED, memory: null, fonts: FONTS });
    expect(option("Il disegno intero").checked).toBe(true);
    choose("La selezione (1 oggetto)");
    expect(measure()).toBe("168 × 128 pixel");
    expect(image().alt).toBe("Anteprima dell’export");
    submit();
    const choice = await answer;
    expect(choice).toEqual({
      target: "draw.png",
      options: { background: "paper", scope: "selection", selection: { ids: ["o2"], box: [258, 168, 84, 64] }, suffix: "selezione", scale: 2 },
      label: "PNG della selezione",
      memory: { what: "selection", off: [], format: "png", size: { scale: 2 }, background: "paper" },
    });
  });

  it("una selezione con oggetti senza id, in sola lettura, non si sceglie e dice perché", () => {
    void exportDialog({ name: "Prova", text: PAGE_TEXT, scene: { selection: { count: 2, ids: ["o2"], box: [0, 0, 10, 10] }, boards: [] }, memory: null, fonts: FONTS });
    const selection = option("La selezione (2 oggetti)");
    expect(selection.disabled).toBe(true);
    const hint = document.getElementById(selection.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe("Un oggetto scelto non ha un id, e in sola lettura non può riceverlo: l’export trova gli oggetti per id.");
  });

  it("dice quanti oggetti riceveranno un id", () => {
    void exportDialog({ name: "Prova", text: PAGE_TEXT, scene: SELECTED, named: 1, memory: null, fonts: FONTS });
    const hint = document.getElementById(option("La selezione (1 oggetto)").getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe("1 oggetto scelto non ha un id: lo riceve quando esporti, in un passo che si annulla.");
  });

  it("riparte dalle scelte ricordate", async () => {
    const answer = open({ memory: { what: "boards", off: ["b2"], format: "jpeg", size: { pixels: 500 }, background: "paper" } });
    expect(option("JPEG").checked).toBe(true);
    expect(option("Evaporazione").checked).toBe(false);
    expect(option("Larghezza").checked).toBe(true);
    expect(width().value).toBe("500");
    expect(measure()).toBe("500 × 375 pixel");
    submit();
    expect((await answer)!.options).toEqual({ background: "paper", scope: "boards", boards: ["b1"], width: 500 });
  });

  it("Invio su una scelta esporta; Annulla e Esc tornano null", async () => {
    const first = open();
    option("PNG").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect((await first)!.target).toBe("draw.png");

    const second = open();
    button("Annulla").click();
    expect(await second).toBeNull();

    const third = open();
    option("PNG").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(await third).toBeNull();
  });

  it("chiudendo libera le anteprime", async () => {
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const created = vi.spyOn(URL, "createObjectURL");
    const answer = open();
    button("Annulla").click();
    await answer;
    for (const [blob] of created.mock.calls) expect(blob).toBeInstanceOf(Blob);
    expect(revoked.mock.calls.map(([url]) => url)).toEqual(created.mock.results.map((result) => result.value));
  });

  it("un disegno che non si deriva non mostra l'anteprima, e lo dice", () => {
    void exportDialog({ name: "Rotto", text: "<svg", scene: { selection: null, boards: [] }, memory: null, fonts: FONTS });
    expect(measure()).toBe("Questa anteprima non si può mostrare.");
    expect(image().hidden).toBe(true);
  });
});

describe("labelOf e measureText", () => {
  const state = (patch: Partial<ExportState>): ExportState => ({ what: "drawing", off: new Set(), format: "png", size: { scale: 1 }, background: "paper", ...patch });

  it("chiamano ciò che esce e la sua misura", () => {
    expect(labelOf(state({}), BOARDS)).toBe("PNG");
    expect(labelOf(state({ what: "selection", format: "svg" }), BOARDS)).toBe("SVG della selezione");
    expect(labelOf(state({ what: "boards", format: "pdf" }), BOARDS)).toBe("PDF di 2 tavole");
    expect(measureText(state({}), 400.4, 300)).toBe("401 × 300 pixel");
    expect(measureText(state({ format: "svg" }), 400.125, 300)).toBe("400,13 × 300 unità");
    expect(measureText(state({ format: "pdf" }), 793.7, 1122.5)).toBe("210 × 297 mm");
  });
});
