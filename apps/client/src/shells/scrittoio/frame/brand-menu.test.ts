// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { mountBrandMenu } from "./brand-menu";

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/// Il marchio e la striscia del menu come stanno in `index.html`, più un
/// punto qualunque della finestra dove cliccare «altrove».
function markup(): void {
  document.body.innerHTML = `
    <header id="topbar">
      <button id="brand-menu" type="button" aria-haspopup="true" aria-expanded="false"><span id="brand-mark"></span></button>
      <nav id="app-menu" role="menubar"><button id="menu-file" type="button">File</button><button id="menu-edit" type="button">Modifica</button></nav>
    </header>
    <main id="workspace"><button id="elsewhere" type="button"></button></main>`;
  place(8, 30);
}

const el = (id: string): HTMLElement => document.getElementById(id)!;
const brand = (): HTMLElement => el("brand-menu");
const menu = (): HTMLElement => el("app-menu");
const isOpen = (): boolean => menu().classList.contains("open");
const expanded = (): string | null => brand().getAttribute("aria-expanded");

/// Dove il layout mette il marchio: happy-dom non impagina.
function place(left: number, width: number): void {
  Object.defineProperty(brand(), "offsetLeft", { get: () => left, configurable: true });
  Object.defineProperty(brand(), "offsetWidth", { get: () => width, configurable: true });
}

function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

let lifetime: Lifetime;
/// Testimoni fuori dal modulo: ciò che arriva fino al documento o alle voci.
let witness: Lifetime;

beforeEach(() => {
  markup();
  lifetime = openLifetime();
  witness = openLifetime();
});

afterEach(() => {
  lifetime.close();
  witness.close();
  document.body.replaceChildren();
});

describe("il marchio a riposo", () => {
  it("dice che il menu è chiuso, e non lo apre", () => {
    mountBrandMenu(lifetime);
    expect(expanded()).toBe("false");
    expect(isOpen()).toBe(false);
  });

  it("montato su un menu già aperto lo dice subito", () => {
    menu().classList.add("open");
    mountBrandMenu(lifetime);
    expect(expanded()).toBe("true");
  });
});

describe("il marchio premuto", () => {
  it("apre la striscia subito dopo di sé e porta il fuoco sulla prima voce", async () => {
    mountBrandMenu(lifetime);
    brand().click();
    expect(isOpen()).toBe(true);
    // 8 di margine, 30 di marchio, 4 di spazio prima della prima voce.
    expect(el("topbar").style.getPropertyValue("--brand-end")).toBe("42px");
    expect(document.activeElement).toBe(el("menu-file"));
    await settled();
    expect(expanded()).toBe("true");
  });

  it("premuto di nuovo la richiude", async () => {
    mountBrandMenu(lifetime);
    brand().click();
    await settled();
    brand().click();
    expect(isOpen()).toBe(false);
    await settled();
    expect(expanded()).toBe("false");
  });

  it("rimisura dov'è a ogni apertura", () => {
    mountBrandMenu(lifetime);
    brand().click();
    brand().click();
    place(12, 44);
    brand().click();
    expect(el("topbar").style.getPropertyValue("--brand-end")).toBe("60px");
  });

  it("un clic su ciò che contiene vale come un clic sul marchio", () => {
    mountBrandMenu(lifetime);
    el("brand-mark").click();
    expect(isOpen()).toBe(true);
  });

  it("il clic resta suo: non arriva a chi ascolta il documento", () => {
    const outside = vi.fn();
    witness.listen(document, "click", outside);
    mountBrandMenu(lifetime);
    brand().click();
    expect(outside).not.toHaveBeenCalled();
  });

  it("senza la barra del titolo si apre lo stesso", () => {
    document.body.append(brand(), menu());
    el("topbar").remove();
    mountBrandMenu(lifetime);
    expect(() => brand().click()).not.toThrow();
    expect(isOpen()).toBe(true);
  });

  it("un menu ancora senza voci si apre senza spostare il fuoco", () => {
    menu().replaceChildren();
    mountBrandMenu(lifetime);
    brand().focus();
    expect(() => brand().click()).not.toThrow();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(brand());
  });
});

describe("lo stato è della striscia, non del marchio", () => {
  it("chi toglie o mette `open` da fuori, il marchio lo viene a sapere", async () => {
    mountBrandMenu(lifetime);
    menu().classList.add("open");
    await settled();
    expect(expanded()).toBe("true");
    menu().classList.remove("open");
    await settled();
    expect(expanded()).toBe("false");
  });
});

describe("Escape nella striscia", () => {
  it("la chiude, riporta il fuoco sul marchio e non arriva alle voci", async () => {
    const reached = vi.fn();
    witness.listen(el("menu-file"), "keydown", reached);
    mountBrandMenu(lifetime);
    brand().click();
    const event = press(el("menu-file"), "Escape");
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(brand());
    expect(event.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    await settled();
    expect(expanded()).toBe("false");
  });

  it("a striscia chiusa non è affar suo", () => {
    const reached = vi.fn();
    witness.listen(el("menu-file"), "keydown", reached);
    mountBrandMenu(lifetime);
    const event = press(el("menu-file"), "Escape");
    expect(event.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it("gli altri tasti passano alle voci, e la striscia resta aperta", () => {
    const reached = vi.fn();
    witness.listen(el("menu-file"), "keydown", reached);
    mountBrandMenu(lifetime);
    brand().click();
    const event = press(el("menu-file"), "ArrowRight");
    expect(event.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);
  });
});

describe("un clic altrove", () => {
  it("richiude la striscia", async () => {
    mountBrandMenu(lifetime);
    brand().click();
    el("elsewhere").click();
    expect(isOpen()).toBe(false);
    await settled();
    expect(expanded()).toBe("false");
  });

  it("dentro la striscia no: le sue voci devono poter aprire le tendine", () => {
    mountBrandMenu(lifetime);
    brand().click();
    el("menu-edit").click();
    expect(isOpen()).toBe(true);
  });

  it("a striscia chiusa non apre niente", () => {
    mountBrandMenu(lifetime);
    el("elsewhere").click();
    expect(isOpen()).toBe(false);
  });
});

describe("il fuoco quando la striscia si richiude", () => {
  /// Una voce scelta: il fuoco è su una voce della striscia, e qualcuno la chiude.
  async function chooseAndClose(): Promise<void> {
    el("menu-file").focus();
    menu().classList.remove("open");
    await settled();
  }

  it("aperta col puntatore, torna dov'era prima del marchio", async () => {
    mountBrandMenu(lifetime);
    el("elsewhere").focus();
    brand().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    brand().click();
    await chooseAndClose();
    expect(document.activeElement).toBe(el("elsewhere"));
  });

  it("aperta da tastiera, torna sul marchio", async () => {
    mountBrandMenu(lifetime);
    brand().focus();
    brand().click();
    await chooseAndClose();
    expect(document.activeElement).toBe(brand());
  });

  it("se ciò che aveva il fuoco non c'è più, torna sul marchio", async () => {
    mountBrandMenu(lifetime);
    el("elsewhere").focus();
    brand().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    brand().click();
    el("elsewhere").remove();
    await chooseAndClose();
    expect(document.activeElement).toBe(brand());
  });

  it("se il comando scelto ha già portato il fuoco altrove, non lo riprende", async () => {
    mountBrandMenu(lifetime);
    brand().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    brand().click();
    const landed = document.createElement("button");
    el("workspace").append(landed);
    landed.focus();
    menu().classList.remove("open");
    await settled();
    expect(document.activeElement).toBe(landed);
  });
});

describe("il markup che manca", () => {
  it("senza il marchio non tocca la striscia", () => {
    brand().remove();
    mountBrandMenu(lifetime);
    menu().classList.add("open");
    el("elsewhere").click();
    expect(isOpen()).toBe(true);
  });

  it("senza la striscia il marchio resta com'è scritto, e premerlo non lancia", () => {
    menu().remove();
    brand().setAttribute("aria-expanded", "com'era");
    mountBrandMenu(lifetime);
    expect(() => brand().click()).not.toThrow();
    expect(expanded()).toBe("com'era");
  });
});

describe("il marchio smontato", () => {
  it("non apre più, e non segue più la striscia", async () => {
    mountBrandMenu(lifetime);
    lifetime.close();
    brand().click();
    expect(isOpen()).toBe(false);
    expect(el("topbar").style.getPropertyValue("--brand-end")).toBe("");

    menu().classList.add("open");
    await settled();
    expect(expanded()).toBe("false");
  });

  it("una striscia rimasta aperta non si chiude più per causa sua", () => {
    mountBrandMenu(lifetime);
    brand().click();
    lifetime.close();

    const event = press(el("menu-file"), "Escape");
    expect(event.defaultPrevented).toBe(false);
    el("elsewhere").click();
    expect(isOpen()).toBe(true);
  });
});
