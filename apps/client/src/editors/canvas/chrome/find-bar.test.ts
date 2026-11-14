// @vitest-environment happy-dom
// La barra «Cerca nella lavagna» (N6 T60): il contatore, Invio e Maiusc+Invio,
// Esc, la richiesta delle note una volta per ricerca dopo l'ultimo tasto, e la
// risposta vecchia scartata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { boardFindIndex, type FindNotesPort, type FindTarget } from "../find";
import type { CanvasDocument } from "../model";
import { createCanvasFindBar, FIND_NOTES_DELAY_MS, type CanvasFindBar } from "./find-bar";

const DOC: CanvasDocument = {
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "La deviazione standard" },
    { id: "b", type: "text", x: 300, y: 0, width: 200, height: 100, text: "La media" },
    { id: "c", type: "text", x: 600, y: 0, width: 200, height: 100, text: "Deviazione e varianza" },
    { id: "n", type: "file", x: 0, y: 300, width: 200, height: 100, file: "Note/esercizi.md" },
  ],
  edges: [],
};

interface Deferred {
  readonly query: string;
  readonly notes: readonly string[];
  resolve(hits: ReadonlySet<string>): void;
  reject(error: unknown): void;
}

/** L'ultimo elemento di una lista che non è vuota. */
function last<T>(list: readonly T[]): T {
  return list[list.length - 1]!;
}

let life: Lifetime;

beforeEach(() => {
  vi.useFakeTimers();
  life = openLifetime();
});

afterEach(() => {
  life.close();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mount(doc: CanvasDocument | null = DOC) {
  const asked: Deferred[] = [];
  const notes: FindNotesPort = (query, list) => new Promise((resolve, reject) => {
    asked.push({ query, notes: list, resolve, reject });
  });
  const shown: { matches: readonly FindTarget[] | null; current: number }[] = [];
  const went: string[] = [];
  const closed = vi.fn();
  let current = doc;
  const bar: CanvasFindBar = createCanvasFindBar({
    lifetime: life,
    index: () => (current ? boardFindIndex(current) : null),
    notes,
    show: (matches, at) => shown.push({ matches, current: at }),
    go: (target) => went.push(target.id),
    closed,
  });
  document.body.append(bar.element);
  const input = bar.element.querySelector<HTMLInputElement>(".canvas-find-input")!;
  const count = bar.element.querySelector<HTMLElement>(".canvas-find-count")!;
  const scope = bar.element.querySelector<HTMLElement>(".canvas-find-scope")!;
  const [previous, next, close] = [...bar.element.querySelectorAll<HTMLButtonElement>("button")];
  const type = (text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    input.dispatchEvent(event);
    return event;
  };
  const setDoc = (next: CanvasDocument): void => {
    current = next;
    bar.refresh();
  };
  return { bar, asked, shown, went, closed, input, count, scope, previous: previous!, next: next!, close: close!, type, key, setDoc };
}

/** Le promesse che si sono già risolte arrivano a chi le aspetta. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("la barra «Cerca nella lavagna» (T60)", () => {
  it("si apre nascosta e chiusa; `open` la mostra e dà il fuoco al campo", () => {
    const { bar, input } = mount();
    expect(bar.element.hidden).toBe(true);
    expect(bar.element.getAttribute("role")).toBe("search");
    expect(bar.element.getAttribute("aria-label")).toBe("Cerca nella lavagna");
    bar.open();
    expect(bar.isOpen()).toBe(true);
    expect(bar.element.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("il contatore dice «1 di N» a ogni tasto, «Nessun risultato» senza, niente con la ricerca vuota; ‹ › spenti senza risultati", () => {
    const { bar, count, previous, next, shown, type } = mount();
    bar.open();
    type("deviazione");
    expect(count.textContent).toBe("1 di 2");
    expect(count.hasAttribute("data-none")).toBe(false);
    expect(last(shown).matches!.map((target) => target.id)).toEqual(["a", "c"]);
    expect(last(shown).current).toBe(0);
    expect(next.disabled).toBe(false);
    type("covarianza");
    expect(count.textContent).toBe("Nessun risultato");
    expect(count.hasAttribute("data-none")).toBe(true);
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    // Senza risultati il velo copre tutto (una lista vuota), con la ricerca vuota non c'è.
    expect(last(shown).matches).toEqual([]);
    type("");
    expect(count.textContent).toBe("");
    expect(last(shown).matches).toBeNull();
  });

  it("scrivere non muove la vista; Invio va al risultato del contatore, poi al seguente, e gira; Maiusc+Invio torna indietro", () => {
    const { bar, count, went, type, key } = mount();
    bar.open();
    type("deviazione");
    expect(went).toEqual([]);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(went).toEqual(["a"]);
    expect(count.textContent).toBe("1 di 2");
    key("Enter");
    expect(went).toEqual(["a", "c"]);
    expect(count.textContent).toBe("2 di 2");
    key("Enter");
    expect(last(went)).toBe("a");
    expect(count.textContent).toBe("1 di 2");
    key("Enter", { shiftKey: true });
    expect(last(went)).toBe("c");
    expect(count.textContent).toBe("2 di 2");
  });

  it("Maiusc+Invio subito dopo aver scritto va all'ultimo; i pulsanti ‹ › fanno lo stesso dei tasti", () => {
    const { bar, went, type, key, previous, next } = mount();
    bar.open();
    type("deviazione");
    key("Enter", { shiftKey: true });
    expect(went).toEqual(["c"]);
    next.click();
    expect(went).toEqual(["c", "a"]);
    previous.click();
    expect(went).toEqual(["c", "a", "c"]);
  });

  it("0 risultati: Invio non salta", () => {
    const { bar, went, type, key } = mount();
    bar.open();
    type("covarianza");
    key("Enter");
    expect(went).toEqual([]);
  });

  it("Esc chiude: via il velo, il fuoco torna alla lavagna, la vista non si tocca", () => {
    const { bar, shown, went, closed, type, key } = mount();
    bar.open();
    type("deviazione");
    key("Enter");
    const event = key("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(bar.isOpen()).toBe(false);
    expect(bar.element.hidden).toBe(true);
    expect(last(shown)).toEqual({ matches: null, current: -1 });
    expect(closed).toHaveBeenCalledWith(true);
    expect(went).toEqual(["a"]);
  });

  it("la × chiude come Esc", () => {
    const { bar, close, closed } = mount();
    bar.open();
    close.click();
    expect(bar.isOpen()).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("le note: una richiesta sola per ricerca, 200 ms dopo l'ultimo tasto, con le note della lavagna", async () => {
    const { bar, asked, count, shown, type } = mount();
    bar.open();
    type("e");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS - 1);
    type("es");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS - 1);
    type("esercizio");
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    expect(asked.map((one) => one.query)).toEqual(["esercizio"]);
    expect(asked[0]!.notes).toEqual(["Note/esercizi.md"]);
    expect(count.textContent).toBe("Nessun risultato");
    asked[0]!.resolve(new Set(["Note/esercizi.md"]));
    await flush();
    expect(count.textContent).toBe("1 di 1");
    expect(last(shown).matches!.map((target) => target.id)).toEqual(["n"]);
  });

  it("una risposta vecchia non copre una nuova", async () => {
    const { bar, asked, count, type } = mount();
    bar.open();
    type("media");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    type("varianza");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    expect(asked.map((one) => one.query)).toEqual(["media", "varianza"]);
    asked[1]!.resolve(new Set());
    await flush();
    expect(count.textContent).toBe("1 di 1");
    // Quella di «media» arriva dopo: si scarta.
    asked[0]!.resolve(new Set(["Note/esercizi.md"]));
    await flush();
    expect(count.textContent).toBe("1 di 1");
  });

  it("una risposta arrivata a barra chiusa si scarta, e la chiusura ferma la richiesta che aspettava", async () => {
    const { bar, asked, shown, type, key } = mount();
    bar.open();
    type("esercizi");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    key("Escape");
    const after = shown.length;
    asked[0]!.resolve(new Set(["Note/esercizi.md"]));
    await flush();
    expect(shown.length).toBe(after);
    bar.open();
    type("media");
    key("Escape");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS * 2);
    expect(asked.length).toBe(1);
  });

  it("senza note sulla lavagna non chiede niente all'indice", () => {
    const { bar, asked, type } = mount({ nodes: DOC.nodes.filter((node) => node.type !== "file"), edges: [] });
    bar.open();
    type("deviazione");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    expect(asked).toEqual([]);
  });

  it("il vault senza indice: la barra trova nel file della lavagna e dice che le note non sono cercate", async () => {
    const { bar, asked, count, scope, type } = mount();
    bar.open();
    type("deviazione");
    expect(scope.hidden).toBe(true);
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    asked[0]!.reject(new Error("senza indice"));
    await flush();
    expect(count.textContent).toBe("1 di 2");
    expect(scope.hidden).toBe(false);
    expect(scope.textContent).toBe("Solo la lavagna, non le note");
  });

  it("le note trovate restano finché non si cerca di nuovo; il file della lavagna si rilegge a ogni modifica", async () => {
    const { bar, asked, count, type, setDoc, key, went } = mount();
    bar.open();
    type("deviazione");
    vi.advanceTimersByTime(FIND_NOTES_DELAY_MS);
    asked[0]!.resolve(new Set(["Note/esercizi.md"]));
    await flush();
    expect(count.textContent).toBe("1 di 3");
    key("Enter");
    key("Enter");
    expect(went).toEqual(["a", "c"]);
    // La scheda `a` se ne va: il risultato di adesso (`c`) resta quello, la nota resta trovata.
    setDoc({ nodes: DOC.nodes.filter((node) => node.id !== "a"), edges: [] });
    expect(count.textContent).toBe("1 di 2");
    expect(asked.length).toBe(1);
    key("Enter");
    expect(last(went)).toBe("n");
  });

  it("riaperta, rifà la ricerca di prima col documento di adesso", () => {
    const { bar, count, input, type, key } = mount();
    bar.open();
    type("deviazione");
    key("Escape");
    bar.open();
    expect(input.value).toBe("deviazione");
    expect(count.textContent).toBe("1 di 2");
  });
});
