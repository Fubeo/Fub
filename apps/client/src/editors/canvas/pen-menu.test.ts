// @vitest-environment happy-dom
// Il menu della penna della lavagna (N4 T21): apertura, tastiera, scelta e
// chiusura, i nomi per il lettore di schermo e la sola lettura. La scelta la
// tiene chi monta il menu: qui un contenitore finto.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { DEFAULT_INK_CHOICE, type InkPenChoice } from "./ink-record";
import { createPenMenu, type PenMenu } from "./pen-menu";

interface Mounted {
  readonly menu: PenMenu;
  readonly life: Lifetime;
  readonly chosen: Array<{ readonly choice: InkPenChoice; readonly settled: boolean }>;
  readonly state: { choice: InkPenChoice; editable: boolean; theme: "light" | "dark" };
}

let lives: Lifetime[] = [];

afterEach(() => {
  for (const life of lives) life.close();
  lives = [];
  document.body.replaceChildren();
});

function mount(choice: InkPenChoice = DEFAULT_INK_CHOICE): Mounted {
  const life = openLifetime();
  lives.push(life);
  const state = { choice, editable: true, theme: "light" as "light" | "dark" };
  const chosen: Array<{ choice: InkPenChoice; settled: boolean }> = [];
  const menu = createPenMenu({
    lifetime: life,
    choice: () => state.choice,
    choose: (next, settled) => {
      state.choice = next;
      chosen.push({ choice: next, settled });
      menu.sync();
    },
    editable: () => state.editable,
    theme: () => state.theme,
  });
  document.body.append(menu.button);
  return { menu, life, chosen, state };
}

const popover = () => document.querySelector<HTMLElement>(".canvas-pen-popover");
const radios = (group: string) => [...popover()!.querySelectorAll<HTMLElement>(`[role="radio"][data-group="${group}"]`)];
const radio = (group: string, value: string) => radios(group).find((item) => item.dataset.value === value)!;
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
const section = (heading: string) =>
  [...popover()!.querySelectorAll<HTMLElement>(".canvas-pen-section")].find((each) => each.querySelector(".canvas-pen-heading")?.textContent === heading)!;

describe("il pulsante della penna", () => {
  it("dice la penna, il colore e lo spessore, e apre un dialogo", () => {
    const { menu } = mount();
    expect(menu.button.dataset.canvasAction).toBe("ink-pen");
    expect(menu.button.classList.contains("canvas-ink-pen")).toBe(true);
    expect(menu.button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(menu.button.getAttribute("aria-label")).toBe("Penna: Sfera, Blu, 4 px");
    expect(menu.button.title).toBe("Penna: Sfera, Blu, 4 px");
    expect(menu.button.querySelector(".canvas-ink-pen-name")!.textContent).toBe("Sfera");
    expect(menu.button.querySelector(".canvas-ink-pen-chip circle")!.getAttribute("fill")).toBe("#0072b2");
  });

  it("con un colore libero dice il codice; con la gomma dice che cosa cancella", () => {
    const custom = mount({ ...DEFAULT_INK_CHOICE, color: { ...DEFAULT_INK_CHOICE.color, pen: "#7b3fa0" }, width: { ...DEFAULT_INK_CHOICE.width, pen: 0.5 } });
    expect(custom.menu.button.getAttribute("aria-label")).toBe("Penna: Sfera, #7b3fa0, 0,5 px");
    const eraser = mount({ ...DEFAULT_INK_CHOICE, tool: "eraser", eraser: "piece" });
    expect(eraser.menu.button.getAttribute("aria-label")).toBe(t("canvas.ink.pen.eraser_piece"));
    expect(eraser.menu.button.querySelector(".canvas-ink-pen-name")!.textContent).toBe(t("canvas.ink.tool.eraser"));
    expect(eraser.menu.button.querySelector(".canvas-ink-pen-chip circle")!.getAttribute("fill")).toBe("none");
  });
});

describe("il menu della penna", () => {
  it("si apre col clic: le sezioni del prototipo, il fuoco sullo strumento scelto", () => {
    const { menu } = mount();
    menu.button.click();
    const surface = popover()!;
    expect(surface).not.toBeNull();
    expect(surface.getAttribute("role")).toBe("dialog");
    expect(surface.getAttribute("aria-label")).toBe(t("canvas.ink.pen"));
    expect(menu.isOpen).toBe(true);
    expect(menu.button.getAttribute("aria-expanded")).toBe("true");
    expect(radios("tool").map((item) => item.textContent)).toEqual(["Penna", "Evidenziatore", "Gomma"]);
    expect(radios("kind").map((item) => item.textContent)).toEqual(["Sfera", "Stilografica", "Pennello", "Pennarello", "Matita", "Calligrafia"]);
    expect(radios("color")).toHaveLength(9);
    expect(radios("eraser").map((item) => item.textContent)).toEqual(["Il tratto intero", "Solo il pezzo"]);
    // Ogni gruppo ha il suo nome, e ogni penna la sua anteprima disegnata.
    for (const group of surface.querySelectorAll('[role="radiogroup"]')) {
      const heading = document.getElementById(group.getAttribute("aria-labelledby")!);
      expect(heading?.textContent).toBeTruthy();
    }
    for (const item of radios("kind")) expect(item.querySelector(".canvas-pen-preview path")!.getAttribute("d")).toMatch(/^M/);
    expect(document.activeElement).toBe(radio("tool", "pen"));
    expect(radio("tool", "pen").getAttribute("aria-checked")).toBe("true");
    expect(radio("color", "#0072b2").getAttribute("aria-checked")).toBe("true");
    // Lo spessore: il cursore col suo nome, il valore accanto e detto a voce.
    const slider = surface.querySelector<HTMLInputElement>("input.canvas-pen-width")!;
    expect(slider.type).toBe("range");
    expect(surface.querySelector(`label[for="${slider.id}"]`)!.textContent).toBe(t("canvas.ink.width"));
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(["0.5", "20", "0.5", "4"]);
    expect(slider.getAttribute("aria-valuetext")).toBe("4 pixel");
    expect(surface.querySelector(".canvas-pen-width-value")!.textContent).toBe("4 px");
    expect(surface.querySelector(".canvas-pen-width-preview path")!.getAttribute("d")).toMatch(/^M/);
    expect(surface.textContent).toContain(t("canvas.ink.pen.note"));
  });

  it("le frecce si muovono e scelgono nel gruppo; Tab raggiunge solo la voce scelta", () => {
    const { menu, chosen } = mount();
    menu.button.click();
    key(radio("tool", "pen"), "ArrowRight");
    expect(chosen[chosen.length - 1]).toEqual({ choice: { ...DEFAULT_INK_CHOICE, tool: "highlighter" }, settled: true });
    expect(document.activeElement).toBe(radio("tool", "highlighter"));
    expect(radios("tool").map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    // L'evidenziatore: niente tipo di penna, il suo intervallo e il suo colore.
    expect(section(t("canvas.ink.kind")).hidden).toBe(true);
    const slider = popover()!.querySelector<HTMLInputElement>("input.canvas-pen-width")!;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(["4", "48", "1", "16"]);
    expect(radio("color", "#f0e442").getAttribute("aria-checked")).toBe("true");
    key(radio("tool", "highlighter"), "ArrowLeft");
    key(radio("tool", "pen"), "ArrowLeft");
    expect(menu.button.getAttribute("aria-label")).toBe(t("canvas.ink.pen.eraser_stroke"));
    expect(section(t("canvas.ink.color")).hidden).toBe(true);
    expect(document.activeElement).toBe(radio("tool", "eraser"));
    // Il giro: dall'ultimo al primo.
    key(radio("tool", "eraser"), "ArrowRight");
    expect(menu.button.getAttribute("aria-label")).toBe("Penna: Sfera, Blu, 4 px");
    // Fra i colori, «Altro colore…» si raggiunge senza sceglierlo.
    const before = chosen.length;
    key(radio("color", "#0072b2"), "ArrowLeft");
    expect(document.activeElement).toBe(radio("color", "#000000"));
    key(radio("color", "#000000"), "ArrowLeft");
    expect(document.activeElement).toBe(radio("color", "custom"));
    expect(chosen.length).toBe(before + 1);
    expect(menu.button.getAttribute("aria-label")).toBe("Penna: Sfera, Nero, 4 px");
  });

  it("il clic sceglie penna, colore e gomma; il cursore sceglie lo spessore e lo ricorda quando si lascia", () => {
    const { menu, chosen, state } = mount();
    menu.button.click();
    radio("kind", "brush").click();
    radio("color", "#009e73").click();
    radio("eraser", "piece").click();
    expect(state.choice).toMatchObject({ pen: "brush", eraser: "piece", color: { pen: "#009e73", highlighter: "#f0e442" } });
    expect(chosen.every((each) => each.settled)).toBe(true);
    expect(radio("kind", "brush").getAttribute("aria-checked")).toBe("true");
    const slider = popover()!.querySelector<HTMLInputElement>("input.canvas-pen-width")!;
    slider.value = "7.5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(chosen[chosen.length - 1]).toMatchObject({ settled: false, choice: { width: { pen: 7.5 } } });
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(chosen[chosen.length - 1]).toMatchObject({ settled: true, choice: { width: { pen: 7.5 } } });
    expect(popover()!.querySelector(".canvas-pen-width-value")!.textContent).toBe("7,5 px");
    expect(slider.getAttribute("aria-valuetext")).toBe("7,5 pixel");
    expect(menu.button.getAttribute("aria-label")).toBe("Penna: Pennello, Verde, 7,5 px");
  });

  it("i campioni dicono il nome e, sul tema che li legge poco, anche questo", () => {
    const { menu, state } = mount();
    menu.button.click();
    expect(radio("color", "#000000").getAttribute("aria-label")).toBe("Nero");
    expect(radio("color", "#f0e442").getAttribute("aria-label")).toBe(t("canvas.ink.color.faint_light", { name: "Giallo" }));
    state.theme = "dark";
    menu.sync();
    expect(radio("color", "#000000").getAttribute("aria-label")).toBe(t("canvas.ink.color.faint_dark", { name: "Nero" }));
    expect(radio("color", "#f0e442").getAttribute("aria-label")).toBe("Giallo");
  });

  it("un colore libero segna «Altro colore» col suo codice", () => {
    const { menu } = mount({ ...DEFAULT_INK_CHOICE, color: { ...DEFAULT_INK_CHOICE.color, pen: "#7b3fa0" } });
    menu.button.click();
    const more = radio("color", "custom");
    expect(more.getAttribute("aria-checked")).toBe("true");
    expect(more.textContent).toBe(t("canvas.ink.color.custom", { code: "#7b3fa0" }));
    expect(more.getAttribute("aria-haspopup")).toBe("dialog");
    more.click();
    expect(document.querySelector(".kit-color-popover")).not.toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("Esc chiude e rende il fuoco al pulsante; il secondo clic chiude", () => {
    const { menu } = mount();
    menu.button.click();
    key(radio("tool", "pen"), "Escape");
    expect(popover()).toBeNull();
    expect(menu.isOpen).toBe(false);
    expect(menu.button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu.button);
    menu.button.click();
    expect(popover()).not.toBeNull();
    menu.button.click();
    expect(popover()).toBeNull();
  });

  it("in sola lettura il pulsante è spento e il menu si chiude; la vita che si chiude lo chiude", () => {
    const { menu, state, life } = mount();
    menu.button.click();
    state.editable = false;
    menu.sync();
    expect(popover()).toBeNull();
    expect(menu.button.disabled).toBe(true);
    state.editable = true;
    menu.sync();
    menu.button.click();
    expect(popover()).not.toBeNull();
    life.close();
    expect(popover()).toBeNull();
    menu.button.click();
    expect(popover()).toBeNull();
  });
});
