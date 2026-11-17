// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { listenerLedger, press } from "./testing";
import { rovingToolbar, type RovingToolbar } from "./toolbar-keys";

let life: Lifetime;

beforeEach(() => {
  life = openLifetime();
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

/// Una barra di due gruppi: tre pulsanti, un elenco e un campo di testo, più
/// «…» in fondo. La barra della PDF avrà i suoi elenchi e i suoi campi.
function bar(options: { onEscape?: (event: KeyboardEvent) => void } = {}) {
  const element = document.createElement("div");
  element.setAttribute("role", "toolbar");
  const first = document.createElement("div");
  const second = document.createElement("div");
  const button = (name: string) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = name;
    return control;
  };
  const a = button("A");
  const b = button("B");
  const c = button("C");
  const list = document.createElement("select");
  for (const name of ["Uno", "Due"]) {
    const option = document.createElement("option");
    option.textContent = name;
    list.append(option);
  }
  const field = document.createElement("input");
  field.type = "text";
  field.value = "testo";
  const more = button("…");
  first.append(a, b, c);
  second.append(list, field);
  element.append(first, second, more);
  document.body.append(element);
  const controls = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>("button, select, input")];
  const keys = rovingToolbar(element, { controls, onEscape: options.onEscape }, life);
  keys.refresh();
  return { element, first, second, a, b, c, list, field, more, keys, controls };
}

const tabStops = (controls: readonly HTMLElement[]) => controls.filter((control) => control.tabIndex === 0);

describe("rovingToolbar", () => {
  it("ha un solo punto di tabulazione, sul primo controllo", () => {
    const { a, controls, keys } = bar();
    expect(tabStops(controls())).toEqual([a]);
    expect(keys.current).toBe(a);
  });

  it("le frecce passano al vicino e il punto di tabulazione le segue", () => {
    const { a, b, controls } = bar();
    a.focus();
    const event = press(a, "ArrowRight");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    expect(tabStops(controls())).toEqual([b]);
    press(b, "ArrowLeft");
    expect(document.activeElement).toBe(a);
    expect(tabStops(controls())).toEqual([a]);
  });

  it("destra e sinistra girano ai capi, Home e Fine vanno al primo e all'ultimo", () => {
    const { a, b, more } = bar();
    a.focus();
    press(a, "ArrowLeft");
    expect(document.activeElement, "prima del primo, l'ultimo").toBe(more);
    press(more, "ArrowRight");
    expect(document.activeElement, "dopo l'ultimo, il primo").toBe(a);
    press(a, "End");
    expect(document.activeElement).toBe(more);
    press(more, "Home");
    expect(document.activeElement).toBe(a);
    b.focus();
    press(b, "Home");
    expect(document.activeElement).toBe(a);
  });

  it("salta i controlli spenti e quelli dentro un gruppo nascosto", () => {
    const { a, b, c, list, second, more, controls } = bar();
    b.disabled = true;
    a.focus();
    press(a, "ArrowRight");
    expect(document.activeElement, "lo spento si salta").toBe(c);
    c.setAttribute("aria-disabled", "true");
    a.focus();
    press(a, "ArrowRight");
    expect(document.activeElement, "anche aria-disabled si salta").toBe(list);
    second.hidden = true;
    a.focus();
    press(a, "ArrowRight");
    expect(document.activeElement, "il gruppo andato in «…» si salta").toBe(more);
    expect(tabStops(controls())).toEqual([more]);
  });

  it("su un elenco le frecce passano oltre, come su un pulsante", () => {
    const { c, list, field } = bar();
    list.focus();
    press(list, "ArrowRight");
    expect(document.activeElement).toBe(field);
    list.focus();
    press(list, "ArrowLeft");
    expect(document.activeElement).toBe(c);
  });

  it("in un campo di testo le frecce muovono il cursore, e passano oltre solo ai capi", () => {
    const { list, field, more } = bar();
    field.focus();
    field.setSelectionRange(2, 2);
    const inside = press(field, "ArrowRight");
    expect(inside.defaultPrevented, "il cursore si muove nel testo").toBe(false);
    expect(document.activeElement).toBe(field);
    expect(press(field, "ArrowLeft").defaultPrevented).toBe(false);
    field.setSelectionRange(1, 4);
    expect(press(field, "ArrowRight").defaultPrevented, "una selezione resta al campo").toBe(false);
    field.setSelectionRange(field.value.length, field.value.length);
    press(field, "ArrowRight");
    expect(document.activeElement, "in fondo al testo, il vicino").toBe(more);
    field.focus();
    field.setSelectionRange(0, 0);
    press(field, "ArrowLeft");
    expect(document.activeElement, "in testa al testo, il vicino").toBe(list);
  });

  it("in un campo di testo Home e Fine restano al campo", () => {
    const { field } = bar();
    field.focus();
    field.setSelectionRange(2, 2);
    expect(press(field, "Home").defaultPrevented).toBe(false);
    expect(press(field, "End").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("i tasti con un modificatore non sono della barra", () => {
    const { a } = bar();
    a.focus();
    expect(press(a, "ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(a, "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(a);
  });

  it("Escape va a chi usa la barra, e senza `onEscape` passa", () => {
    const escapes: string[] = [];
    const used = bar({ onEscape: () => escapes.push("esc") });
    used.b.focus();
    expect(press(used.b, "Escape").defaultPrevented).toBe(true);
    expect(escapes).toEqual(["esc"]);
    life.close();
    life = openLifetime();
    document.body.replaceChildren();
    const plain = bar();
    plain.a.focus();
    expect(press(plain.a, "Escape").defaultPrevented).toBe(false);
  });

  it("il fuoco che entra da un'altra via fa il corrente", () => {
    const { c, controls, keys } = bar();
    c.focus();
    expect(keys.current).toBe(c);
    expect(tabStops(controls())).toEqual([c]);
  });

  it("una barra che si ridisegna tiene un solo punto di tabulazione", () => {
    const { element, first, b, keys, controls } = bar();
    b.focus();
    expect(keys.current).toBe(b);
    // Il ridisegno toglie il corrente e mette pulsanti nuovi.
    const fresh = document.createElement("button");
    fresh.textContent = "Nuovo";
    first.replaceChildren(fresh);
    expect(keys.refresh()).toBe(fresh);
    expect(tabStops(controls())).toEqual([fresh]);
    // Un corrente che c'è ancora resta.
    const others = controls().filter((control) => control !== fresh);
    keys.focus(others[1]!);
    keys.refresh();
    expect(keys.current).toBe(others[1]);
    expect(tabStops(controls())).toHaveLength(1);
    // Una barra vuota non ha punto di tabulazione.
    element.replaceChildren();
    expect(keys.refresh()).toBeNull();
  });

  it("un corrente che si spegne cede il posto al primo raggiungibile", () => {
    const { a, b, keys, controls } = bar();
    keys.focus(b);
    b.disabled = true;
    expect(keys.refresh()).toBe(a);
    expect(tabStops(controls())).toEqual([a]);
  });

  it("chiusa la vita, non ascolta più niente", () => {
    const own = openLifetime();
    const element = document.createElement("div");
    const ledger = listenerLedger(element);
    const one = document.createElement("button");
    const two = document.createElement("button");
    element.append(one, two);
    document.body.append(element);
    const keys: RovingToolbar = rovingToolbar(element, { controls: () => [one, two] }, own);
    keys.refresh();
    own.close();
    expect(ledger()).toBe(0);
    one.focus();
    press(one, "ArrowRight");
    expect(document.activeElement).toBe(one);
  });
});
