// @vitest-environment happy-dom
//
// Il rilascio del tasto destro che segue l'apertura del menu (IMP-6201).
//
// Gli eventi sono quelli misurati nell'app vera con WebKitWebDriver: su Linux
// il `contextmenu` arriva alla pressione (`buttons` 2), il rilascio è un
// `mouseup` sopra il menu e un `click` col `button` del sinistro sull'antenato
// comune fra la riga e il menu. Su Windows il `contextmenu` arriva dopo il
// rilascio, e Chromium al rilascio manda `auxclick`, non `click`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeContextMenu, showContextMenu } from "./menu";
import { RELEASE_SLOP_PX } from "./menu-release";

const AT = { x: 40, y: 30 };

function mouse(target: EventTarget, type: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: AT.x, clientY: AT.y, ...init });
  target.dispatchEvent(event);
  return event;
}

function pointer(target: EventTarget, type: string, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", clientX: AT.x, clientY: AT.y, ...init }));
}

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>("#context-menu:not(.exiting)");
const item = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")].find((b) => b.textContent?.includes(label))!;

describe("il rilascio del tasto destro che ha aperto il menu", () => {
  let workspace: HTMLElement;
  let row: HTMLElement;
  let rowClicks: number;
  let opened: string[];
  let closed: number;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    workspace = document.createElement("main");
    workspace.id = "workspace";
    row = document.createElement("div");
    row.className = "tree-row";
    row.textContent = "appunti";
    workspace.append(row);
    document.body.append(workspace);
    rowClicks = 0;
    opened = [];
    closed = 0;
    // Come una riga dell'albero: il clic apre la nota, il tasto destro il menu.
    row.addEventListener("click", () => rowClicks++);
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: "Apri a lato", run: () => opened.push("lato") },
        { label: "Rinomina", run: () => opened.push("rinomina") },
      ], { header: { icon: "note", kind: "Nota", name: "appunti" }, onClose: () => closed++ });
    });
  });

  afterEach(() => {
    closeContextMenu();
    // Ogni prova finisce con la pressione chiusa: la guardia non passa alla dopo.
    mouse(document.body, "mousedown", { button: 0, buttons: 1 });
    vi.runAllTimers();
    vi.useRealTimers();
  });

  /// La pressione di Linux: il menu compare col tasto ancora giù.
  function pressLinux(): void {
    pointer(row, "pointerdown", { button: 2, buttons: 2 });
    mouse(row, "mousedown", { button: 2, buttons: 2 });
    mouse(row, "contextmenu", { button: 2, buttons: 2 });
    // La mano tiene premuto: il menu ha avuto il tempo di mettersi in ascolto.
    vi.advanceTimersByTime(300);
  }

  /// Il rilascio di WebKitGTK nel punto `at`: `mouseup` sul bersaglio e
  /// `click` (col `button` del sinistro) sull'antenato comune con la riga.
  function releaseLinux(on: Element, at = AT): void {
    pointer(on, "pointerup", { button: 2, buttons: 0, clientX: at.x, clientY: at.y });
    mouse(on, "mouseup", { button: 0, buttons: 2, clientX: at.x, clientY: at.y });
    mouse(workspace, "click", { button: 0, buttons: 0, detail: 1, clientX: at.x, clientY: at.y });
    mouse(workspace, "auxclick", { button: 2, buttons: 0, detail: 1, clientX: at.x, clientY: at.y });
    vi.runOnlyPendingTimers();
  }

  it("su Linux il menu resta aperto dopo il rilascio, e niente si apre", () => {
    pressLinux();
    expect(menu()).not.toBeNull();
    releaseLinux(menu()!);
    expect(menu()).not.toBeNull();
    expect(closed).toBe(0);
    expect(opened).toEqual([]);
    expect(rowClicks).toBe(0);
  });

  it("il rilascio sopra una voce, senza essersi mosso, non la sceglie", () => {
    pressLinux();
    // Il menu nasce sotto il puntatore: col margine dello schermo può essere
    // una voce a starci sotto, invece della testata.
    releaseLinux(item("Apri a lato"), { x: AT.x + RELEASE_SLOP_PX - 1, y: AT.y });
    expect(menu()).not.toBeNull();
    expect(opened).toEqual([]);
  });

  it("dopo il rilascio un clic sinistro su una voce la sceglie, una volta", () => {
    pressLinux();
    releaseLinux(menu()!);
    const target = item("Rinomina");
    mouse(target, "mousedown", { button: 0, buttons: 1 });
    mouse(target, "mouseup", { button: 0, buttons: 0 });
    target.click();
    expect(opened).toEqual(["rinomina"]);
    expect(menu()).toBeNull();
  });

  it("dopo il rilascio un clic sinistro fuori lo chiude, ed Esc anche", () => {
    pressLinux();
    releaseLinux(menu()!);
    mouse(document.body, "mousedown", { button: 0, buttons: 1 });
    mouse(document.body, "mouseup", { button: 0, buttons: 0 });
    mouse(document.body, "click", { button: 0, detail: 1 });
    expect(menu()).toBeNull();
    expect(closed).toBe(1);

    pressLinux();
    releaseLinux(menu()!);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    expect(opened).toEqual([]);
  });

  it("premere, scorrere fino a una voce e rilasciare la sceglie, come nei menu di GTK", () => {
    pressLinux();
    const target = item("Apri a lato");
    releaseLinux(target, { x: AT.x + 30, y: AT.y + 20 });
    expect(opened).toEqual(["lato"]);
    expect(menu()).toBeNull();
    expect(rowClicks).toBe(0);
  });

  it("Esc a tasto ancora giù chiude il menu, e il rilascio non arriva alla riga sotto", () => {
    pressLinux();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    pointer(row, "pointerup", { button: 2, buttons: 0 });
    mouse(row, "mouseup", { button: 0, buttons: 2 });
    mouse(row, "click", { button: 0, detail: 1 });
    vi.runOnlyPendingTimers();
    expect(rowClicks).toBe(0);
  });

  it("un rilascio perso fuori dalla finestra non si mangia il clic dopo", () => {
    pressLinux();
    // Il tasto si è alzato fuori: la prossima cosa è una pressione nuova.
    mouse(document.body, "mousedown", { button: 0, buttons: 1 });
    mouse(document.body, "mouseup", { button: 0, buttons: 0 });
    mouse(document.body, "click", { button: 0, detail: 1 });
    expect(menu()).toBeNull();
    vi.runOnlyPendingTimers();
    mouse(row, "mousedown", { button: 0, buttons: 1 });
    mouse(row, "mouseup", { button: 0, buttons: 0 });
    mouse(row, "click", { button: 0, detail: 1 });
    expect(rowClicks).toBe(1);
  });

  it("su Windows il menu arriva dopo il rilascio e resta; il clic dopo è un clic vero", () => {
    pointer(row, "pointerdown", { button: 2, buttons: 2 });
    mouse(row, "mousedown", { button: 2, buttons: 2 });
    pointer(row, "pointerup", { button: 2, buttons: 0 });
    mouse(row, "mouseup", { button: 2, buttons: 0 });
    mouse(row, "auxclick", { button: 2, buttons: 0, detail: 1 });
    mouse(row, "contextmenu", { button: 2, buttons: 0 });
    vi.advanceTimersByTime(300);
    expect(menu()).not.toBeNull();
    const target = item("Rinomina");
    target.click();
    expect(opened).toEqual(["rinomina"]);
  });

  it("Maiusc+F10 non arma la guardia: il primo clic fuori chiude", () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(300);
    expect(menu()).not.toBeNull();
    mouse(document.body, "click", { button: 0, detail: 1 });
    expect(menu()).toBeNull();
  });
});
