// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  attachHoverCard,
  type HoverCardHandle,
} from "./hover-card";
import { openLayers } from "./layers";
import { listenerLedger, pointer, press } from "./testing";

interface Deferred {
  promise: Promise<Node | null>;
  resolve(value: Node | null): void;
  reject(reason: unknown): void;
}

interface Call {
  target: HTMLElement;
  signal: AbortSignal;
  answer: Deferred;
}

let life: Lifetime;
let calls: Call[];

function deferred(): Deferred {
  let resolve!: (value: Node | null) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Node | null>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/// Un caricamento che risponde quando la prova decide.
function load(target: HTMLElement, signal: AbortSignal): Promise<Node | null> {
  const answer = deferred();
  calls.push({ target, signal, answer });
  return answer.promise;
}

function link(text: string, parent: HTMLElement = document.body): HTMLAnchorElement {
  const el = document.createElement("a");
  el.href = "#";
  el.className = "wikilink";
  el.textContent = text;
  parent.append(el);
  return el;
}

function preview(text: string): HTMLElement {
  const el = document.createElement("p");
  el.textContent = text;
  return el;
}

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".kit-hover-card")];
const wait = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/// Porta la scheda di `target` fino ad aperta: passaggio, attesa, risposta.
async function hoverOpen(target: HTMLElement, text = "anteprima"): Promise<HTMLElement> {
  target.dispatchEvent(pointer("pointerover"));
  await wait(HOVER_OPEN_DELAY_MS);
  calls[calls.length - 1].answer.resolve(preview(text));
  await wait(0);
  return cards()[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  life = openLifetime();
  calls = [];
});

afterEach(() => {
  life.close();
  expect(openLayers()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("l'apertura", () => {
  it("aspetta prima di caricare, e mostra ciò che il caricamento rende", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, label: "Anteprima", lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS - 1);
    expect(calls.length).toBe(0);
    await wait(1);
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe(target);
    expect(calls[0].signal.aborted).toBe(false);
    expect(handle.open).toBe(false);

    calls[0].answer.resolve(preview("Il testo della nota"));
    await wait(0);
    expect(handle.open).toBe(true);
    const [card] = cards();
    expect(card.textContent).toBe("Il testo della nota");
    expect(card.classList.contains("kit-popover")).toBe(true);
    // Col nome è una regione: fuori dai punti di riferimento della pagina,
    // la si ritrova fra le regioni.
    expect(card.getAttribute("role")).toBe("region");
    expect(card.getAttribute("aria-label")).toBe("Anteprima");
    // Chi ascolta sa che il bersaglio ha altro da dire.
    expect(target.getAttribute("aria-details")).toBe(card.id);
  });

  it("non prende il fuoco", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    const card = await hoverOpen(target);
    expect(card.isConnected).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it("chi passa soltanto non carica niente", async () => {
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS - 50);
    target.dispatchEvent(pointer("pointerout"));
    await wait(1000);
    expect(calls.length).toBe(0);
    expect(cards().length).toBe(0);
  });

  it("muoversi dentro il bersaglio non ricomincia l'attesa né la annulla", async () => {
    const target = link("Nota");
    const inner = document.createElement("b");
    target.append(inner);
    attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS - 50);
    target.dispatchEvent(pointer("pointerout", { relatedTarget: inner }));
    inner.dispatchEvent(pointer("pointerover", { relatedTarget: target }));
    await wait(50);
    expect(calls.length).toBe(1);
  });

  it("rispetta le attese chieste e il nome secondo il bersaglio", async () => {
    const target = link("Nota");
    attachHoverCard({
      target,
      load,
      openDelay: 100,
      closeDelay: 20,
      label: (el) => `Anteprima di ${el.textContent}`,
      placement: "top",
      lifetime: life,
    });
    target.dispatchEvent(pointer("pointerover"));
    await wait(100);
    calls[0].answer.resolve(preview("x"));
    await wait(0);
    expect(cards()[0].getAttribute("aria-label")).toBe("Anteprima di Nota");
    target.dispatchEvent(pointer("pointerout"));
    await wait(20);
    expect(cards().length).toBe(0);
  });

  it("un dito non passa sopra: non apre", async () => {
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover", { pointerType: "touch" }));
    await wait(1000);
    expect(calls.length).toBe(0);
  });

  it("niente da mostrare non apre niente, comunque arrivi", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    calls[0].answer.resolve(null);
    await wait(0);
    expect(cards().length).toBe(0);
    target.dispatchEvent(pointer("pointerout"));

    // Un rigetto vale «niente», e non resta in giro come errore non gestito.
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    calls[1].answer.reject(new Error("la nota non c'è più"));
    await wait(0);
    expect(cards().length).toBe(0);
    expect(handle.open).toBe(false);
  });

  it("un caricamento che lancia subito vale «niente»", async () => {
    const target = link("Nota");
    attachHoverCard({
      target,
      load: () => {
        throw new Error("rotto");
      },
      lifetime: life,
    });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    expect(cards().length).toBe(0);
  });

  it("non apre su un bersaglio che intanto è sparito", async () => {
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    target.remove();
    calls[0].answer.resolve(preview("x"));
    await wait(0);
    expect(cards().length).toBe(0);
  });
});

describe("la chiusura", () => {
  it("aspetta dopo l'uscita del puntatore, poi chiude e ripulisce il bersaglio", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    target.dispatchEvent(pointer("pointerout"));
    await wait(HOVER_CLOSE_DELAY_MS - 1);
    expect(handle.open).toBe(true);
    await wait(1);
    expect(handle.open).toBe(false);
    expect(cards().length).toBe(0);
    expect(target.hasAttribute("aria-details")).toBe(false);
  });

  it("rimette l'aria-details che il bersaglio aveva", async () => {
    const target = link("Nota");
    target.setAttribute("aria-details", "di-prima");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    expect(target.getAttribute("aria-details")).not.toBe("di-prima");
    handle.hide();
    expect(target.getAttribute("aria-details")).toBe("di-prima");
  });

  it("resta aperta finché il puntatore è sulla scheda", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    const card = await hoverOpen(target);
    target.dispatchEvent(pointer("pointerout", { relatedTarget: card }));
    await wait(HOVER_CLOSE_DELAY_MS - 50);
    card.dispatchEvent(pointer("pointerenter", { bubbles: false }));
    await wait(2000);
    expect(handle.open).toBe(true);
    card.dispatchEvent(pointer("pointerleave", { bubbles: false }));
    await wait(HOVER_CLOSE_DELAY_MS);
    expect(handle.open).toBe(false);
  });

  it("tornare sul bersaglio annulla la chiusura", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    target.dispatchEvent(pointer("pointerout"));
    await wait(HOVER_CLOSE_DELAY_MS - 10);
    target.dispatchEvent(pointer("pointerover"));
    await wait(2000);
    expect(handle.open).toBe(true);
    // E non ricarica: la scheda è già quella.
    expect(calls.length).toBe(1);
  });

  it("Esc chiude", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    expect(press(document.body, "Escape").defaultPrevented).toBe(true);
    expect(handle.open).toBe(false);
    expect(cards().length).toBe(0);
  });

  it("premere il bersaglio è agire: annulla l'attesa e chiude la scheda", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS - 10);
    target.dispatchEvent(pointer("pointerdown"));
    await wait(1000);
    expect(calls.length).toBe(0);

    target.dispatchEvent(pointer("pointerout"));
    await hoverOpen(target);
    expect(handle.open).toBe(true);
    target.dispatchEvent(pointer("pointerdown"));
    expect(handle.open).toBe(false);
  });

  it("un gesto altrove la chiude", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    document.body.dispatchEvent(pointer("pointerdown"));
    expect(handle.open).toBe(false);
  });

  it("si accorge di un bersaglio tolto sotto un puntatore fermo", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    target.remove();
    // Nessuna uscita è arrivata: basta il primo movimento.
    document.body.dispatchEvent(pointer("pointermove"));
    expect(handle.open).toBe(false);
  });

  it("un puntatore che si ritrova altrove senza essere uscito la chiude dopo l'attesa", async () => {
    const target = link("Nota");
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    const handle = attachHoverCard({ target, load, lifetime: life });
    const card = await hoverOpen(target);
    // Sul bersaglio o sulla scheda non succede niente.
    target.dispatchEvent(pointer("pointermove"));
    card.dispatchEvent(pointer("pointermove"));
    await wait(2000);
    expect(handle.open).toBe(true);
    elsewhere.dispatchEvent(pointer("pointermove"));
    await wait(HOVER_CLOSE_DELAY_MS);
    expect(handle.open).toBe(false);
  });
});

describe("il fuoco", () => {
  it("apre col fuoco arrivato dalla tastiera, e chiude quando se ne va", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    target.focus();
    await wait(HOVER_OPEN_DELAY_MS);
    expect(calls.length).toBe(1);
    calls[0].answer.resolve(preview("x"));
    await wait(0);
    expect(handle.open).toBe(true);
    // Aperta dal fuoco, un puntatore che si muove altrove non la riguarda.
    document.body.dispatchEvent(pointer("pointermove"));
    await wait(2000);
    expect(handle.open).toBe(true);
    target.blur();
    await wait(HOVER_CLOSE_DELAY_MS);
    expect(handle.open).toBe(false);
  });

  it("non apre col fuoco arrivato da un clic", async () => {
    const target = link("Nota");
    target.matches = (selector: string) => selector !== ":focus-visible";
    attachHoverCard({ target, load, lifetime: life });
    target.focus();
    await wait(1000);
    expect(calls.length).toBe(0);
  });

  it("il fuoco che lascia il bersaglio prima dell'attesa annulla", async () => {
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    target.focus();
    await wait(HOVER_OPEN_DELAY_MS - 10);
    target.blur();
    await wait(1000);
    expect(calls.length).toBe(0);
  });

  it("resta aperta se il fuoco entra nella scheda, e chiude quando ne esce", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    target.focus();
    await wait(HOVER_OPEN_DELAY_MS);
    const content = document.createElement("div");
    const inside = document.createElement("button");
    content.append(inside);
    calls[0].answer.resolve(content);
    await wait(0);
    inside.focus();
    await wait(2000);
    expect(handle.open).toBe(true);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(handle.open).toBe(false);
  });
});

describe("entrarci da tastiera", () => {
  it("show con focus porta il fuoco alla prima azione, ed Esc lo riporta dov'era", async () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    handle.show(target, { focus: true });
    const content = document.createElement("div");
    const first = document.createElement("button");
    content.append(first, document.createElement("button"));
    calls[0].answer.resolve(content);
    await wait(0);
    expect(handle.open).toBe(true);
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(handle.open).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("una scheda già aperta dal passaggio si riapre col fuoco dentro", async () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    await hoverOpen(target);
    expect(document.activeElement).toBe(field);
    handle.show(target, { focus: true });
    const content = document.createElement("div");
    const action = document.createElement("button");
    content.append(action);
    calls[calls.length - 1].answer.resolve(content);
    await wait(0);
    expect(cards()).toHaveLength(1);
    expect(document.activeElement).toBe(action);
  });
});

describe("una alla volta", () => {
  it("aprirne una chiude quella di un altro bersaglio, di chiunque sia", async () => {
    const first = link("Uno");
    const second = link("Due");
    const one = attachHoverCard({ target: first, load, lifetime: life });
    const two = attachHoverCard({ target: second, load, lifetime: life });
    await hoverOpen(first, "uno");
    expect(one.open).toBe(true);
    second.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS - 1);
    // Il puntatore non è mai uscito dal primo: la sua scheda è ancora lì.
    expect(one.open).toBe(true);
    await wait(1);
    calls[1].answer.resolve(preview("due"));
    await wait(0);
    expect(one.open).toBe(false);
    expect(two.open).toBe(true);
    expect(cards().map((card) => card.textContent)).toEqual(["due"]);
  });
});

describe("il caricamento superato", () => {
  it("viene annullato, e il suo esito arrivato tardi non apre niente", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const first = link("Uno", root);
    const second = link("Due", root);
    const handle = attachHoverCard({
      delegate: { root, selector: ".wikilink" },
      load,
      lifetime: life,
    });
    first.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    expect(calls.length).toBe(1);
    expect(calls[0].signal.aborted).toBe(false);

    // Il primo sta ancora caricando quando si passa sul secondo.
    first.dispatchEvent(pointer("pointerout", { relatedTarget: second }));
    expect(calls[0].signal.aborted).toBe(true);
    second.dispatchEvent(pointer("pointerover", { relatedTarget: first }));
    await wait(HOVER_OPEN_DELAY_MS);
    expect(calls.length).toBe(2);

    // La risposta vecchia arriva dopo la domanda nuova: non conta.
    calls[0].answer.resolve(preview("uno, in ritardo"));
    await wait(0);
    expect(cards().length).toBe(0);
    expect(handle.open).toBe(false);

    calls[1].answer.resolve(preview("due"));
    await wait(0);
    expect(cards().map((card) => card.textContent)).toEqual(["due"]);
    expect(second.getAttribute("aria-details")).toBe(cards()[0].id);
    expect(first.hasAttribute("aria-details")).toBe(false);
    expect(calls[1].signal.aborted).toBe(false);
  });

  it("un rigetto arrivato dopo l'annullamento non fa rumore", async () => {
    const target = link("Nota");
    attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    target.dispatchEvent(pointer("pointerout"));
    calls[0].answer.reject(new Error("annullato"));
    await wait(0);
    expect(cards().length).toBe(0);
  });

  it("hide() annulla un caricamento in corso", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    target.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    handle.hide();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].answer.resolve(preview("x"));
    await wait(0);
    expect(cards().length).toBe(0);
  });
});

describe("la delega", () => {
  it("vale per i bersagli nati dopo, e solo per quelli che il selettore trova", async () => {
    const root = document.createElement("div");
    const plain = document.createElement("span");
    root.append(plain);
    document.body.append(root);
    attachHoverCard({ delegate: { root, selector: ".wikilink" }, load, lifetime: life });

    plain.dispatchEvent(pointer("pointerover"));
    await wait(1000);
    expect(calls.length).toBe(0);

    const late = link("Arrivata dopo", root);
    const inner = document.createElement("b");
    late.append(inner);
    // Il passaggio arriva da un elemento dentro il bersaglio.
    inner.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    expect(calls.map((call) => call.target)).toEqual([late]);
  });

  it("non guarda fuori dalla radice", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const outside = link("Fuori");
    attachHoverCard({ delegate: { root, selector: ".wikilink" }, load, lifetime: life });
    outside.dispatchEvent(pointer("pointerover"));
    await wait(1000);
    expect(calls.length).toBe(0);
  });
});

describe("a comando", () => {
  it("show apre senza attesa, hide chiude", async () => {
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    handle.show(target);
    expect(calls.length).toBe(1);
    calls[0].answer.resolve(preview("x"));
    await wait(0);
    expect(handle.open).toBe(true);
    // Già aperta su quel bersaglio: non ricarica.
    handle.show(target);
    expect(calls.length).toBe(1);
    handle.hide();
    expect(handle.open).toBe(false);
  });
});

describe("lo smontaggio", () => {
  it("chiude la scheda, annulla attese e caricamenti, e non risponde più", async () => {
    const first = link("Uno");
    const waiting = attachHoverCard({ target: first, load, lifetime: life });
    await hoverOpen(first);
    first.dispatchEvent(pointer("pointerout"));
    expect(vi.getTimerCount()).toBe(1);
    life.close();
    expect(waiting.open).toBe(false);
    expect(cards().length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    life = openLifetime();
    const second = link("Due");
    attachHoverCard({ target: second, load, lifetime: life });
    second.dispatchEvent(pointer("pointerover"));
    await wait(HOVER_OPEN_DELAY_MS);
    const loading = calls[calls.length - 1];
    life.close();
    expect(loading.signal.aborted).toBe(true);
    loading.answer.resolve(preview("tardi"));
    await wait(0);
    expect(cards().length).toBe(0);

    const before = calls.length;
    second.dispatchEvent(pointer("pointerover"));
    second.focus();
    await wait(1000);
    expect(calls.length).toBe(before);
  });

  it("su una vita già chiusa non apre niente", async () => {
    life.close();
    const target = link("Nota");
    const handle = attachHoverCard({ target, load, lifetime: life });
    handle.show(target);
    target.dispatchEvent(pointer("pointerover"));
    await wait(1000);
    expect(calls.length).toBe(0);
  });

  it("montata e smontata molte volte non lascia ascolti su finestra e documento", async () => {
    const target = link("Nota");
    const live = listenerLedger(window, document);
    const handles: HoverCardHandle[] = [];
    for (let round = 0; round < 4; round++) {
      const each = openLifetime();
      handles.push(attachHoverCard({ target, load, lifetime: each }));
      await hoverOpen(target);
      expect(live()).toBeGreaterThan(0);
      if (round % 2 === 0) target.dispatchEvent(pointer("pointerout"));
      each.close();
      expect(live()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(handles.every((handle) => !handle.open)).toBe(true);
    expect(cards().length).toBe(0);
  });
});
