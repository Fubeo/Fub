// @vitest-environment happy-dom
//
// I passi del «/» da soli: le frecce, il clic, ciò che si scrive e gli
// argomenti che ne escono.
import { describe, expect, it } from "vitest";
import type { SlashMenuEntry, SlashPicker } from "../../../editors/core/editor-menu";
import { CALLOUT_TYPES } from "../../../editors/text/profiles/markdown/kinds";
import { CALLOUTS } from "../quick";
import { openStep, type StepDeps } from "./index";

// Giovedì 29 ottobre 2026.
const today = new Date(2026, 9, 29);

function entry(picker: SlashPicker): SlashMenuEntry {
  return { id: `markdown.${picker}`, label: picker, description: "", icon: "", hint: null, section: "blocks", action: true, picker, params: {}, quick: false, span: null, why: null };
}

function color(id: string): SlashMenuEntry {
  return { ...entry("color"), id, label: id, picker: null };
}

const deps: StepDeps = {
  today: () => today,
  colors: () => ({
    text: ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].map((name) => color(`markdown.color.${name}`)),
    fill: ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].map((name) => color(`markdown.background.${name}`)),
  }),
  notes: async (query) => [
    { label: "Media", detail: "Statistica/Media.md", target: "Media" },
    { label: "Varianza", detail: "Statistica/Varianza.md", target: "Varianza" },
  ].filter((note) => note.label.toLowerCase().includes(query.toLowerCase())),
  headings: async () => [{ level: 2, text: "Le formule" }, { level: 2, text: "Un esempio" }],
};

function step(picker: SlashPicker) {
  const done: { entry?: SlashMenuEntry; params: Readonly<Record<string, unknown>> }[] = [];
  let changes = 0;
  const opened = openStep(entry(picker), deps, { done: (choice) => void done.push(choice), changed: () => void changes++ })!;
  document.body.append(opened.dom);
  const key = (name: string) => opened.key(new KeyboardEvent("keydown", { key: name }));
  const type = (text: string) => [...text].forEach((char) => key(char));
  return { opened, done, key, type, changes: () => changes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("i passi del «/»", () => {
  it("la tabella parte da 3 × 3, le frecce la allargano nei limiti di 6 × 8", () => {
    const { opened, done, key } = step("table");
    expect(opened.hint()).toContain("3 × 3");
    for (let i = 0; i < 10; i++) key("ArrowRight");
    for (let i = 0; i < 10; i++) key("ArrowDown");
    expect(opened.hint()).toContain("6 × 8");
    expect(opened.dom.querySelectorAll(".slash-step-cell.is-on")).toHaveLength(48);
    key("Enter");
    expect(done).toEqual([{ params: { rows: 6, cols: 8 } }]);
    expect(opened.active()).toBe(opened.dom.querySelector(".is-selected")!.id);
  });

  it("un clic su una cella mette quella tabella", () => {
    const { opened, done } = step("table");
    opened.dom.querySelectorAll<HTMLElement>(".slash-step-cell")[tableIndex(2, 4)]!.click();
    expect(done).toEqual([{ params: { rows: 2, cols: 4 } }]);
  });

  it("il colore: la riga del testo e quella del fondo, e la voce del colore scelto", () => {
    const { done, key } = step("color");
    key("ArrowRight");
    key("ArrowDown");
    key("Enter");
    expect(done[0]!.entry?.id).toBe("markdown.background.gray");
  });

  it("il colore predefinito, dove non c'è un colore da togliere, si vede ma non si sceglie", () => {
    const without = (entries: readonly SlashMenuEntry[]) => entries.filter((each) => !each.id.endsWith(".default"));
    const done: unknown[] = [];
    const opened = openStep(entry("color"), { ...deps, colors: () => ({ text: without(deps.colors().text), fill: without(deps.colors().fill) }) }, { done: (choice) => void done.push(choice), changed: () => {} })!;
    expect(opened.hint()).toBe("markdown.color.gray");
    const first = opened.dom.querySelector<HTMLElement>(".slash-step-cell")!;
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(first.getAttribute("aria-label")).toContain("Testo predefinito");
    opened.key(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(done).toEqual([{ entry: expect.objectContaining({ id: "markdown.color.gray" }), params: {} }]);
    first.click();
    expect(done).toHaveLength(1);
  });

  it("la data: domani di serie, le frecce per giorni e settimane", () => {
    const { opened, done, key } = step("date");
    expect(opened.dom.querySelector(".slash-step-calendar .is-selected")?.textContent).toBe("30");
    expect(opened.dom.querySelector(".slash-step-calendar .is-today")?.textContent).toBe("29");
    key("ArrowDown");
    key("Enter");
    expect(done).toEqual([{ params: { date: "2026-11-06" } }]);
    opened.dom.querySelector<HTMLElement>(".slash-step-chips [data-iso='2026-10-30']")!.click();
    expect(done[1]).toEqual({ params: { date: "2026-10-30" } });
  });

  it("il calendario comincia di lunedì", () => {
    const { opened } = step("date");
    const first = opened.dom.querySelector<HTMLElement>(".slash-step-calendar [role=option]")!;
    // Il 1° ottobre 2026 è un giovedì: la settimana comincia lunedì 28 settembre.
    expect(first.dataset["iso"]).toBe("2026-09-28");
  });

  it("i riquadri: soltanto i tipi che la resa conosce", () => {
    expect(CALLOUTS.map((each) => each.type).sort()).toEqual([...CALLOUT_TYPES].sort());
    const { done, key } = step("callout");
    key("ArrowDown");
    key("Enter");
    expect(done).toEqual([{ params: { type: CALLOUTS[3]!.type } }]);
  });

  it("il diagramma: un modello per tipo", () => {
    const { done, key } = step("diagram");
    key("Enter");
    expect(done).toEqual([{ params: { template: "flowchart" } }]);
  });

  it("il codice: si filtra scrivendo, Backspace cancella, un nome nuovo si usa com'è", () => {
    const { opened, done, key, type } = step("code");
    expect(opened.dom.querySelector(".slash-step-row")?.textContent).toBe("Testo semplice");
    type("py");
    expect(opened.typing()).toBe(true);
    expect(opened.dom.querySelector(".slash-step-row")?.textContent).toBe("python");
    key("Backspace");
    key("Backspace");
    expect(opened.typing()).toBe(false);
    expect(key("Backspace")).toBe(false);
    type("zig");
    key("Enter");
    expect(done).toEqual([{ params: { language: "zig" } }]);
  });

  it("la nota da collegare: le note arrivano, ciò che si scrive le filtra", async () => {
    const { opened, done, key, type } = step("note");
    await settle();
    expect(opened.dom.querySelectorAll(".slash-step-row")).toHaveLength(2);
    type("var");
    await settle();
    expect(opened.dom.querySelectorAll(".slash-step-row")).toHaveLength(1);
    key("Enter");
    expect(done).toEqual([{ params: { target: "Varianza" } }]);
  });

  it("l'incorporazione: «#» dopo la nota passa ai suoi titoli", async () => {
    const { opened, done, key, type } = step("embed");
    await settle();
    type("med");
    await settle();
    type("#form");
    await settle();
    expect(opened.dom.querySelector(".slash-step-row b")?.textContent).toBe("Le formule");
    key("Enter");
    expect(done).toEqual([{ params: { target: "Media#Le formule" } }]);
  });

  it("una risposta vecchia non scrive sopra quella nuova", async () => {
    let release: (() => void) | null = null;
    const slow: StepDeps = {
      ...deps,
      notes: (query) => (query === "" ? new Promise((resolve) => { release = () => resolve([{ label: "Vecchia", detail: "", target: "Vecchia" }]); }) : deps.notes(query)),
    };
    const done: unknown[] = [];
    const opened = openStep(entry("note"), slow, { done: (choice) => void done.push(choice), changed: () => {} })!;
    opened.key(new KeyboardEvent("keydown", { key: "m" }));
    await settle();
    release!();
    await settle();
    expect([...opened.dom.querySelectorAll(".slash-step-row b")].map((b) => b.textContent)).toEqual(["Media"]);
    opened.dispose();
  });
});

/// L'indice della cella righe × colonne nella griglia 6 × 8.
function tableIndex(rows: number, cols: number): number {
  return (rows - 1) * 8 + (cols - 1);
}
