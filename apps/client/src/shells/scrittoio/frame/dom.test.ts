// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { below, beside, byId, follow, menuTrigger } from "./dom";

/// Gli osservatori consegnano a fine giro.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/// Un bottone con un posto finto nella finestra: happy-dom non impagina.
function placed(rect: { left: number; top: number; right: number; bottom: number }): HTMLElement {
  const trigger = document.createElement("button");
  trigger.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }) as DOMRect;
  document.body.append(trigger);
  return trigger;
}

let lifetime: Lifetime;

beforeEach(() => {
  lifetime = openLifetime();
});

afterEach(() => {
  closeContextMenu();
  lifetime.close();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("byId", () => {
  it("trova il nodo che il markup promette, e dice `null` quando non c'è", () => {
    document.body.innerHTML = '<button id="pill"></button>';
    expect(byId("pill")).toBe(document.body.firstElementChild);
    expect(byId("non-c-e")).toBeNull();
  });
});

describe("follow", () => {
  it("con gli attributi nominati reagisce a quelli e a nessun altro", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const react = vi.fn();
    follow(lifetime, target, react, { attributes: ["hidden"] });
    expect(react).not.toHaveBeenCalled();

    target.setAttribute("title", "altro");
    target.textContent = "anche il testo non conta";
    await settled();
    expect(react).not.toHaveBeenCalled();

    target.hidden = true;
    await settled();
    expect(react).toHaveBeenCalledTimes(1);
  });

  it("più cambi nello stesso giro sono una reazione sola", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const react = vi.fn();
    follow(lifetime, target, react, { attributes: ["class", "hidden"] });
    target.className = "open";
    target.hidden = true;
    target.className = "";
    await settled();
    expect(react).toHaveBeenCalledTimes(1);
  });

  it("guarda i discendenti solo se glielo si chiede", async () => {
    const target = document.createElement("div");
    const child = document.createElement("span");
    target.append(child);
    document.body.append(target);
    const shallow = vi.fn();
    const deep = vi.fn();
    follow(lifetime, target, shallow, { attributes: ["data-mode"] });
    follow(lifetime, target, deep, { attributes: ["data-mode"], subtree: true });

    child.dataset.mode = "source";
    await settled();
    expect(shallow).not.toHaveBeenCalled();
    expect(deep).toHaveBeenCalledTimes(1);
  });

  it("senza attributi segue il testo e i figli, anche in profondità, e non gli attributi", async () => {
    const target = document.createElement("span");
    document.body.append(target);
    const react = vi.fn();
    follow(lifetime, target, react);

    target.setAttribute("title", "non è testo");
    await settled();
    expect(react).not.toHaveBeenCalled();

    target.textContent = "Appunti";
    await settled();
    expect(react).toHaveBeenCalledTimes(1);

    (target.firstChild as Text).data = "Diario";
    await settled();
    expect(react).toHaveBeenCalledTimes(2);

    const inner = document.createElement("b");
    target.append(inner);
    await settled();
    expect(react).toHaveBeenCalledTimes(3);

    inner.append("in fondo");
    await settled();
    expect(react).toHaveBeenCalledTimes(4);
  });

  it("chiusa la vita non reagisce più", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const react = vi.fn();
    follow(lifetime, target, react, { attributes: ["hidden"] });
    lifetime.close();
    target.hidden = true;
    await settled();
    expect(react).not.toHaveBeenCalled();
  });

  it("un cambio già avvenuto ma non ancora consegnato muore con la vita", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const react = vi.fn();
    follow(lifetime, target, react, { attributes: ["hidden"] });
    target.hidden = true;
    lifetime.close();
    await settled();
    expect(react).not.toHaveBeenCalled();
  });

  it("su una vita già chiusa non lascia un osservatore acceso", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const react = vi.fn();
    lifetime.close();
    follow(lifetime, target, react, { attributes: ["hidden"] });
    target.hidden = true;
    await settled();
    expect(react).not.toHaveBeenCalled();
  });

  it("dove `MutationObserver` non esiste non fa niente e non lancia", () => {
    vi.stubGlobal("MutationObserver", undefined);
    const target = document.createElement("div");
    const react = vi.fn();
    expect(() => follow(lifetime, target, react, { attributes: ["hidden"] })).not.toThrow();
    target.hidden = true;
    expect(react).not.toHaveBeenCalled();
  });
});

describe("i clic finti che dicono al menu dove aprirsi", () => {
  it("`below` punta sotto il bottone, allineato a sinistra, con il suo scarto", () => {
    const trigger = placed({ left: 10, top: 20, right: 110, bottom: 50 });
    const at = below(trigger);
    expect(at.type).toBe("click");
    expect([at.clientX, at.clientY]).toEqual([10, 54]);
    const tight = below(trigger, 0);
    expect([tight.clientX, tight.clientY]).toEqual([10, 50]);
  });

  it("`beside` punta a fianco del bottone, allineato in alto, con il suo scarto", () => {
    const trigger = placed({ left: 10, top: 20, right: 110, bottom: 50 });
    const at = beside(trigger);
    expect(at.type).toBe("click");
    expect([at.clientX, at.clientY]).toEqual([116, 20]);
    const wide = beside(trigger, 12);
    expect([wide.clientX, wide.clientY]).toEqual([122, 20]);
  });
});

describe("il bottone che apre un menu", () => {
  const menu = (): HTMLElement | null => document.getElementById("context-menu");
  const items = [{ label: "Una voce", run: () => {} }];

  it("dice aperto finché il menu si vede, e chiuso quando lo si chiude da fuori", () => {
    const button = placed({ left: 0, top: 0, right: 20, bottom: 20 });
    button.id = "apre";
    const trigger = menuTrigger(button);
    expect(trigger.open).toBe(false);

    trigger.show(below(button), items);
    expect(trigger.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.getAttribute("aria-labelledby")).toBe("apre");

    closeContextMenu();
    expect(trigger.open).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("riaperto sopra se stesso, l'avviso del menu vecchio non lo dichiara chiuso", () => {
    const button = placed({ left: 0, top: 0, right: 20, bottom: 20 });
    const trigger = menuTrigger(button);
    trigger.show(below(button), items);
    trigger.show(below(button), items);
    expect(trigger.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("`close` chiude il proprio menu e non quello di un altro", () => {
    const one = placed({ left: 0, top: 0, right: 20, bottom: 20 });
    const other = placed({ left: 40, top: 0, right: 60, bottom: 20 });
    const first = menuTrigger(one);
    const second = menuTrigger(other);
    first.show(below(one), items);
    second.show(below(other), items);
    expect(first.open).toBe(false);
    expect(one.getAttribute("aria-expanded")).toBe("false");

    first.close();
    expect(second.open).toBe(true);
    expect(other.getAttribute("aria-expanded")).toBe("true");

    second.close();
    expect(second.open).toBe(false);
    expect(other.getAttribute("aria-expanded")).toBe("false");
  });
});
