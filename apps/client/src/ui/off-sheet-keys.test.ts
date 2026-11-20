// @vitest-environment happy-dom
//
// Il tasto col fuoco fuori dal foglio, dalla tastiera della shell: una
// lettera su una linguetta non entra nella nota (IMP-106), Ctrl+Z da un
// pulsante di un pannello del documento annulla nel documento attivo
// (IMP-119, IMP-120), un campo tiene il suo annulla.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetShellCommands } from "./commands";
import type { FieldHistoryStep } from "./field-history";
import { mountKeyboard } from "./keyboard";
import { openLifetime, type Lifetime } from "./lifetime";

let lifetimes: Lifetime[] = [];

beforeEach(() => resetShellCommands());
afterEach(() => {
  for (const life of lifetimes) life.close();
  lifetimes = [];
  document.body.replaceChildren();
  delete (navigator as { platform?: string }).platform;
});

/// Una finestra come quella della shell: il riquadro del documento con la
/// sua barra di Trova e sostituisci, l'ispettore con le linguette e una
/// scheda, la barra laterale che col documento non c'entra.
function shell(platform = "Linux x86_64", answer: boolean | null = true) {
  Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform });
  document.body.innerHTML = `
    <aside id="sidebar"><button id="tree">Albero</button></aside>
    <section class="pane">
      <div class="cm-content" contenteditable="true" id="sheet">testo</div>
      <form class="rich-findbar">
        <input type="text" id="find" value="voce">
        <button type="button" id="replace-all">Sostituisci tutto</button>
      </form>
    </section>
    <section id="right-pane">
      <div role="tablist">
        <button role="tab" id="links" tabindex="0">Collegamenti</button>
        <button role="tab" id="tags" tabindex="-1">Tag</button>
      </div>
      <div role="tabpanel">
        <button type="button" id="accept">Accetta</button>
        <input type="text" id="author" value="Ada">
        <select id="choice"><option>a</option><option>b</option></select>
      </div>
    </section>`;
  const steps: FieldHistoryStep[] = [];
  const life = openLifetime();
  lifetimes.push(life);
  mountKeyboard(life, () => {}, {
    owns: (target) => target.closest(".pane, #right-pane") !== null,
    history: (step) => {
      steps.push(step);
      return answer;
    },
  });
  const el = (id: string) => document.getElementById(id)!;
  return { steps, el };
}

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  if (target instanceof HTMLElement) target.focus();
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("una lettera col fuoco fuori dal foglio (IMP-106)", () => {
  it("su una linguetta dell'ispettore non arriva alla nota: il tasto si ferma", () => {
    const { el } = shell();
    expect(press(el("tags"), { key: "q" }).defaultPrevented).toBe(true);
    expect(press(el("tags"), { key: "Q", shiftKey: true }).defaultPrevented).toBe(true);
    // Neanche un Backspace o un Canc, che cancellerebbero dalla selezione.
    expect(press(el("tags"), { key: "Backspace" }).defaultPrevented).toBe(true);
    expect(press(el("tags"), { key: "Delete" }).defaultPrevented).toBe(true);
    // AltGr scrive un carattere anche lui.
    expect(press(el("tags"), { key: "@", ctrlKey: true, altKey: true, modifierAltGraph: true } as KeyboardEventInit).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el("tags"));
  });

  it("vale per ogni controllo che non scrive, anche fuori dai pannelli del documento", () => {
    const { el } = shell();
    expect(press(el("tree"), { key: "q" }).defaultPrevented).toBe(true);
    expect(press(el("accept"), { key: "a" }).defaultPrevented).toBe(true);
  });

  it("la linguetta tiene le sue frecce, Home e Fine; lo spazio e Invio restano del controllo", () => {
    const { el } = shell();
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", " ", "Enter", "Tab", "Escape"]) {
      expect(press(el("tags"), { key }).defaultPrevented, key).toBe(false);
    }
  });

  it("nel foglio, in un campo e in una tendina la lettera resta loro", () => {
    const { el } = shell();
    expect(press(el("sheet"), { key: "q" }).defaultPrevented).toBe(false);
    expect(press(el("find"), { key: "q" }).defaultPrevented).toBe(false);
    expect(press(el("author"), { key: "q" }).defaultPrevented).toBe(false);
    expect(press(el("choice"), { key: "b" }).defaultPrevented).toBe(false);
  });

  it("chi apre un campo al primo tasto (una cella) se lo tiene", () => {
    const { el } = shell();
    const cell = document.createElement("div");
    cell.tabIndex = 0;
    const editor = document.createElement("input");
    el("sheet").after(cell, editor);
    cell.addEventListener("keydown", () => editor.focus());
    expect(press(cell, { key: "7" }).defaultPrevented).toBe(false);
  });

  it("un tasto già preso da un gestore locale non si tocca, e i gesti con Ctrl passano", () => {
    const { el } = shell();
    el("tags").addEventListener("keydown", (event) => {
      if (event.key === "x") event.preventDefault();
    });
    expect(press(el("tags"), { key: "x" }).defaultPrevented).toBe(true);
    expect(press(el("tags"), { key: "c", ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

describe("un tasto della composizione (IME)", () => {
  it("resta del metodo d'immissione, anche col codice 229 di WebKit", () => {
    const { el, steps } = shell();
    expect(press(el("tags"), { key: "q", isComposing: true }).defaultPrevented).toBe(false);
    expect(press(el("tags"), { key: "q", keyCode: 229 }).defaultPrevented).toBe(false);
    expect(press(el("accept"), { key: "z", ctrlKey: true, keyCode: 229 }).defaultPrevented).toBe(false);
    expect(steps).toEqual([]);
    expect(press(el("tags"), { key: "q" }).defaultPrevented).toBe(true);
  });
});

describe("Ctrl+Z col fuoco su un pulsante di un pannello del documento", () => {
  it("dopo Sostituisci tutto, dalla barra annulla e ripete nel documento attivo (IMP-119)", () => {
    const { steps, el } = shell();
    expect(press(el("replace-all"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(el("replace-all"), { key: "Z", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(press(el("replace-all"), { key: "y", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(steps).toEqual(["undo", "redo", "redo"]);
    expect(document.activeElement).toBe(el("replace-all"));
  });

  it("dopo Accetta, da una scheda dell'ispettore annulla nel documento attivo (IMP-120)", () => {
    const { steps, el } = shell();
    expect(press(el("accept"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    // Anche da una linguetta.
    expect(press(el("tags"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(steps).toEqual(["undo", "undo"]);
  });

  it("sul Mac con ⌘Z e ⇧⌘Z", () => {
    const { steps, el } = shell("MacIntel");
    press(el("accept"), { key: "z", metaKey: true });
    press(el("accept"), { key: "z", metaKey: true, shiftKey: true });
    expect(steps).toEqual(["undo", "redo"]);
  });

  it("il tasto è del documento anche quando non c'era niente da annullare", () => {
    const { steps, el } = shell("Linux x86_64", false);
    expect(press(el("accept"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(steps).toEqual(["undo"]);
  });

  it("senza una superficie con una storia il tasto passa", () => {
    const { el } = shell("Linux x86_64", null);
    expect(press(el("accept"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("fuori dai contenitori del documento non annulla nel documento", () => {
    const { steps, el } = shell();
    expect(press(el("tree"), { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(steps).toEqual([]);
  });
});

describe("un campo di testo di un pannello tiene il suo Ctrl+Z", () => {
  it("la casella Trova e un campo dell'ispettore non annullano nel documento", () => {
    const { steps, el } = shell();
    press(el("find"), { key: "z", ctrlKey: true });
    press(el("author"), { key: "z", ctrlKey: true });
    press(el("author"), { key: "y", ctrlKey: true });
    expect(steps).toEqual([]);
  });

  it("e nemmeno il foglio, che ha la sua pila", () => {
    const { steps, el } = shell();
    press(el("sheet"), { key: "z", ctrlKey: true });
    expect(steps).toEqual([]);
  });
});
