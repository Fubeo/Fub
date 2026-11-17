// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MathEditor, PROBLEM_DELAY, type MathPreferences } from "./editor";
import { attachPalette } from "./palette";

// Gli errori in chiaro nel riquadro della formula (T64, E27): col campo del
// LaTeX, dopo una pausa, la frase sotto il campo con la correzione quando è
// una sola. Il TeX della nota cambia soltanto col gesto della persona, e
// l'annulla toglie la correzione in un passo. Con KaTeX vero.

beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const lives: Lifetime[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

const settle = () => new Promise((done) => setTimeout(done, 40));
async function drawn(): Promise<void> {
  await settle();
  for (let i = 0; i < 100 && document.querySelector(".cm-fub-mx-surface[data-state=loading]"); i++) await settle();
}

const SPENTE: MathPreferences = { source: true, help: "spente" };
const PIENE: MathPreferences = { source: true, help: "piene" };

async function open(tex: string, preferences?: MathPreferences, display = false) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const editor = new MathEditor({
    tex,
    display,
    start: "end",
    preferences,
    onPreferences: () => {},
    onChange: (next) => changes.push(next),
    onLeave: () => {},
    lifetime: life,
  });
  attachPalette(editor, life);
  document.body.append(editor.element);
  editor.focus();
  await drawn();
  // Da qui il tempo lo decide il test: il disegno (un fotogramma) e la pausa.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  const root = editor.element;
  const field = () => root.querySelector<HTMLTextAreaElement>("textarea")!;
  const problem = () => root.querySelector<HTMLElement>(".cm-fub-mx-error")!;
  const fix = () => root.querySelector<HTMLButtonElement>(".cm-fub-mx-error-fix");
  const surface = () => root.querySelector<HTMLElement>(".cm-fub-mx-surface")!;
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    field().dispatchEvent(event);
    return event;
  };
  const type = (text: string) => {
    for (const ch of text) {
      if (key(ch).defaultPrevented) continue;
      const input = field();
      const at = input.selectionStart;
      input.value = input.value.slice(0, at) + ch + input.value.slice(input.selectionEnd);
      input.setSelectionRange(at + 1, at + 1);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    }
  };
  /// Il tempo che passa: prima il fotogramma del disegno, poi il resto.
  const wait = (ms: number) => vi.advanceTimersByTime(ms);
  return { editor, root, field, problem, fix, surface, key, type, wait, changes, life };
}

describe("la frase dopo la pausa", () => {
  it("mentre si scrive niente lampeggia: la frase arriva 450 ms dopo l'ultimo tasto", async () => {
    const { problem, surface, type, wait, fix } = await open("x^{2}", SPENTE);
    type("+y^{3");
    wait(20);
    // Il disegno vecchio resta com'è, senza attenuarsi, e nessuna frase.
    expect(problem().hidden).toBe(true);
    expect(surface().dataset.state).toBe("ready");
    wait(PROBLEM_DELAY - 150);
    expect(problem().hidden).toBe(true);
    // Un altro tasto rimanda la frase.
    type("4");
    wait(PROBLEM_DELAY - 50);
    expect(problem().hidden).toBe(true);
    wait(100);
    expect(problem().hidden).toBe(false);
    expect(problem().getAttribute("role")).toBe("status");
    expect(problem().textContent).toBe("Manca una } di chiusura.Chiudi");
    expect(problem().querySelector(".cm-fub-mx-error-text code")?.textContent).toBe("}");
    expect(fix()?.textContent).toBe("Chiudi");
    expect(surface().dataset.state).toBe("stale");
  });

  it("la formula che torna a leggersi toglie la frase subito", async () => {
    const { problem, surface, type, wait } = await open("x^{2}", SPENTE);
    type("+y^{3");
    wait(PROBLEM_DELAY + 20);
    expect(problem().hidden).toBe(false);
    type("}");
    wait(20);
    expect(problem().hidden).toBe(true);
    expect(problem().childElementCount).toBe(0);
    expect(surface().dataset.state).toBe("ready");
  });

  it("la frase vecchia resta finché non arriva la nuova", async () => {
    const { problem, type, wait } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    expect(problem().textContent).toContain("Manca una } di chiusura.");
    type("+\\alfa");
    wait(100);
    expect(problem().textContent).toContain("Manca una } di chiusura.");
    wait(PROBLEM_DELAY);
    expect(problem().textContent).toContain("Manca una } di chiusura.");
    type("}");
    wait(PROBLEM_DELAY + 20);
    expect(problem().textContent).toBe("Non conosco \\alfa. Forse volevi \\alpha?Usa \\alpha");
  });

  it("nella formula che si tocca non c'è la frase", async () => {
    const { root, problem, wait } = await open("\\frac{a}{b}");
    expect(root.dataset.mode).toBe("visual");
    wait(PROBLEM_DELAY * 2);
    expect(problem().hidden).toBe(true);
  });

  it("il riquadro chiuso prima della pausa non dice più niente", async () => {
    const { problem, type, life } = await open("x", SPENTE);
    type("^{2");
    vi.advanceTimersByTime(20);
    life.close();
    expect(() => vi.advanceTimersByTime(PROBLEM_DELAY * 2)).not.toThrow();
    expect(problem().hidden).toBe(true);
  });
});

describe("la correzione", () => {
  it("il TeX della nota non cambia da solo: la correzione entra col clic, e Annulla la toglie in un passo", async () => {
    const { field, fix, type, wait, changes, key, problem } = await open("x^{2}", SPENTE);
    type("+y^{3");
    wait(PROBLEM_DELAY + 20);
    const before = changes.length;
    expect(changes[changes.length - 1]).toBe("x^{2}+y^{3");
    // Il tempo passa, la frase resta: il TeX no.
    wait(PROBLEM_DELAY * 4);
    expect(changes.length).toBe(before);
    expect(field().value).toBe("x^{2}+y^{3");

    fix()!.click();
    expect(field().value).toBe("x^{2}+y^{3}");
    expect(changes.length).toBe(before + 1);
    expect(changes[changes.length - 1]).toBe("x^{2}+y^{3}");
    expect(field().selectionStart).toBe("x^{2}+y^{3}".length);
    expect(document.activeElement).toBe(field());
    wait(20);
    expect(problem().hidden).toBe(true);

    key("z", { ctrlKey: true });
    expect(field().value).toBe("x^{2}+y^{3");
    expect(changes[changes.length - 1]).toBe("x^{2}+y^{3");
    key("y", { ctrlKey: true });
    expect(field().value).toBe("x^{2}+y^{3}");
  });

  it("una formula rotta nel file: la frase prende il posto della nota, «Usa \\alpha» corregge ogni \\alfa", async () => {
    const { root, field, fix, wait, changes, problem } = await open("\\alfa + \\alfa^2");
    expect(root.dataset.mode).toBe("latex");
    const note = root.querySelector<HTMLElement>(".cm-fub-mx-note")!;
    // La formula com'era nel file: la frase c'è subito, al posto della nota.
    expect(problem().hidden).toBe(false);
    expect(note.hidden).toBe(true);
    expect(problem().querySelector(".cm-fub-mx-error-text")!.textContent).toBe("Non conosco \\alfa. Forse volevi \\alpha?");
    expect(changes).toEqual([]);
    fix()!.click();
    expect(field().value).toBe("\\alpha + \\alpha^2");
    expect(changes).toEqual(["\\alpha + \\alpha^2"]);
    wait(20);
    expect(problem().hidden).toBe(true);
    // La formula si legge: anche la nota se ne va.
    expect(note.hidden).toBe(true);
  });

  it("un errore con più correzioni: la frase le dice, nessun pulsante", async () => {
    const { fix, problem } = await open("\\s + 1", SPENTE);
    expect(problem().hidden).toBe(false);
    expect(problem().textContent).toMatch(/^Non conosco \\s\. Forse volevi .+ o .+\?$/);
    expect(fix()).toBeNull();
  });

  it("una correzione vecchia non si applica sul TeX cambiato: la frase si rifà", async () => {
    const { field, fix, type, wait, changes, problem } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    const button = fix()!;
    type("+\\alfa");
    wait(20);
    const before = changes.slice();
    button.click();
    expect(field().value).toBe("x^{2+\\alfa");
    expect(changes).toEqual(before);
    // La frase è già quella del TeX di adesso.
    expect(problem().textContent).toBe("Manca una } di chiusura.Chiudi");
    fix()!.click();
    expect(field().value).toBe("x^{2+\\alfa}");
  });

  it("da tastiera: Tab dopo l'ultimo spazio vuoto segue la pagina fino alla correzione, Invio la sceglie", async () => {
    const { field, fix, type, wait, key, root } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    // Il Tab non è preso dal campo: il browser porta il fuoco avanti, ai tre
    // puntini e poi alla correzione.
    expect(key("Tab").defaultPrevented).toBe(false);
    const order = [...root.querySelectorAll<HTMLElement>("button, textarea, input")].filter((el) => !el.closest("[hidden]") && el.tabIndex >= 0);
    const at = order.indexOf(fix()!);
    expect(at).toBeGreaterThan(order.indexOf(field()));
    expect(order.slice(order.indexOf(field()) + 1, at).every((el) => el.classList.contains("cm-fub-mx-more"))).toBe(true);
    // Il pulsante è un <button>: Invio e lo spazio lo premono.
    fix()!.focus();
    fix()!.click();
    expect(field().value).toBe("x^{2}");
    expect(document.activeElement).toBe(field());
  });

  it("Esc sulla correzione torna al campo", async () => {
    const { field, fix, type, wait } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    fix()!.focus();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fix()!.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe("x^{2");
  });

  it("il clic sulla frase non ruba il fuoco al campo", async () => {
    const { fix, type, wait, problem } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    for (const target of [problem(), fix()!]) {
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      target.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    }
  });

  it("coi pieni le graffe si chiudono da sole, e gli errori che restano si dicono lo stesso", async () => {
    const { fix, type, wait, problem, field } = await open("", PIENE);
    type("x^2^3");
    wait(PROBLEM_DELAY + 20);
    expect(problem().hidden).toBe(false);
    expect(problem().textContent).toBe("Due esponenti di fila: metti il primo fra graffe, come {x^2}^3.");
    expect(fix()).toBeNull();
    expect(field().value).toBe("x^2^3");
  });

  it("nel blocco la frase sta sotto il campo", async () => {
    const { fix, type, wait, root, field } = await open("a", SPENTE, true);
    type("_{1");
    wait(PROBLEM_DELAY + 20);
    expect(fix()?.textContent).toBe("Chiudi");
    expect(field().compareDocumentPosition(root.querySelector(".cm-fub-mx-error")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("in inglese", () => {
  it("la frase e la correzione nella lingua di chi guarda", async () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const { fix, type, wait, problem } = await open("x", SPENTE);
    type("^{2");
    wait(PROBLEM_DELAY + 20);
    expect(problem().querySelector(".cm-fub-mx-error-text")!.textContent).toBe("A closing } is missing.");
    expect(fix()?.textContent).toBe("Close");
  });
});
