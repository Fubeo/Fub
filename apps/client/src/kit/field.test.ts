// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessibleName, checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { textField, type TextFieldOptions } from "./field";
import { press } from "./testing";

let life: Lifetime;
let inputs: string[];
let submits: string[];

function field(extra: Partial<TextFieldOptions> = {}) {
  const made = textField({
    label: "Nome",
    onInput: (value) => inputs.push(value),
    onSubmit: (value) => submits.push(value),
    ...extra,
  });
  document.body.append(made.element);
  return made;
}

/// Scrive come farebbe l'utente: il valore, poi l'evento.
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const clear = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(".kit-field-clear");

beforeEach(() => {
  life = openLifetime();
  inputs = [];
  submits = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

describe("il nome", () => {
  it("è una label esplicita legata al campo col suo for", () => {
    const made = field();
    const label = made.element.querySelector("label")!;
    expect(label.textContent).toBe("Nome");
    expect(label.htmlFor).toBe(made.input.id);
    expect(made.input.id).not.toBe("");
    expect(label.className).toBe("kit-field-label");
    expect(accessibleName(made.input)).toBe("Nome");
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("può non vedersi, ma c'è", () => {
    const made = field({ labelHidden: true });
    const label = made.element.querySelector("label")!;
    expect(label.classList.contains("sr-only")).toBe(true);
    expect(label.htmlFor).toBe(made.input.id);
    expect(accessibleName(made.input)).toBe("Nome");
  });

  it("due campi hanno due id", () => {
    expect(field().input.id).not.toBe(field().input.id);
  });
});

describe("il campo", () => {
  it("porta segnaposto, valore iniziale e icona", () => {
    const made = field({ placeholder: "Senza titolo", value: "Diario", icon: "search" });
    expect(made.input.type).toBe("text");
    expect(made.input.placeholder).toBe("Senza titolo");
    expect(made.value()).toBe("Diario");
    expect(made.element.querySelector(".kit-field-icon svg")).not.toBeNull();
    expect(made.element.classList.contains("kit-field")).toBe(true);
    expect(made.input.closest(".kit-field-box")).not.toBeNull();
  });

  it("avvisa a ogni modifica dell'utente", () => {
    const made = field();
    type(made.input, "a");
    type(made.input, "ab");
    expect(inputs).toEqual(["a", "ab"]);
  });

  it("setValue scrive senza avvisare: è il programma, non l'utente", () => {
    const made = field();
    made.setValue("scritto da fuori");
    expect(made.value()).toBe("scritto da fuori");
    expect(inputs).toEqual([]);
  });

  it("Invio consegna il valore", () => {
    const made = field({ value: "Diario" });
    expect(press(made.input, "Enter").defaultPrevented).toBe(true);
    expect(submits).toEqual(["Diario"]);
  });

  it("Invio che conferma una composizione non consegna", () => {
    const made = field({ value: "にほん" });
    expect(press(made.input, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(submits).toEqual([]);
  });

  it("senza onSubmit Invio passa oltre", () => {
    const made = field({ onSubmit: undefined });
    expect(press(made.input, "Enter").defaultPrevented).toBe(false);
  });

  it("focus() porta il fuoco nel campo", () => {
    const made = field();
    made.focus();
    expect(document.activeElement).toBe(made.input);
  });
});

describe("il pulsante che svuota", () => {
  it("non c'è se non lo si chiede", () => {
    expect(clear(field().element)).toBeNull();
  });

  it("ha il nome che gli dà chi lo chiede, e si vede solo se c'è qualcosa da svuotare", () => {
    const made = field({ clearable: { label: "Svuota il campo" } });
    const button = clear(made.element)!;
    expect(button.type).toBe("button");
    expect(accessibleName(button)).toBe("Svuota il campo");
    expect(button.hidden).toBe(true);
    type(made.input, "x");
    expect(button.hidden).toBe(false);
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
    type(made.input, "");
    expect(button.hidden).toBe(true);
    made.setValue("da fuori");
    expect(button.hidden).toBe(false);
  });

  it("parte visibile se il campo nasce pieno", () => {
    const made = field({ value: "Diario", clearable: { label: "Svuota" } });
    expect(clear(made.element)!.hidden).toBe(false);
  });

  it("svuota, avvisa, si nasconde e riporta il fuoco nel campo", () => {
    const made = field({ value: "Diario", clearable: { label: "Svuota" } });
    const button = clear(made.element)!;
    button.click();
    expect(made.value()).toBe("");
    expect(inputs).toEqual([""]);
    expect(button.hidden).toBe(true);
    expect(document.activeElement).toBe(made.input);
    expect(submits).toEqual([]);
  });
});

describe("lo smontaggio", () => {
  it("con una vita, chiuderla scioglie gli ascolti", () => {
    const made = field({ value: "Diario", clearable: { label: "Svuota" }, lifetime: life });
    type(made.input, "Diario 2");
    expect(inputs).toEqual(["Diario 2"]);
    life.close();
    type(made.input, "Diario 3");
    press(made.input, "Enter");
    clear(made.element)!.click();
    expect(inputs).toEqual(["Diario 2"]);
    expect(submits).toEqual([]);
    expect(made.value()).toBe("Diario 3");
  });

  it("senza una vita gli ascolti stanno sugli elementi, non su finestra o documento", () => {
    const onDocument = vi.spyOn(document, "addEventListener");
    const onWindow = vi.spyOn(window, "addEventListener");
    field({ clearable: { label: "Svuota" } });
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
