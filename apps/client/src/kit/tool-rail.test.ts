// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { listenerLedger, pointer, press } from "./testing";
import { createToolRail, FLYOUT_HOLD_MS, toolTip, type RailGroup } from "./tool-rail";

const GROUPS: readonly RailGroup[] = [
  {
    id: "select",
    slots: [
      {
        id: "selection",
        tools: [
          { id: "select", label: "Selezione", icon: "cursor", keys: "V", ariaKeys: "V" },
          { id: "nodes", label: "Nodi", icon: "cursor", keys: "A", ariaKeys: "A" },
          { id: "lasso", label: "Lazo", icon: "cursor", keys: "Q", ariaKeys: "Q" },
        ],
      },
      { id: "board", tools: [{ id: "board", label: "Tavola", icon: "grid", keys: "F" }] },
    ],
  },
  { id: "empty", slots: [] },
  {
    id: "draw",
    slots: [
      {
        id: "pen",
        tools: [
          { id: "pen", label: "Penna", icon: "pen", keys: "P", description: "Scrive a mano libera" },
          { id: "highlighter", label: "Evidenziatore", icon: "pen", keys: "Maiusc+P", ariaKeys: "Shift+P" },
        ],
      },
      { id: "eraser", tools: [{ id: "eraser", label: "Gomma", icon: "pen", keys: "E" }] },
    ],
  },
];

let life: Lifetime;
let chosen: string[];
let remembered: [string, string][];

beforeEach(() => {
  life = openLifetime();
  chosen = [];
  remembered = [];
});

afterEach(() => {
  life.close();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const rail = (active: string | null = "select", orientation: "vertical" | "horizontal" = "vertical") => {
  const made = createToolRail({
    label: "Strumenti",
    orientation,
    groups: GROUPS,
    active,
    remembered: { pen: "highlighter" },
    text: { more: (tool) => `Altri strumenti di ${tool}` },
    onSelect: (tool) => chosen.push(tool),
    onRemember: (slot, tool) => remembered.push([slot, tool]),
    lifetime: life,
  });
  document.body.append(made.element);
  return made;
};

const slots = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(".kit-rail-slot")];

describe("toolTip", () => {
  it("dice nome, tasto e descrizione", () => {
    expect(toolTip({ id: "pen", label: "Penna", icon: "pen", keys: "P", description: "Scrive" })).toBe("Penna (P) — Scrive");
    expect(toolTip({ id: "pen", label: "Penna", icon: "pen" })).toBe("Penna");
  });
});

describe("createToolRail", () => {
  it("è una toolbar coi gruppi separati e un punto di tabulazione", () => {
    const made = rail();
    expect(made.element.getAttribute("role")).toBe("toolbar");
    expect(made.element.getAttribute("aria-orientation")).toBe("vertical");
    expect(made.element.querySelectorAll(".kit-rail-group")).toHaveLength(2);
    expect(made.element.querySelectorAll("[role=separator]")).toHaveLength(1);
    const buttons = slots(made.element);
    expect(buttons.map((button) => accessibleName(button))).toEqual(["Selezione", "Tavola", "Evidenziatore", "Gomma"]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0]!.getAttribute("aria-haspopup")).toBe("menu");
    expect(buttons[1]!.hasAttribute("aria-haspopup")).toBe(false);
    expect(buttons[2]!.getAttribute("aria-keyshortcuts")).toBe("Shift+P");
  });

  it("le frecce lungo il verso, Home e Fine muovono il fuoco; il clic sceglie", () => {
    const made = rail();
    const buttons = slots(made.element);
    made.focus();
    press(buttons[0]!, "ArrowDown");
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1]!, "End");
    expect(document.activeElement).toBe(buttons[3]);
    press(buttons[3]!, "ArrowDown");
    expect(document.activeElement).toBe(buttons[0]);
    press(buttons[0]!, "ArrowUp");
    expect(document.activeElement).toBe(buttons[3]);
    expect(buttons[3]!.tabIndex).toBe(0);
    press(buttons[3]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[3]);
    buttons[3]!.click();
    expect(chosen).toEqual(["eraser"]);
  });

  it("in orizzontale vanno destra e sinistra", () => {
    const made = rail("select", "horizontal");
    const buttons = slots(made.element);
    made.focus();
    press(buttons[0]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    press(buttons[1]!, "ArrowLeft");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("la freccia di lato apre la tendina, che sceglie e fa ricordare", () => {
    const made = rail();
    const buttons = slots(made.element);
    made.focus();
    press(buttons[0]!, "ArrowDown");
    press(buttons[1]!, "ArrowDown");
    press(buttons[2]!, "ArrowRight");
    const menu = document.querySelector<HTMLElement>(".kit-rail-flyout")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(buttons[2]!.getAttribute("aria-expanded")).toBe("true");
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
    expect(items.map((item) => item.querySelector(".kit-rail-flyout-label")?.textContent)).toEqual(["Penna", "Evidenziatore"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(items[1]);
    press(items[1]!, "ArrowDown");
    press(document.activeElement!, "Enter");
    expect(chosen).toEqual(["pen"]);
    expect(remembered).toEqual([["pen", "pen"]]);
    expect(document.querySelector(".kit-rail-flyout")).toBeNull();
    expect(buttons[2]!.getAttribute("aria-expanded")).toBe("false");
    expect(accessibleName(buttons[2]!)).toBe("Penna");
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("la pressione lunga, il tasto destro e il triangolino aprono la tendina", () => {
    vi.useFakeTimers();
    const made = rail();
    const [selection] = slots(made.element);
    selection!.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(FLYOUT_HOLD_MS - 1);
    expect(document.querySelector(".kit-rail-flyout")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector(".kit-rail-flyout")).not.toBeNull();
    // Il clic che chiude la pressione non sceglie.
    selection!.dispatchEvent(pointer("pointerup"));
    selection!.click();
    expect(chosen).toEqual([]);
    made.setActive("select");
    expect(document.querySelector(".kit-rail-flyout")).not.toBeNull();
    made.setGroups(GROUPS);
    expect(document.querySelector(".kit-rail-flyout")).toBeNull();

    const fresh = slots(made.element)[0]!;
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fresh.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(document.querySelector(".kit-rail-flyout")).not.toBeNull();
    made.setGroups(GROUPS);

    const corner = slots(made.element)[0]!.querySelector(".kit-rail-corner")!;
    corner.dispatchEvent(pointer("pointerdown"));
    expect(document.querySelector(".kit-rail-flyout")).not.toBeNull();
  });

  it("una pressione breve sceglie lo strumento mostrato", () => {
    vi.useFakeTimers();
    const made = rail("eraser");
    const pen = slots(made.element)[2]!;
    pen.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(100);
    pen.dispatchEvent(pointer("pointerup"));
    pen.click();
    vi.advanceTimersByTime(FLYOUT_HOLD_MS);
    expect(document.querySelector(".kit-rail-flyout")).toBeNull();
    expect(chosen).toEqual(["highlighter"]);
    expect(remembered).toEqual([["pen", "highlighter"]]);
  });

  it("setActive mostra lo strumento scelto nella sua casella", () => {
    const made = rail();
    made.setActive("lasso");
    const [selection] = slots(made.element);
    expect(accessibleName(selection!)).toBe("Lazo");
    expect(selection!.dataset.tool).toBe("lasso");
    made.setActive("eraser");
    expect(accessibleName(selection!)).toBe("Lazo");
    expect(selection!.getAttribute("aria-pressed")).toBe("false");
  });

  it("setDisabled spegne le caselle e chiude la tendina; slotClass arriva alle caselle", () => {
    const made = createToolRail({
      label: "Strumenti",
      groups: GROUPS,
      active: "select",
      slotClass: "altro",
      text: { more: (tool) => tool },
      onSelect: (tool) => chosen.push(tool),
      lifetime: life,
    });
    document.body.append(made.element);
    expect(slots(made.element).every((button) => button.classList.contains("altro"))).toBe(true);
    made.openFlyout("selection");
    made.setDisabled(true);
    expect(document.querySelector(".kit-rail-flyout")).toBeNull();
    expect(slots(made.element).every((button) => button.disabled)).toBe(true);
    made.setGroups(GROUPS);
    expect(slots(made.element).every((button) => button.disabled)).toBe(true);
    made.setDisabled(false);
    expect(slots(made.element).some((button) => button.disabled)).toBe(false);
  });

  it("chiudere la vita non lascia ascolti", () => {
    const ledger = listenerLedger(document, window);
    const made = rail();
    made.openFlyout("selection");
    made.setGroups(GROUPS);
    made.openFlyout("pen");
    life.close();
    expect(ledger()).toBe(0);
  });
});
