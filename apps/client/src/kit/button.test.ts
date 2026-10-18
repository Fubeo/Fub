// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESS_SCALE, createManualDriver, setMotionDriver } from "../moto";
import { accessibleName, checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { resetTooltips } from "../ui/tooltip";
import { iconButton, labelButton, setPressed, textButton } from "./button";
import { pointer } from "./testing";

let life: Lifetime;

const tooltip = (): HTMLElement | null => document.getElementById("fub-tooltip");

beforeEach(() => {
  life = openLifetime();
});

afterEach(() => {
  life.close();
  resetTooltips();
  setMotionDriver(null);
  document.body.replaceChildren();
});

describe("iconButton", () => {
  it("è un pulsante con la sua icona e un nome che c'è sempre", () => {
    const button = iconButton({ icon: "search", label: "Cerca", onPress: () => {} });
    document.body.append(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.className).toBe("kit-button kit-button--icon");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Cerca");
    expect(accessibleName(button)).toBe("Cerca");
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("tiene il nome anche con un'icona che non esiste", () => {
    const button = iconButton({ icon: "non-esiste", label: "Mistero", onPress: () => {} });
    expect(button.querySelector("svg")).toBeNull();
    expect(accessibleName(button)).toBe("Mistero");
  });

  it("non usa il title nativo: il suggerimento è quello della shell", () => {
    const button = iconButton({ icon: "search", label: "Cerca", onPress: () => {} });
    document.body.append(button);
    expect(button.hasAttribute("title")).toBe(false);
    button.focus();
    expect(tooltip()?.textContent).toBe("Cerca");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip()!.id);
  });

  it("con un accordo lo mostra nel suggerimento e lo dichiara a chi ascolta", () => {
    const button = iconButton({
      icon: "search",
      label: "Cerca",
      chord: { display: "Ctrl+K", aria: "Control+K" },
      onPress: () => {},
    });
    document.body.append(button);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    // Il nome resta pulito: l'accordo è un'aggiunta, non parte del nome.
    expect(button.getAttribute("aria-label")).toBe("Cerca");
    button.focus();
    expect(tooltip()?.textContent).toBe("Cerca (Ctrl+K)");
  });

  it("una sequenza si legge ma non si dichiara: l'attributo non la sa dire", () => {
    const button = iconButton({
      icon: "search",
      label: "Cerca",
      chord: { display: "Ctrl+K D" },
      onPress: () => {},
    });
    document.body.append(button);
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
    button.focus();
    expect(tooltip()?.textContent).toBe("Cerca (Ctrl+K D)");
  });

  it("labelButton aggiorna nome, suggerimento e accordo, e toglie quello che non c'è più", () => {
    const button = iconButton({
      icon: "search",
      label: "Cerca",
      chord: { display: "Ctrl+K", aria: "Control+K" },
      onPress: () => {},
    });
    document.body.append(button);
    labelButton(button, "Search");
    expect(button.getAttribute("aria-label")).toBe("Search");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
    button.focus();
    expect(tooltip()?.textContent).toBe("Search");
  });

  it("è un interruttore solo se ha uno stato", () => {
    const plain = iconButton({ icon: "pin", label: "Fissa", onPress: () => {} });
    expect(plain.hasAttribute("aria-pressed")).toBe(false);
    const toggle = iconButton({ icon: "pin", label: "Fissa", pressed: false, onPress: () => {} });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    setPressed(toggle, true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("chiama onPress al clic, cioè anche con Invio e Spazio", () => {
    const onPress = vi.fn();
    const button = iconButton({ icon: "search", label: "Cerca", onPress });
    button.click();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
  });

  it("con una vita, chiuderla scioglie clic, pressione e suggerimento", () => {
    setMotionDriver(createManualDriver());
    const onPress = vi.fn();
    const button = iconButton({ icon: "search", label: "Cerca", onPress, lifetime: life });
    document.body.append(button);
    button.dispatchEvent(pointer("pointerdown"));
    expect(button.style.getPropertyValue("scale")).toBe(String(PRESS_SCALE));
    button.click();
    expect(onPress).toHaveBeenCalledTimes(1);

    life.close();
    expect(button.style.getPropertyValue("scale")).toBe("");
    button.click();
    button.dispatchEvent(pointer("pointerdown"));
    button.focus();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button.style.getPropertyValue("scale")).toBe("");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("senza una vita non cede alla pressione: non c'è chi la scioglierebbe", () => {
    setMotionDriver(createManualDriver());
    const button = iconButton({ icon: "search", label: "Cerca", onPress: () => {} });
    document.body.append(button);
    button.dispatchEvent(pointer("pointerdown"));
    expect(button.style.getPropertyValue("scale")).toBe("");
  });
});

describe("textButton", () => {
  it("ha il suo testo come nome, e la specie in data-kind", () => {
    const plain = textButton({ label: "Annulla", onPress: () => {} });
    const danger = textButton({ label: "Elimina", kind: "danger", onPress: () => {} });
    document.body.append(plain, danger);
    expect(plain.className).toBe("kit-button");
    expect(plain.type).toBe("button");
    expect(plain.dataset.kind).toBe("normal");
    expect(danger.dataset.kind).toBe("danger");
    expect(accessibleName(danger)).toBe("Elimina");
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("mette l'icona prima del testo, nascosta a chi ascolta", () => {
    const button = textButton({ label: "Cerca", icon: "search", onPress: () => {} });
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(button.textContent).toBe("Cerca");
  });

  it("chiama onPress, e con una vita smette quando lei si chiude", () => {
    const onPress = vi.fn();
    const button = textButton({ label: "Salva", kind: "primary", onPress, lifetime: life });
    button.click();
    life.close();
    button.click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
