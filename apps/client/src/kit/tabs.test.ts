// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../moto";
import { checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { createTabs, type TabSpec, type TabsOptions } from "./tabs";
import { measure, press } from "./testing";

let life: Lifetime;
let tablist: HTMLElement;
let panels: Record<string, HTMLElement>;
let selections: string[];

function specs(): TabSpec[] {
  return [
    { id: "uno", label: "Uno", panel: panels.uno },
    { id: "due", label: "Due", panel: panels.due },
    { id: "tre", label: "Tre", panel: panels.tre, disabled: true },
    { id: "quattro", label: "Quattro", panel: panels.quattro },
  ];
}

function tabs(extra: Partial<TabsOptions> = {}) {
  return createTabs({
    tablist,
    tabs: specs(),
    label: "Sezioni",
    onSelect: (id) => selections.push(id),
    lifetime: life,
    ...extra,
  });
}

const buttons = (): HTMLButtonElement[] => [...tablist.querySelectorAll<HTMLButtonElement>(".kit-tab")];
const indicator = (): HTMLElement => tablist.querySelector<HTMLElement>(".kit-tab-indicator")!;
const chosen = (): string[] =>
  buttons()
    .filter((button) => button.getAttribute("aria-selected") === "true")
    .map((button) => button.dataset.tab!);

beforeEach(() => {
  life = openLifetime();
  tablist = document.createElement("div");
  document.body.append(tablist);
  panels = {};
  for (const id of ["uno", "due", "tre", "quattro"]) {
    const panel = document.createElement("div");
    panel.textContent = `pannello ${id}`;
    document.body.append(panel);
    panels[id] = panel;
  }
  selections = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
});

describe("la forma", () => {
  it("è una fila di schede, con la prima scelta e legata al suo pannello", () => {
    const handle = tabs();
    expect(tablist.getAttribute("role")).toBe("tablist");
    expect(tablist.getAttribute("aria-orientation")).toBe("horizontal");
    expect(tablist.getAttribute("aria-label")).toBe("Sezioni");
    expect(tablist.classList.contains("kit-tabs")).toBe(true);
    expect(buttons().map((button) => button.getAttribute("role"))).toEqual(Array(4).fill("tab"));
    expect(buttons().map((button) => button.textContent)).toEqual(["Uno", "Due", "Tre", "Quattro"]);
    expect(buttons().every((button) => button.type === "button")).toBe(true);
    expect(chosen()).toEqual(["uno"]);
    expect(handle.selected()).toBe("uno");
    for (const button of buttons()) {
      const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(button.id);
    }
    expect(Object.values(panels).map((panel) => panel.hidden)).toEqual([false, true, true, true]);
    // Alla creazione non avvisa: nessuno ha scelto.
    expect(selections).toEqual([]);
  });

  it("supera il controllo di accessibilità della shell", () => {
    tabs();
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("Tab si ferma una volta sola, sulla scheda scelta", () => {
    const handle = tabs({ selected: "due" });
    expect(buttons().map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);
    handle.select("quattro");
    expect(buttons().map((button) => button.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("parte dalla scheda chiesta, o dalla prima che si può scegliere", () => {
    expect(tabs({ selected: "quattro" }).selected()).toBe("quattro");
    life.close();
    life = openLifetime();
    // Una scheda spenta non si sceglie nemmeno all'inizio.
    expect(tabs({ selected: "tre" }).selected()).toBe("uno");
  });

  it("mette l'icona prima del testo, e funziona senza pannelli", () => {
    const handle = tabs({
      tabs: [
        { id: "a", label: "Cerca", icon: "search" },
        { id: "b", label: "Note" },
      ],
    });
    const first = handle.tab("a")!;
    expect(first.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(first.querySelector(".kit-tab-label")?.textContent).toBe("Cerca");
    expect(first.hasAttribute("aria-controls")).toBe(false);
    expect(handle.tab("non-c'è")).toBeNull();
  });
});

describe("la tastiera", () => {
  it("le frecce girano fra le schede, saltano quella spenta e scelgono", () => {
    tabs();
    buttons()[0].focus();
    expect(press(buttons()[0], "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons()[1]);
    press(buttons()[1], "ArrowRight");
    expect(document.activeElement).toBe(buttons()[3]);
    press(buttons()[3], "ArrowRight");
    expect(document.activeElement).toBe(buttons()[0]);
    press(buttons()[0], "ArrowLeft");
    expect(document.activeElement).toBe(buttons()[3]);
    expect(selections).toEqual(["due", "quattro", "uno", "quattro"]);
    expect(chosen()).toEqual(["quattro"]);
    expect(Object.values(panels).map((panel) => panel.hidden)).toEqual([true, true, true, false]);
  });

  it("Inizio e Fine vanno ai capi", () => {
    tabs({ selected: "due" });
    buttons()[1].focus();
    press(buttons()[1], "End");
    expect(document.activeElement).toBe(buttons()[3]);
    press(buttons()[3], "Home");
    expect(document.activeElement).toBe(buttons()[0]);
    expect(selections).toEqual(["quattro", "uno"]);
  });

  it("le frecce dell'altro asse e quelle con un modificatore non sono sue", () => {
    tabs();
    buttons()[0].focus();
    expect(press(buttons()[0], "ArrowDown").defaultPrevented).toBe(false);
    expect(press(buttons()[0], "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(buttons()[0], "ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(selections).toEqual([]);
  });

  it("in verticale valgono su e giù", () => {
    tabs({ orientation: "vertical" });
    expect(tablist.getAttribute("aria-orientation")).toBe("vertical");
    buttons()[0].focus();
    expect(press(buttons()[0], "ArrowRight").defaultPrevented).toBe(false);
    press(buttons()[0], "ArrowDown");
    expect(document.activeElement).toBe(buttons()[1]);
    press(buttons()[1], "ArrowUp");
    expect(document.activeElement).toBe(buttons()[0]);
    expect(selections).toEqual(["due", "uno"]);
  });

  it("da destra a sinistra «avanti» è la freccia sinistra", () => {
    tabs();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ direction: "rtl" } as CSSStyleDeclaration);
    buttons()[0].focus();
    press(buttons()[0], "ArrowLeft");
    expect(document.activeElement).toBe(buttons()[1]);
    press(buttons()[1], "ArrowRight");
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it("con l'attivazione manuale le frecce spostano il fuoco, e sceglie il clic", () => {
    tabs({ activation: "manual" });
    buttons()[0].focus();
    press(buttons()[0], "ArrowRight");
    expect(document.activeElement).toBe(buttons()[1]);
    expect(chosen()).toEqual(["uno"]);
    expect(selections).toEqual([]);
    // Invio e Spazio su un pulsante sono un clic: lo fa il browser.
    buttons()[1].click();
    expect(chosen()).toEqual(["due"]);
    expect(selections).toEqual(["due"]);
  });
});

describe("la scelta", () => {
  it("un clic sceglie e avvisa una volta; sulla scheda già scelta non avvisa", () => {
    tabs();
    buttons()[1].click();
    buttons()[1].click();
    expect(selections).toEqual(["due"]);
    expect(chosen()).toEqual(["due"]);
  });

  it("riconosce la scheda anche da un clic sulla sua etichetta", () => {
    tabs();
    buttons()[3].querySelector<HTMLElement>(".kit-tab-label")!.click();
    expect(selections).toEqual(["quattro"]);
  });

  it("select() sceglie senza avvisare, e ignora ciò che non si può scegliere", () => {
    const handle = tabs();
    handle.select("quattro");
    expect(handle.selected()).toBe("quattro");
    expect(chosen()).toEqual(["quattro"]);
    handle.select("tre");
    handle.select("non-c'è");
    expect(handle.selected()).toBe("quattro");
    expect(selections).toEqual([]);
  });

  it("una scheda spenta è un pulsante spento", () => {
    tabs();
    expect(buttons()[2].disabled).toBe(true);
    buttons()[2].click();
    expect(selections).toEqual([]);
  });
});

describe("il segno", () => {
  function layOut(): void {
    buttons().forEach((button, index) => measure(button, { left: index * 80, top: index * 30, width: 80, height: 30 }));
  }

  it("è uno solo, e prende posto e misura della scheda scelta", () => {
    const handle = tabs();
    expect(tablist.querySelectorAll(".kit-tab-indicator").length).toBe(1);
    expect(indicator().getAttribute("aria-hidden")).toBe("true");
    expect(indicator().hidden).toBe(false);
    layOut();
    handle.select("due");
    expect(indicator().style.left).toBe("80px");
    expect(indicator().style.width).toBe("80px");
    expect(indicator().style.top).toBe("");
  });

  it("in verticale corre lungo l'altro asse", () => {
    const handle = tabs({ orientation: "vertical" });
    layOut();
    handle.select("quattro");
    expect(indicator().style.top).toBe("90px");
    expect(indicator().style.height).toBe("30px");
    expect(indicator().style.left).toBe("");
  });

  it("senza schede da scegliere non si vede", () => {
    tabs({ tabs: [] });
    expect(indicator().hidden).toBe(true);
  });

  it("scivola verso la scheda nuova: la posizione cambia subito, si muove la differenza", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    tabs();
    layOut();
    // Il motore misura il segno dov'è: qui lo dice lo stile che `tabs` scrive.
    const sign = indicator();
    sign.getBoundingClientRect = () =>
      new DOMRect(parseFloat(sign.style.left) || 0, 0, parseFloat(sign.style.width) || 80, 2);
    // La prima posa è avvenuta senza corsa.
    expect(driver.plays.length).toBe(0);

    buttons()[3].click();
    expect(sign.style.left).toBe("240px");
    expect(driver.plays.length).toBe(1);
    const play = driver.plays[0];
    expect(play.el).toBe(sign);
    // Parte da dov'era, 240 px più a sinistra, e arriva all'identità.
    expect(String(play.keyframes[0].transform)).toContain("translate(-240px, 0px)");
    expect(String(play.keyframes[play.keyframes.length - 1].transform)).toContain("translate(0px, 0px)");
    expect(activeMotions()).toBe(1);
    driver.advance(2000);
    expect(activeMotions()).toBe(0);
    expect(sign.style.transform).toBe("");
  });

  it("nel livello ridotto salta", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    tabs();
    layOut();
    const sign = indicator();
    sign.getBoundingClientRect = () =>
      new DOMRect(parseFloat(sign.style.left) || 0, 0, parseFloat(sign.style.width) || 80, 2);
    buttons()[3].click();
    expect(sign.style.left).toBe("240px");
    expect(driver.plays.length).toBe(0);
  });
});

describe("lo smontaggio", () => {
  it("toglie schede e segno, e ciò che aveva scritto su fila e pannelli", () => {
    tabs();
    life.close();
    expect(tablist.children.length).toBe(0);
    expect(tablist.hasAttribute("role")).toBe(false);
    expect(tablist.hasAttribute("aria-orientation")).toBe(false);
    expect(tablist.hasAttribute("aria-label")).toBe(false);
    expect(tablist.classList.contains("kit-tabs")).toBe(false);
    for (const panel of Object.values(panels)) {
      expect(panel.hasAttribute("role")).toBe(false);
      expect(panel.hasAttribute("aria-labelledby")).toBe(false);
    }
  });

  it("smontate, non rispondono più", () => {
    const handle = tabs();
    const [, second] = buttons();
    life.close();
    second.click();
    press(tablist, "ArrowRight");
    handle.select("due");
    expect(selections).toEqual([]);
    expect(handle.selected()).toBeNull();
  });

  it("montate e smontate molte volte non lasciano corse né schede", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    for (let round = 0; round < 5; round++) {
      const each = openLifetime();
      tabs({ lifetime: each });
      buttons().forEach((button, index) => measure(button, { left: index * 80, width: 80 }));
      const sign = indicator();
      sign.getBoundingClientRect = () => new DOMRect(parseFloat(sign.style.left) || 0, 0, 80, 2);
      buttons()[1].click();
      buttons()[3].click();
      expect(activeMotions()).toBeGreaterThan(0);
      each.close();
      expect(activeMotions()).toBe(0);
      expect(tablist.children.length).toBe(0);
    }
  });
});
