// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const system = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("../../host/dialog", () => ({ confirm: system.confirm }));

import { t } from "../../i18n/strings";
import { openLayers } from "../../kit/layers";
import { listenerLedger, pointer, press } from "../../kit/testing";
import { confirm, type ConfirmOptions } from "../../platform/confirm";
import { checkAccessibility, formatIssues } from "../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountConfirm } from "./confirm";

const ASK: ConfirmOptions = { title: "Esportare il rapporto?", okLabel: "Esporta" };
const DELETE: ConfirmOptions = { title: "Elimina il workspace", okLabel: "Elimina", danger: true };

const dialogs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".kit-dialog")];
const scrim = (): HTMLElement => document.querySelector<HTMLElement>(".kit-dialog-scrim")!;
const action = (id: "confirm" | "cancel"): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`.kit-dialog [data-action="${id}"]`)!;

let life: Lifetime;
let opener: HTMLButtonElement;

beforeEach(() => {
  system.confirm.mockReset();
  system.confirm.mockResolvedValue(true);
  life = openLifetime();
  mountConfirm(life);
  opener = document.createElement("button");
  opener.textContent = "elimina";
  document.body.append(opener);
  opener.focus();
});

afterEach(() => {
  life.close();
  expect(openLayers()).toBe(0);
  expect(dialogs()).toHaveLength(0);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("la forma", () => {
  it("è un dialogo col titolo, il messaggio e due azioni: prima il no, poi il sì", () => {
    void confirm("Esportare esattamente questo rapporto?", { ...ASK, cancelLabel: "Non ora" });
    const [dialog] = dialogs();
    expect(dialog!.getAttribute("role")).toBe("dialog");
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)!.textContent).toBe(
      "Esportare il rapporto?",
    );
    expect(document.getElementById(dialog!.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Esportare esattamente questo rapporto?",
    );
    const buttons = [...dialog!.querySelectorAll<HTMLButtonElement>(".kit-dialog-actions button")];
    expect(buttons.map((button) => button.dataset.action)).toEqual(["cancel", "confirm"]);
    expect(buttons.map((button) => button.textContent)).toEqual(["Non ora", "Esporta"]);
    expect(buttons.map((button) => button.dataset.kind)).toEqual(["normal", "primary"]);
  });

  it("senza un'etichetta per il no usa «Annulla» della lingua", () => {
    void confirm("Procedo?", ASK);
    expect(action("cancel").textContent).toBe(t("app.cancel"));
  });

  it("con danger il sì è l'azione di pericolo", () => {
    void confirm("Eliminare il workspace «Sera»?", DELETE);
    expect(action("confirm").dataset.kind).toBe("danger");
    expect(action("cancel").dataset.kind).toBe("normal");
  });

  it("supera il controllo di accessibilità della shell", () => {
    void confirm("Eliminare il workspace «Sera»?", DELETE);
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("non passa dal dialogo di sistema", async () => {
    const question = confirm("Procedo?", ASK);
    action("confirm").click();
    await question;
    expect(system.confirm).not.toHaveBeenCalled();
  });
});

describe("il fuoco", () => {
  it("parte dal sì in una domanda normale", () => {
    void confirm("Procedo?", ASK);
    expect(document.activeElement).toBe(action("confirm"));
  });

  it("parte dal no in una domanda di pericolo", () => {
    void confirm("Eliminare il workspace «Sera»?", DELETE);
    expect(document.activeElement).toBe(action("cancel"));
  });

  it("resta nel dialogo: Tab gira fra le due azioni", () => {
    void confirm("Eliminare il workspace «Sera»?", DELETE);
    expect(press(action("cancel"), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action("confirm"));
    expect(press(action("confirm"), "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action("cancel"));
  });

  it("alla risposta torna a chi l'aveva", async () => {
    for (const answer of ["confirm", "cancel"] as const) {
      const question = confirm("Eliminare il workspace «Sera»?", DELETE);
      expect(document.activeElement).not.toBe(opener);
      action(answer).click();
      await question;
      expect(document.activeElement).toBe(opener);
    }
  });
});

describe("la risposta", () => {
  it("è sì solo dal pulsante che lo dice", async () => {
    const question = confirm("Eliminare il workspace «Sera»?", DELETE);
    action("confirm").click();
    await expect(question).resolves.toBe(true);
  });

  it("è no dal pulsante che lo dice", async () => {
    const question = confirm("Eliminare il workspace «Sera»?", DELETE);
    action("cancel").click();
    await expect(question).resolves.toBe(false);
  });

  it("è no per Esc", async () => {
    const question = confirm("Eliminare il workspace «Sera»?", DELETE);
    expect(press(document.activeElement!, "Escape").defaultPrevented).toBe(true);
    await expect(question).resolves.toBe(false);
  });

  it("è no per un clic sul velo", async () => {
    const question = confirm("Eliminare il workspace «Sera»?", DELETE);
    scrim().dispatchEvent(pointer("pointerdown"));
    scrim().click();
    await expect(question).resolves.toBe(false);
  });

  it("è no quando la shell si smonta a domanda aperta, e il fuoco torna dov'era", async () => {
    const question = confirm("Eliminare il workspace «Sera»?", DELETE);
    life.close();
    await expect(question).resolves.toBe(false);
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
    // Smontata la shell, la domanda dopo torna al sistema.
    await expect(confirm("Procedo?", ASK)).resolves.toBe(true);
    expect(system.confirm).toHaveBeenCalledOnce();
    expect(dialogs()).toHaveLength(0);
  });

  // Nel browser il pulsante col fuoco si preme a ogni ripetizione di Invio:
  // quella dell'Invio che ha aperto la domanda le risponderebbe da sola. Qui
  // si prova che la ripetizione viene fermata prima del pulsante, e che il
  // tasto premuto apposta passa.
  it("un tasto tenuto premuto non arriva ai pulsanti", () => {
    void confirm("Procedo?", ASK);
    const focused = document.activeElement!;
    expect(focused).toBe(action("confirm"));
    for (const key of ["Enter", " "]) {
      expect(press(focused, key, { repeat: true }).defaultPrevented, `«${key}» ripetuto`).toBe(true);
      expect(press(focused, key).defaultPrevented, `«${key}» premuto`).toBe(false);
    }
    // Gli altri tasti restano com'erano: Esc ripetuto chiude lo stesso.
    expect(dialogs()).toHaveLength(1);
    press(focused, "Escape", { repeat: true });
    expect(dialogs()).toHaveLength(0);
  });

  it("un clic dentro il dialogo non è una risposta", () => {
    void confirm("Eliminare il workspace «Sera»?", DELETE);
    const [dialog] = dialogs();
    dialog!.querySelector<HTMLElement>(".kit-dialog-description")!.click();
    dialog!.click();
    expect(dialogs()).toHaveLength(1);
  });
});

describe("due domande insieme", () => {
  it("si vedono una alla volta, nell'ordine in cui sono arrivate", async () => {
    const first = confirm("Rimuovere il segnalibro «Uno»?", DELETE);
    const second = confirm("Rimuovere il segnalibro «Due»?", DELETE);
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain("«Uno»");

    action("cancel").click();
    await expect(first).resolves.toBe(false);
    // Il no alla prima non ha risposto anche alla seconda: è lì, da leggere.
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain("«Due»");
    expect(document.activeElement).toBe(action("cancel"));

    action("confirm").click();
    await expect(second).resolves.toBe(true);
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it("smontata la shell hanno tutte «no», anche quella mai vista", async () => {
    const questions = [confirm("Uno?", DELETE), confirm("Due?", DELETE)];
    life.close();
    await expect(Promise.all(questions)).resolves.toEqual([false, false]);
    expect(dialogs()).toHaveLength(0);
  });
});

describe("lo smontaggio", () => {
  it("aperta e chiusa in ogni modo non lascia nodi né ascolti", async () => {
    const live = listenerLedger(window, document);
    const ways: (() => void)[] = [
      () => action("confirm").click(),
      () => action("cancel").click(),
      () => press(document.activeElement!, "Escape"),
      () => {
        scrim().dispatchEvent(pointer("pointerdown"));
        scrim().click();
      },
    ];
    for (const way of ways) {
      const question = confirm("Eliminare il workspace «Sera»?", DELETE);
      expect(live()).toBeGreaterThan(0);
      way();
      await question;
      expect(live()).toBe(0);
      expect(document.querySelectorAll(".kit-dialog-scrim")).toHaveLength(0);
      expect(openLayers()).toBe(0);
    }
    const last = confirm("Eliminare il workspace «Sera»?", DELETE);
    life.close();
    await last;
    expect(live()).toBe(0);
    expect(document.querySelectorAll(".kit-dialog-scrim")).toHaveLength(0);
    expect(document.body.children).toHaveLength(1);
  });
});
