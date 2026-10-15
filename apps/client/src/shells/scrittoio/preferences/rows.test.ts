// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { keepFocus, setAttr, setText, writeThrough } from "./rows";

let lifetime: Lifetime;
let root: HTMLElement;
let inside: HTMLButtonElement;
let outside: HTMLButtonElement;
let hiddenField: HTMLInputElement;

function button(id: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.id = id;
  return node;
}

/// Ciò che la vista fa al controllo mentre scrive: lo spegne — e il fuoco se
/// ne va, annunciato o no secondo il browser — poi sostituisce la riga, e il
/// nodo torna in una riga nuova. Il fuoco resta sul documento.
function takenByTheView(node: HTMLButtonElement): void {
  const parent = node.parentElement!;
  node.disabled = true;
  node.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  node.remove();
  node.disabled = false;
  parent.append(node);
}

beforeEach(() => {
  lifetime = openLifetime();
  root = document.createElement("div");
  inside = button("inside");
  root.append(inside);
  outside = button("outside");
  const shelf = document.createElement("div");
  shelf.hidden = true;
  hiddenField = document.createElement("input");
  hiddenField.id = "hidden-field";
  shelf.append(hiddenField);
  document.body.replaceChildren(root, outside, shelf);
});

afterEach(() => lifetime.close());

describe("il fuoco tenuto", () => {
  it("torna al nodo a cui la vista l'ha tolto", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    takenByTheView(inside);
    expect(document.activeElement).not.toBe(inside);

    restore();
    expect(document.activeElement).toBe(inside);
  });

  it("non torna se la persona è andata altrove", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    outside.focus();
    outside.blur();

    restore();
    expect(document.activeElement).not.toBe(inside);
  });

  it("non torna dopo un clic sul vuoto, col nodo ancora al suo posto", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    inside.blur();

    restore();
    expect(document.activeElement).not.toBe(inside);
  });

  it("non lo strappa a chi lo ha preso nel frattempo", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    takenByTheView(inside);
    // Un fuoco messo da codice, senza che il documento l'abbia annunciato.
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => outside });
    try {
      restore();
    } finally {
      delete (document as unknown as Record<string, unknown>).activeElement;
    }
    expect(document.activeElement).not.toBe(inside);
  });

  it("un controllo nascosto non è un altrove: il fuoco finito lì torna indietro", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    takenByTheView(inside);
    hiddenField.focus();
    expect(document.activeElement).toBe(hiddenField);

    restore();
    expect(document.activeElement).toBe(inside);
  });

  it("un ripiego dichiarato vale come un controllo nascosto", () => {
    const restore = keepFocus(lifetime, root, (target) => target === outside);
    inside.focus();
    takenByTheView(inside);
    outside.focus();

    restore();
    expect(document.activeElement).toBe(inside);
  });

  it("un nodo spento o staccato non lo riprende", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    takenByTheView(inside);
    inside.disabled = true;
    restore();
    expect(document.activeElement).not.toBe(inside);

    inside.disabled = false;
    inside.remove();
    restore();
    expect(document.activeElement).not.toBe(inside);
  });

  it("chiusa la vita non ricorda più niente", () => {
    const restore = keepFocus(lifetime, root);
    inside.focus();
    takenByTheView(inside);
    lifetime.close();

    restore();
    expect(document.activeElement).not.toBe(inside);
  });
});

describe("le scritture che non svegliano nessuno", () => {
  it("un attributo o un testo uguale non si riscrive", async () => {
    const node = document.createElement("div");
    document.body.append(node);
    setAttr(node, "data-x", "1");
    setText(node, "uno");
    let seen = 0;
    const observer = new MutationObserver((records) => {
      seen += records.length;
    });
    observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });

    setAttr(node, "data-x", "1");
    setAttr(node, "data-y", null);
    setText(node, "uno");
    await Promise.resolve();
    expect(seen).toBe(0);

    setAttr(node, "data-x", "2");
    setAttr(node, "data-x", null);
    setText(node, "due");
    await Promise.resolve();
    observer.disconnect();
    expect(seen).toBeGreaterThanOrEqual(3);
    expect(node.hasAttribute("data-x")).toBe(false);
    expect(node.textContent).toBe("due");
  });

  it("il numero parte dalla strada della riga: valore e `change` che risale", () => {
    const field = document.createElement("input");
    field.type = "number";
    const seen: string[] = [];
    document.body.append(field);
    document.body.addEventListener("change", (event) => seen.push((event.target as HTMLInputElement).value), { once: true });

    writeThrough(field, 3);
    expect(seen).toEqual(["3"]);
  });
});
