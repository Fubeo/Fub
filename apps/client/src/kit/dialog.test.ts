// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../moto";
import { checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { openDialog, type DialogAction, type DialogOptions } from "./dialog";
import { openLayers } from "./layers";
import { openPopover } from "./popover";
import { listenerLedger, pointer, press } from "./testing";

type Answer = "yes" | "no" | "dismissed";

const YES_NO: DialogAction<Answer>[] = [
  { id: "no", label: "Annulla", value: "no" },
  { id: "yes", label: "Conferma", kind: "primary", value: "yes" },
];

let life: Lifetime;
let opener: HTMLButtonElement;

function open(extra: Partial<DialogOptions<Answer>> = {}) {
  return openDialog<Answer>({
    title: "Chiudere senza salvare?",
    actions: YES_NO,
    dismissValue: "dismissed",
    lifetime: life,
    ...extra,
  });
}

const action = (root: ParentNode, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
const scrim = (): HTMLElement => document.querySelector<HTMLElement>(".kit-dialog-scrim")!;

beforeEach(() => {
  life = openLifetime();
  opener = document.createElement("button");
  opener.textContent = "apri";
  document.body.append(opener);
  opener.focus();
});

afterEach(() => {
  life.close();
  expect(openLayers()).toBe(0);
  document.body.replaceChildren();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
});

describe("la forma", () => {
  it("è un dialogo modale col titolo come nome e la descrizione come descrizione", () => {
    const dialog = open({ description: "Le modifiche andranno perse." });
    const el = dialog.element;
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(el.getAttribute("aria-labelledby")!)!;
    expect(title.textContent).toBe("Chiudere senza salvare?");
    expect(title.className).toBe("kit-dialog-title");
    const description = document.getElementById(el.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toBe("Le modifiche andranno perse.");
    expect(el.parentElement).toBe(scrim());
    expect(scrim().parentElement).toBe(document.body);
  });

  it("senza descrizione non ne dichiara una", () => {
    const dialog = open();
    expect(dialog.element.hasAttribute("aria-describedby")).toBe(false);
    expect(dialog.element.querySelector(".kit-dialog-description")).toBeNull();
  });

  it("mette il corpo fra il testo e le azioni, e le azioni nell'ordine dato", () => {
    const body = document.createElement("p");
    body.textContent = "corpo";
    const dialog = open({ body, description: "descrizione" });
    const order = [...dialog.element.children].map((child) => child.className);
    expect(order).toEqual([
      "kit-dialog-title",
      "kit-dialog-description",
      "kit-dialog-body",
      "kit-dialog-actions",
    ]);
    const buttons = [...dialog.element.querySelectorAll<HTMLButtonElement>(".kit-dialog-actions button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Annulla", "Conferma"]);
    expect(buttons.map((button) => button.dataset.kind)).toEqual(["normal", "primary"]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
  });

  it("supera il controllo di accessibilità della shell", () => {
    open({ description: "Le modifiche andranno perse." });
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });
});

describe("il fuoco iniziale", () => {
  it("parte dall'azione primaria", () => {
    const dialog = open();
    expect(document.activeElement).toBe(action(dialog.element, "yes"));
  });

  it("parte dall'azione che lo chiede", () => {
    const dialog = open({
      actions: [
        { id: "no", label: "Annulla", value: "no", autofocus: true },
        { id: "yes", label: "Conferma", kind: "primary", value: "yes" },
      ],
    });
    expect(document.activeElement).toBe(action(dialog.element, "no"));
  });

  it("parte dal primo campo del corpo, se c'è", () => {
    const body = document.createElement("div");
    const field = document.createElement("input");
    body.append(field);
    open({ body });
    expect(document.activeElement).toBe(field);
  });

  it("in un dialogo di pericolo parte dal pulsante sicuro", () => {
    const dialog = open({
      actions: [
        { id: "yes", label: "Elimina", kind: "danger", value: "yes" },
        { id: "no", label: "Annulla", value: "no" },
      ],
    });
    expect(document.activeElement).toBe(action(dialog.element, "no"));
  });

  it("senza azioni resta sul dialogo", () => {
    const dialog = open({ actions: [] });
    expect(document.activeElement).toBe(dialog.element);
  });
});

describe("la trappola", () => {
  it("Tab non esce: dall'ultima azione torna alla prima, e viceversa", () => {
    const dialog = open();
    const first = action(dialog.element, "no");
    const last = action(dialog.element, "yes");
    last.focus();
    expect(press(last, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(press(first, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("alla chiusura il fuoco torna a chi l'aveva", async () => {
    const dialog = open();
    expect(document.activeElement).not.toBe(opener);
    action(dialog.element, "no").click();
    expect(document.activeElement).toBe(opener);
    await dialog.result;
  });
});

describe("la risposta", () => {
  it("è il valore dell'azione scelta", async () => {
    const dialog = open();
    action(dialog.element, "yes").click();
    await expect(dialog.result).resolves.toBe("yes");
    expect(scrim()).toBeNull();
  });

  it("è dismissValue per Esc", async () => {
    const dialog = open();
    expect(press(document.activeElement!, "Escape").defaultPrevented).toBe(true);
    await expect(dialog.result).resolves.toBe("dismissed");
    expect(scrim()).toBeNull();
  });

  it("è dismissValue per un clic sul velo", async () => {
    const dialog = open();
    scrim().dispatchEvent(pointer("pointerdown"));
    scrim().click();
    await expect(dialog.result).resolves.toBe("dismissed");
  });

  it("è dismissValue quando si chiude la vita che lo possiede", async () => {
    const dialog = open();
    life.close();
    await expect(dialog.result).resolves.toBe("dismissed");
    expect(scrim()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("è dismissValue su una vita già chiusa: non resta mai appesa", async () => {
    life.close();
    const dialog = open();
    await expect(dialog.result).resolves.toBe("dismissed");
    expect(scrim()).toBeNull();
  });

  it("è il valore passato a close()", async () => {
    const dialog = open();
    dialog.close("yes");
    await expect(dialog.result).resolves.toBe("yes");
  });

  it("vale una volta: ciò che arriva dopo non la cambia", async () => {
    const dialog = open();
    const yes = action(dialog.element, "yes");
    dialog.close("no");
    yes.click();
    dialog.close("yes");
    life.close();
    await expect(dialog.result).resolves.toBe("no");
  });

  it("un clic dentro il dialogo non è una risposta", async () => {
    const dialog = open({ description: "testo" });
    const settled = vi.fn();
    void dialog.result.then(settled);
    dialog.element.querySelector<HTMLElement>(".kit-dialog-description")!.click();
    dialog.element.click();
    expect(scrim()).not.toBeNull();
    // Il velo ancora in piedi non basta: la promessa non deve essersi chiusa.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  // Nel browser il pulsante col fuoco si preme a ogni ripetizione di Invio:
  // quella dell'Invio che ha aperto il dialogo gli risponderebbe da sola.
  it("un tasto tenuto premuto non arriva ai pulsanti delle azioni", () => {
    const dialog = open();
    const focused = action(dialog.element, "yes");
    expect(document.activeElement).toBe(focused);
    for (const key of ["Enter", " "]) {
      expect(press(focused, key, { repeat: true }).defaultPrevented, `«${key}» ripetuto`).toBe(true);
      expect(press(focused, key).defaultPrevented, `«${key}» premuto`).toBe(false);
    }
    expect(scrim()).not.toBeNull();
  });

  it("in un campo del corpo la ripetizione resta scrittura, ed Esc ripetuto chiude", () => {
    const body = document.createElement("div");
    const field = document.createElement("input");
    body.append(field);
    open({ body });
    expect(press(field, " ", { repeat: true }).defaultPrevented).toBe(false);
    press(field, "Escape", { repeat: true });
    expect(scrim()).toBeNull();
  });

  it("un gesto nato nel dialogo e finito sul velo non è una risposta", () => {
    const dialog = open();
    // Una selezione trascinata fuori: si preme dentro, il clic cade sul velo.
    dialog.element.dispatchEvent(pointer("pointerdown"));
    scrim().click();
    expect(scrim()).not.toBeNull();
    // Il gesto dopo, tutto sul velo, torna a valere.
    scrim().dispatchEvent(pointer("pointerdown"));
    scrim().click();
    expect(scrim()).toBeNull();
  });
});

describe("più dialoghi", () => {
  it("Esc è solo di quello in cima", async () => {
    const below = open();
    const above = open({ title: "Sicuro?" });
    press(document.activeElement!, "Escape");
    await expect(above.result).resolves.toBe("dismissed");
    expect(document.querySelectorAll(".kit-dialog").length).toBe(1);
    // Il fuoco torna nel dialogo di sotto, che ora comanda.
    expect(below.element.contains(document.activeElement)).toBe(true);
    press(document.activeElement!, "Escape");
    await expect(below.result).resolves.toBe("dismissed");
    expect(document.activeElement).toBe(opener);
  });

  it("chiudere quello di sotto non chiude quello di sopra", async () => {
    const below = open();
    const above = open({ title: "Sicuro?" });
    below.close("no");
    await expect(below.result).resolves.toBe("no");
    expect(above.element.isConnected).toBe(true);
    above.close("yes");
    await expect(above.result).resolves.toBe("yes");
  });
});

describe("un popover dentro un dialogo", () => {
  it("prende Esc prima del dialogo, e si chiude con lui", async () => {
    const dialog = open();
    const anchor = action(dialog.element, "no");
    const content = document.createElement("button");
    const reasons: string[] = [];
    const popover = openPopover({
      anchor,
      content,
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    expect(popover.element.dataset.layer).toBe("modal");
    // Un gesto nel popover non cade sul velo.
    content.dispatchEvent(pointer("pointerdown"));
    content.click();
    expect(scrim()).not.toBeNull();

    press(document.activeElement!, "Escape");
    expect(reasons).toEqual(["escape"]);
    expect(scrim()).not.toBeNull();

    const again = openPopover({
      anchor,
      content: document.createElement("button"),
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    dialog.close("yes");
    expect(again.closed).toBe(true);
    expect(reasons).toEqual(["escape", "parent"]);
    await expect(dialog.result).resolves.toBe("yes");
    expect(document.activeElement).toBe(opener);
  });

  it("un dialogo aperto da un popover non muore con lui", async () => {
    const menu = document.createElement("button");
    const popover = openPopover({ anchor: opener, content: menu, lifetime: life });
    const dialog = open();
    // Il fuoco nel dialogo non è «fuori» per il popover da cui è nato.
    expect(popover.closed).toBe(false);
    popover.close();
    expect(dialog.element.isConnected).toBe(true);
    dialog.close("yes");
    await expect(dialog.result).resolves.toBe("yes");
  });
});

describe("lo smontaggio", () => {
  it("aperto e chiuso molte volte non lascia ascolti su finestra e documento", async () => {
    const live = listenerLedger(window, document);
    const ways: ((dialog: ReturnType<typeof open>) => void)[] = [
      (dialog) => action(dialog.element, "yes").click(),
      () => press(document.activeElement!, "Escape"),
      () => scrim().click(),
      (dialog) => dialog.close("no"),
    ];
    for (const way of ways) {
      const dialog = open();
      expect(live()).toBeGreaterThan(0);
      way(dialog);
      await dialog.result;
      expect(live()).toBe(0);
    }
    const last = open();
    life.close();
    await last.result;
    expect(live()).toBe(0);
    expect(document.querySelectorAll(".kit-dialog-scrim").length).toBe(0);
    expect(document.activeElement).toBe(opener);
  });

  it("dopo la risposta i pulsanti non rispondono più", async () => {
    const dialog = open();
    const yes = action(dialog.element, "yes");
    dialog.close("no");
    const second = open();
    yes.click();
    expect(second.element.isConnected).toBe(true);
    second.close("no");
    await second.result;
  });
});

describe("il movimento", () => {
  it("entra con la molla ampia sul dialogo e una dissolvenza sul velo", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const dialog = open();
    const byElement = new Map(driver.plays.map((play) => [play.el, play]));
    const veil = byElement.get(scrim())!;
    expect(veil.keyframes[0].opacity).toBe(0);
    expect(veil.keyframes[0].transform).toBeUndefined();
    expect(veil.timing.duration).toBe(220);
    const box = byElement.get(dialog.element)!;
    expect(String(box.keyframes[0].transform)).toContain("scale(0.94");
    expect(String(box.keyframes[0].transform)).toContain("translate(0px, 16px)");
    expect(activeMotions()).toBe(2);
    // A metà strada il dialogo è ancora in viaggio; poi non resta niente.
    driver.advance(100);
    expect(activeMotions()).toBeGreaterThan(0);
    driver.advance(3000);
    expect(activeMotions()).toBe(0);
    expect(dialog.element.style.transform).toBe("");
  });

  it("chiuso a metà entrata non lascia corse vive", async () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const dialog = open();
    driver.advance(32);
    dialog.close("no");
    expect(activeMotions()).toBe(0);
    await dialog.result;
  });

  it("nel livello ridotto resta la dissolvenza del velo e il dialogo non si muove", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    const dialog = open();
    expect(driver.plays.map((play) => play.el)).toEqual([scrim()]);
    expect(driver.plays[0].keyframes.every((frame) => frame.transform === undefined)).toBe(true);
    driver.advance(1000);
    expect(activeMotions()).toBe(0);
    dialog.close("no");
  });
});

describe("la conferma", () => {
  it("un no tiene aperto il dialogo, un sì lo chiude con l'azione", async () => {
    const asked: Answer[] = [];
    let allow = false;
    const dialog = open({
      confirm: (value) => {
        asked.push(value);
        return allow;
      },
    });
    action(dialog.element, "yes").click();
    expect(dialog.element.isConnected).toBe(true);
    allow = true;
    action(dialog.element, "yes").click();
    expect(asked).toEqual(["yes", "yes"]);
    await expect(dialog.result).resolves.toBe("yes");
  });

  it("una risposta in viaggio occupa il dialogo e non lascia premere due volte", async () => {
    let answer!: (yes: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((done) => (answer = done)));
    const dialog = open({ confirm });
    action(dialog.element, "yes").click();
    expect(dialog.element.getAttribute("aria-busy")).toBe("true");
    action(dialog.element, "no").click();
    expect(confirm).toHaveBeenCalledTimes(1);
    answer(false);
    await Promise.resolve();
    expect(dialog.element.hasAttribute("aria-busy")).toBe(false);
    expect(dialog.element.isConnected).toBe(true);
    action(dialog.element, "no").click();
    answer(true);
    await expect(dialog.result).resolves.toBe("no");
  });

  it("Esc non chiede", async () => {
    const confirm = vi.fn(() => false);
    const dialog = open({ confirm });
    press(dialog.element, "Escape");
    await expect(dialog.result).resolves.toBe("dismissed");
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("il modulo", () => {
  it("Invio in un campo preme l'azione di `submit`, non in una casella", async () => {
    const body = document.createElement("div");
    const input = document.createElement("input");
    const check = document.createElement("input");
    check.type = "checkbox";
    body.append(input, check);
    const dialog = open({ body, submit: "yes", className: "prova" });
    expect(dialog.element.classList.contains("prova")).toBe(true);
    check.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(dialog.element.isConnected).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await expect(dialog.result).resolves.toBe("yes");
  });
});
