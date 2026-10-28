// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../moto";
import { trapFocus } from "../ui/a11y";
import { attachTooltip, resetTooltips, TOOLTIP_DELAY_MS } from "../ui/tooltip";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { openLayers } from "./layers";
import { openPopover, placePopover, type AnchorBox, type PopoverCloseReason } from "./popover";
import { listenerLedger, pointer, press } from "./testing";

const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 100 };

let life: Lifetime;
let anchor: HTMLButtonElement;
let box: AnchorBox;

function content(...labels: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const label of labels) {
    const button = document.createElement("button");
    button.textContent = label;
    root.append(button);
  }
  return root;
}

beforeEach(() => {
  life = openLifetime();
  anchor = document.createElement("button");
  anchor.textContent = "apri";
  document.body.append(anchor);
  box = { left: 100, top: 100, width: 80, height: 24 };
  anchor.getBoundingClientRect = () => new DOMRect(box.left, box.top, box.width, box.height);
});

afterEach(() => {
  life.close();
  expect(openLayers()).toBe(0);
  document.body.replaceChildren();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.restoreAllMocks();
});

describe("placePopover", () => {
  const place = (
    anchorBox: AnchorBox,
    placement: "top" | "bottom" | "left" | "right",
    align: "start" | "center" | "end" = "start",
  ) => placePopover(anchorBox, SIZE, VIEWPORT, { placement, align, gap: 6 });

  it("sta dal lato chiesto, alla distanza chiesta, allineata all'ancora", () => {
    const anchorBox = { left: 300, top: 300, width: 80, height: 20 };
    expect(place(anchorBox, "bottom")).toMatchObject({ left: 300, top: 326, placement: "bottom" });
    expect(place(anchorBox, "top")).toMatchObject({ left: 300, top: 194, placement: "top" });
    expect(place(anchorBox, "right")).toMatchObject({ left: 386, top: 300, placement: "right" });
    expect(place(anchorBox, "left")).toMatchObject({ left: 94, top: 300, placement: "left" });
    expect(place(anchorBox, "bottom", "center").left).toBe(240);
    expect(place(anchorBox, "bottom", "end").left).toBe(180);
    expect(place(anchorBox, "right", "center").top).toBe(260);
  });

  it("si gira dall'altra parte quando dal lato chiesto non c'è posto", () => {
    const low = { left: 300, top: 740, width: 80, height: 20 };
    expect(place(low, "bottom")).toMatchObject({ placement: "top", top: 634 });
    const high = { left: 300, top: 20, width: 80, height: 20 };
    expect(place(high, "top")).toMatchObject({ placement: "bottom", top: 46 });
    const east = { left: 900, top: 300, width: 80, height: 20 };
    expect(place(east, "right")).toMatchObject({ placement: "left", left: 694 });
  });

  it("non si gira se dall'altra parte ce n'è ancora meno", () => {
    const tight = { width: 1000, height: 150 };
    const anchorBox = { left: 300, top: 40, width: 80, height: 20 };
    // Sotto restano 76 px, sopra 26: nessuno basta, e sotto è il meno peggio.
    const placed = placePopover(anchorBox, SIZE, tight, { placement: "bottom", align: "start", gap: 6 });
    expect(placed.placement).toBe("bottom");
    // Scivola dentro il margine anche lungo l'asse principale.
    expect(placed.top).toBe(150 - 100 - 8);
  });

  it("scivola per restare a 8 px dai bordi della finestra", () => {
    expect(place({ left: 950, top: 300, width: 40, height: 20 }, "bottom").left).toBe(1000 - 200 - 8);
    expect(place({ left: -30, top: 300, width: 40, height: 20 }, "bottom").left).toBe(8);
    expect(place({ left: 300, top: 760, width: 40, height: 20 }, "right").top).toBe(800 - 100 - 8);
    expect(
      placePopover({ left: 950, top: 300, width: 40, height: 20 }, SIZE, VIEWPORT, {
        placement: "bottom",
        align: "start",
        gap: 6,
        margin: 20,
      }).left,
    ).toBe(780);
  });

  it("dà come origine il punto della superficie più vicino all'ancora", () => {
    const anchorBox = { left: 300, top: 300, width: 80, height: 20 };
    expect(place(anchorBox, "bottom")).toMatchObject({ originX: 40, originY: 0 });
    expect(place(anchorBox, "top")).toMatchObject({ originX: 40, originY: 100 });
    expect(place(anchorBox, "right")).toMatchObject({ originX: 0, originY: 10 });
    expect(place(anchorBox, "left")).toMatchObject({ originX: 200, originY: 10 });
    // Scivolata via dall'ancora, l'origine resta sul bordo e non esce.
    expect(place({ left: 990, top: 300, width: 40, height: 20 }, "bottom").originX).toBe(200);
  });
});

describe("la superficie", () => {
  it("sta nel body, ha un ruolo e un nome, e la posizione che ha calcolato", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    const popover = openPopover({ anchor, content: content("uno"), label: "Azioni", lifetime: life });
    const surface = popover.element;
    expect(surface.parentElement).toBe(document.body);
    expect(surface.classList.contains("kit-popover")).toBe(true);
    expect(surface.getAttribute("role")).toBe("dialog");
    expect(surface.getAttribute("aria-label")).toBe("Azioni");
    expect(surface.style.left).toBe("100px");
    expect(surface.style.top).toBe("130px");
    expect(surface.dataset.placement).toBe("bottom");
    expect(surface.style.transformOrigin).toBe("40px 0px");
    expect(popover.closed).toBe(false);
  });

  it("senza nome è un gruppo: un dialogo senza nome non si annuncia", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(popover.element.getAttribute("role")).toBe("group");
    const menu = openPopover({ anchor, content: content("due"), role: "menu", labelledBy: "x", lifetime: life });
    expect(menu.element.getAttribute("role")).toBe("menu");
    expect(menu.element.getAttribute("aria-labelledby")).toBe("x");
  });

  it("accetta classi in più e un'ancora che non è un elemento", () => {
    const popover = openPopover({
      anchor: { getBoundingClientRect: () => ({ left: 400, top: 200, width: 0, height: 18 }) },
      content: content("uno"),
      className: "bolla",
      placement: "top",
      lifetime: life,
    });
    expect(popover.element.className).toBe("kit-popover bolla");
    expect(popover.element.style.left).toBe("400px");
    expect(popover.element.dataset.placement).toBe("top");
  });
});

describe("l'ancora", () => {
  it("dice «aperto» e «controllo» finché il popover c'è, se è un pulsante", () => {
    anchor.setAttribute("aria-controls", "di-prima");
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(anchor.getAttribute("aria-controls")).toBe(popover.element.id);
    popover.close();
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(anchor.getAttribute("aria-controls")).toBe("di-prima");
  });

  it("chiude il suggerimento del pulsante che l'ha aperto", () => {
    vi.useFakeTimers();
    try {
      const dispose = attachTooltip(anchor, "Azioni");
      anchor.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect(tooltip.hidden).toBe(false);
      const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
      expect(tooltip.hidden).toBe(true);
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      expect(tooltip.hidden).toBe(true);
      popover.close();
      dispose();
    } finally {
      resetTooltips();
      vi.useRealTimers();
    }
  });

  it("toglie il controllo che aveva messo", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    popover.close();
    expect(anchor.hasAttribute("aria-controls")).toBe(false);
  });

  it("non tocca un'ancora che non è un pulsante", () => {
    const field = document.createElement("input");
    document.body.append(field);
    openPopover({ anchor: field, content: content("uno"), lifetime: life });
    expect(field.hasAttribute("aria-expanded")).toBe(false);
    expect(field.hasAttribute("aria-controls")).toBe(false);
  });
});

describe("il fuoco", () => {
  it("entra nel primo elemento che può prenderlo, o nella superficie", () => {
    anchor.focus();
    const popover = openPopover({ anchor, content: content("uno", "due"), lifetime: life });
    expect(document.activeElement?.textContent).toBe("uno");
    popover.close();
    const empty = openPopover({ anchor, content: document.createElement("p"), lifetime: life });
    expect(document.activeElement).toBe(empty.element);
  });

  it("resta dov'è se la superficie non lo chiede", () => {
    anchor.focus();
    openPopover({ anchor, content: content("uno"), autoFocus: false, lifetime: life });
    expect(document.activeElement).toBe(anchor);
  });

  it("Esc chiude e lo riporta a chi l'aveva", () => {
    const reasons: PopoverCloseReason[] = [];
    anchor.focus();
    const popover = openPopover({
      anchor,
      content: content("uno"),
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    const event = press(document.activeElement!, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(popover.closed).toBe(true);
    expect(popover.element.isConnected).toBe(false);
    expect(document.activeElement).toBe(anchor);
    expect(reasons).toEqual(["escape"]);
  });

  it("torna a chi l'aveva anche quando non è l'ancora", () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    popover.close();
    expect(document.activeElement).toBe(field);
  });

  it("non torna se chi apre non lo vuole, né se Esc non deve chiudere", () => {
    anchor.focus();
    const popover = openPopover({
      anchor,
      content: content("uno"),
      returnFocus: false,
      dismissOnEscape: false,
      lifetime: life,
    });
    expect(press(document.activeElement!, "Escape").defaultPrevented).toBe(false);
    expect(popover.closed).toBe(false);
    popover.close();
    expect(document.activeElement).not.toBe(anchor);
  });

  it("non consuma Esc mentre si compone un carattere", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    press(document.activeElement!, "Escape", { isComposing: true });
    expect(popover.closed).toBe(false);
  });

  it("Tab dal bordo chiude e riporta il fuoco, invece di perdersi nella pagina", () => {
    const reasons: PopoverCloseReason[] = [];
    anchor.focus();
    const popover = openPopover({
      anchor,
      content: content("uno", "due"),
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    const [first, last] = [...popover.element.querySelectorAll("button")];
    // In mezzo comanda il browser.
    expect(press(first, "Tab").defaultPrevented).toBe(false);
    expect(popover.closed).toBe(false);
    last.focus();
    expect(press(last, "Tab").defaultPrevented).toBe(true);
    expect(reasons).toEqual(["tab"]);
    expect(document.activeElement).toBe(anchor);
  });

  it("Maiusc+Tab dal primo elemento chiude allo stesso modo", () => {
    anchor.focus();
    const popover = openPopover({ anchor, content: content("uno", "due"), lifetime: life });
    press(document.activeElement!, "Tab", { shiftKey: true });
    expect(popover.closed).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("andato altrove di proposito chiude senza essere richiamato", () => {
    const reasons: PopoverCloseReason[] = [];
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    anchor.focus();
    openPopover({ anchor, content: content("uno"), onClose: (reason) => reasons.push(reason), lifetime: life });
    elsewhere.focus();
    expect(reasons).toEqual(["outside"]);
    expect(document.activeElement).toBe(elsewhere);
  });

  it("tolto senza destinazione e arrivato altrove chiude anche lui", () => {
    const reasons: PopoverCloseReason[] = [];
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    anchor.focus();
    openPopover({ anchor, content: content("uno"), onClose: (reason) => reasons.push(reason), lifetime: life });
    (document.activeElement as HTMLElement).blur();
    expect(reasons).toEqual([]);
    elsewhere.focus();
    expect(reasons).toEqual(["outside"]);
    expect(document.activeElement).toBe(elsewhere);
  });

  it("tolto senza destinazione e tornato dentro resta aperto", () => {
    anchor.focus();
    const popover = openPopover({ anchor, content: content("uno", "due"), lifetime: life });
    const first = document.activeElement as HTMLElement;
    first.blur();
    first.focus();
    expect(popover.closed).toBe(false);
    // E il ritorno consuma l'attesa: un'uscita vera dopo si giudica da sé.
    const second = popover.element.querySelectorAll("button")[1];
    second.focus();
    expect(popover.closed).toBe(false);
  });
});

describe("il gesto fuori", () => {
  it("chiude senza consumare l'evento: arriva a chi doveva", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const heard = vi.fn();
    outside.addEventListener("pointerdown", heard);
    const reasons: PopoverCloseReason[] = [];
    openPopover({ anchor, content: content("uno"), onClose: (reason) => reasons.push(reason), lifetime: life });
    const event = pointer("pointerdown");
    outside.dispatchEvent(event);
    expect(reasons).toEqual(["outside"]);
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("non riporta il fuoco: è di ciò che si è premuto", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    anchor.focus();
    openPopover({ anchor, content: content("uno"), lifetime: life });
    outside.dispatchEvent(pointer("pointerdown"));
    expect(document.activeElement).not.toBe(anchor);
  });

  it("dentro la superficie o sull'ancora non è fuori", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    popover.element.querySelector("button")!.dispatchEvent(pointer("pointerdown"));
    anchor.dispatchEvent(pointer("pointerdown"));
    expect(popover.closed).toBe(false);
  });

  it("non chiude se chi apre non lo vuole", () => {
    const popover = openPopover({
      anchor,
      content: content("uno"),
      dismissOnOutside: false,
      lifetime: life,
    });
    document.body.dispatchEvent(pointer("pointerdown"));
    expect(popover.closed).toBe(false);
  });
});

describe("i popover annidati", () => {
  function nested() {
    const reasons: string[] = [];
    const parent = openPopover({
      anchor,
      content: content("figlio"),
      onClose: (reason) => reasons.push(`padre:${reason}`),
      lifetime: life,
    });
    const inner = parent.element.querySelector("button")!;
    const child = openPopover({
      anchor: inner,
      content: content("foglia"),
      onClose: (reason) => reasons.push(`figlio:${reason}`),
      lifetime: life,
    });
    return { parent, child, inner, reasons };
  }

  it("un gesto nel figlio non è «fuori» per il padre", () => {
    const { parent, child } = nested();
    child.element.querySelector("button")!.dispatchEvent(pointer("pointerdown"));
    expect(child.closed).toBe(false);
    expect(parent.closed).toBe(false);
  });

  it("il fuoco che passa al figlio non chiude il padre", () => {
    const { parent, child } = nested();
    expect(child.element.contains(document.activeElement)).toBe(true);
    expect(parent.closed).toBe(false);
  });

  it("un gesto nel padre chiude solo il figlio", () => {
    const { parent, child } = nested();
    parent.element.dispatchEvent(pointer("pointerdown"));
    expect(child.closed).toBe(true);
    expect(parent.closed).toBe(false);
  });

  it("Esc chiude un piano alla volta, dal più recente", () => {
    const { parent, child, inner, reasons } = nested();
    press(document.activeElement!, "Escape");
    expect(reasons).toEqual(["figlio:escape"]);
    expect(child.closed).toBe(true);
    expect(parent.closed).toBe(false);
    // Il fuoco è tornato nel padre, da dove il figlio era partito.
    expect(document.activeElement).toBe(inner);
    press(document.activeElement!, "Escape");
    expect(reasons).toEqual(["figlio:escape", "padre:escape"]);
    expect(document.activeElement).toBe(anchor);
  });

  it("chiudere il padre chiude prima il figlio", () => {
    const { parent, child, reasons } = nested();
    parent.close();
    expect(child.closed).toBe(true);
    expect(reasons).toEqual(["figlio:parent", "padre:manual"]);
    // Il fuoco scende di piano in piano fino a chi aveva aperto il primo.
    expect(document.activeElement).toBe(anchor);
  });

  it("un gesto fuori da tutti e due li chiude tutti e due", () => {
    const { parent, child } = nested();
    document.body.dispatchEvent(pointer("pointerdown"));
    expect(child.closed).toBe(true);
    expect(parent.closed).toBe(true);
  });
});

describe("sopra una trappola del fuoco", () => {
  it("Esc chiude il popover e non la superficie che lo ospita", () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const opener = document.createElement("button");
    modal.append(opener);
    document.body.append(modal);
    const closeModal = vi.fn();
    const release = trapFocus(modal, closeModal);
    const popover = openPopover({ anchor: opener, content: content("uno"), lifetime: life });
    // Sale sul piano del dialogo: più in basso finirebbe dietro il velo.
    expect(popover.element.dataset.layer).toBe("modal");

    press(document.activeElement!, "Escape");
    expect(popover.closed).toBe(true);
    expect(closeModal).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    // Chiuso il popover, il tasto torna alla trappola.
    press(document.activeElement!, "Escape");
    expect(closeModal).toHaveBeenCalledTimes(1);
    release();
  });

  it("fuori da un dialogo resta sul piano dei popover", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(popover.element.dataset.layer).toBeUndefined();
  });
});

describe("la posizione", () => {
  it("si ricalcola quando la finestra cambia misura o qualcosa scorre", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    box = { ...box, left: 300, top: 200 };
    window.dispatchEvent(new Event("resize"));
    expect(popover.element.style.left).toBe("300px");
    expect(popover.element.style.top).toBe("230px");

    box = { ...box, top: 400 };
    const scroller = document.createElement("div");
    document.body.append(scroller);
    scroller.dispatchEvent(new Event("scroll"));
    expect(popover.element.style.top).toBe("430px");
  });

  it("non si ricalcola per lo scorrimento del suo contenuto", () => {
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    box = { ...box, top: 400 };
    popover.element.dispatchEvent(new Event("scroll"));
    expect(popover.element.style.top).toBe("130px");
    popover.reposition();
    expect(popover.element.style.top).toBe("430px");
  });

  it("misura a riposo un'ancora che in quell'istante è premuta", () => {
    // happy-dom non calcola `scale`: lo stile calcolato dell'ancora si dichiara
    // qui, come lo dà un browser (l'origine in px dal bordo a riposo).
    const real = window.getComputedStyle.bind(window);
    const computed = (scale: string, transformOrigin: string): void => {
      vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
        el === anchor ? ({ scale, transformOrigin } as CSSStyleDeclaration) : real(el, pseudo),
      );
    };

    // Ottanta per ventiquattro in (100, 100), ceduta a nove decimi attorno al
    // centro: è questo il rettangolo che si misura mentre la si preme.
    computed("0.9", "40px 12px");
    box = { left: 104, top: 101.2, width: 72, height: 21.6 };
    const pressed = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(pressed.element.style.left).toBe("100px");
    expect(pressed.element.style.top).toBe("130px");
    pressed.close();

    // Un'origine dichiarata sposta il rettangolo ceduto, non quello a riposo.
    computed("0.9", "0px 0px");
    box = { left: 100, top: 100, width: 72, height: 21.6 };
    const cornered = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(cornered.element.style.left).toBe("100px");
    expect(cornered.element.style.top).toBe("130px");
    cornered.close();

    // Senza `scale` il rettangolo è quello misurato, com'è.
    computed("none", "40px 12px");
    box = { left: 104, top: 101.2, width: 72, height: 21.6 };
    const still = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(still.element.style.left).toBe("104px");
    expect(still.element.style.top).toBe("129px");
  });

  it("si chiude se l'ancora non è più nel documento", () => {
    const reasons: PopoverCloseReason[] = [];
    const popover = openPopover({
      anchor,
      content: content("uno"),
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    anchor.remove();
    window.dispatchEvent(new Event("resize"));
    expect(popover.closed).toBe(true);
    expect(reasons).toEqual(["detached"]);
  });

  it("su un'ancora già staccata non si apre affatto", () => {
    anchor.remove();
    const onClose = vi.fn();
    const popover = openPopover({ anchor, content: content("uno"), onClose, lifetime: life });
    expect(popover.closed).toBe(true);
    expect(popover.element.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledWith("detached");
  });
});

describe("lo smontaggio", () => {
  it("chiudere la vita chiude il popover", () => {
    const reasons: PopoverCloseReason[] = [];
    const popover = openPopover({
      anchor,
      content: content("uno"),
      onClose: (reason) => reasons.push(reason),
      lifetime: life,
    });
    life.close();
    expect(popover.closed).toBe(true);
    expect(popover.element.isConnected).toBe(false);
    expect(reasons).toEqual(["lifetime"]);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });

  it("su una vita già chiusa si apre e si chiude nello stesso istante", () => {
    life.close();
    const onClose = vi.fn();
    const popover = openPopover({ anchor, content: content("uno"), onClose, lifetime: life });
    expect(popover.closed).toBe(true);
    expect(popover.element.isConnected).toBe(false);
    expect(onClose).toHaveBeenCalledWith("lifetime");
  });

  it("chiude una volta sola", () => {
    const onClose = vi.fn();
    const popover = openPopover({ anchor, content: content("uno"), onClose, lifetime: life });
    popover.close();
    popover.close("escape");
    life.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("manual");
  });

  it("aperto e chiuso molte volte non lascia ascolti su finestra e documento", () => {
    const live = listenerLedger(window, document);
    for (let round = 0; round < 5; round++) {
      const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
      const child = openPopover({
        anchor: popover.element.querySelector("button")!,
        content: content("due"),
        lifetime: life,
      });
      expect(live()).toBeGreaterThan(0);
      if (round % 2 === 0) popover.close();
      else press(child.element, "Escape"), press(popover.element, "Escape");
      expect(popover.closed && child.closed).toBe(true);
    }
    expect(live()).toBe(0);
    expect(openLayers()).toBe(0);
    expect(document.querySelectorAll(".kit-popover").length).toBe(0);
  });

  it("dopo la chiusura i gesti non arrivano più a nessuno", () => {
    const onClose = vi.fn();
    const popover = openPopover({ anchor, content: content("uno"), onClose, lifetime: life });
    popover.close();
    document.body.dispatchEvent(pointer("pointerdown"));
    press(document.body, "Escape");
    window.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("il movimento", () => {
  it("entra con la molla morbida da scala e opacità, e non lascia niente", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(driver.plays.length).toBe(1);
    const play = driver.plays[0];
    expect(play.el).toBe(popover.element);
    expect(play.keyframes[0].opacity).toBe(0);
    expect(String(play.keyframes[0].transform)).toContain("scale(0.96");
    // Sotto l'ancora: parte spostata verso di lei.
    expect(String(play.keyframes[0].transform)).toContain("translate(0px, -6px)");
    expect(activeMotions()).toBe(1);
    driver.advance(2000);
    expect(activeMotions()).toBe(0);
    expect(popover.element.style.transform).toBe("");
    expect(popover.element.style.opacity).toBe("");
  });

  it("chiuso a metà entrata ferma la corsa", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const popover = openPopover({ anchor, content: content("uno"), lifetime: life });
    driver.advance(32);
    expect(activeMotions()).toBe(1);
    popover.close();
    expect(activeMotions()).toBe(0);
  });

  it("nel livello ridotto resta la sola opacità", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    openPopover({ anchor, content: content("uno"), lifetime: life });
    expect(driver.plays.length).toBe(1);
    expect(driver.plays[0].keyframes.every((frame) => frame.transform === undefined)).toBe(true);
    expect(driver.plays[0].keyframes[0].opacity).toBe(0);
    driver.advance(1000);
    expect(activeMotions()).toBe(0);
  });
});
