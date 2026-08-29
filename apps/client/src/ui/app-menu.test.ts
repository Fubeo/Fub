// @vitest-environment happy-dom
//
// La menubar apre il menu contestuale condiviso, ma non ne possiede né Escape né
// il click fuori: la sua sola responsabilità è riflettere la vita di quel menu
// in `aria-expanded`. Questi casi tengono insieme i due confini.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusTrapOwnsKeyboard, trapFocus } from "./a11y";
import { mountAppMenu } from "./app-menu";
import { closeContextMenu, showContextMenu } from "./menu";

function escape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("la menubar applicativa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app-menu" role="menubar"></div>';
  });

  afterEach(() => {
    closeContextMenu();
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("lascia Escape alla trappola in cima e poi sincronizza la chiusura del menu", () => {
    const unmount = mountAppMenu({ run: vi.fn() });
    const menuButton = document.querySelector<HTMLButtonElement>("#app-menu button")!;
    menuButton.click();
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");

    const upper = document.createElement("div");
    upper.tabIndex = -1;
    upper.innerHTML = '<button id="upper-action">Conferma</button>';
    document.body.appendChild(upper);
    let upperClosed = 0;
    const releaseUpper = trapFocus(upper, () => {
      upperClosed += 1;
      releaseUpper();
    });

    expect(escape().defaultPrevented, "la trappola in cima intercetta Escape").toBe(true);
    expect(upperClosed).toBe(1);
    expect(document.getElementById("context-menu"), "il menu sotto resta aperto").not.toBeNull();
    expect(menuButton.getAttribute("aria-expanded"), "il menu sotto resta annunciato aperto").toBe(
      "true",
    );
    expect(focusTrapOwnsKeyboard(), "la trappola del menu ora possiede la tastiera").toBe(true);

    expect(escape().defaultPrevented, "il secondo Escape arriva al menu rimasto").toBe(true);
    expect(menuButton.getAttribute("aria-expanded"), "la chiusura condivisa aggiorna aria").toBe(
      "false",
    );
    expect(focusTrapOwnsKeyboard()).toBe(false);
    expect(escape().defaultPrevented, "non resta un listener Escape della menubar").toBe(false);

    unmount();
  });

  it("sincronizza aria-expanded con click fuori, scelta e sostituzione", () => {
    const run = vi.fn();
    const unmount = mountAppMenu({ run });
    const menuButton = document.querySelector<HTMLButtonElement>("#app-menu button")!;

    menuButton.click();
    vi.advanceTimersByTime(0);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(menuButton.getAttribute("aria-expanded"), "il click fuori chiude anche lo stato").toBe(
      "false",
    );

    menuButton.click();
    document.querySelector<HTMLButtonElement>("#context-menu button")!.click();
    expect(run, "la voce conserva il suo comando").toHaveBeenCalledTimes(1);
    expect(menuButton.getAttribute("aria-expanded"), "la scelta chiude anche lo stato").toBe(
      "false",
    );

    menuButton.click();
    showContextMenu(
      new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }),
      [{ label: "Altro menu", run: () => {} }],
    );
    expect(menuButton.getAttribute("aria-expanded"), "la sostituzione chiude anche lo stato").toBe(
      "false",
    );
    closeContextMenu();

    unmount();
  });

  it("chiude il menu della menubar nello smontaggio una sola volta", () => {
    const unmount = mountAppMenu({ run: vi.fn() });
    const menuButton = document.querySelector<HTMLButtonElement>("#app-menu button")!;
    const setAttribute = vi.spyOn(menuButton, "setAttribute");

    menuButton.click();
    unmount();
    unmount();

    expect(
      setAttribute.mock.calls.filter(([name]) => name === "aria-expanded"),
      "lo smontaggio completa una sola vita del menu",
    ).toEqual([
      ["aria-expanded", "true"],
      ["aria-expanded", "false"],
    ]);
  });
});
