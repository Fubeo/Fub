// @vitest-environment happy-dom
// Il gesto di un toast che il backend rifiuta dice **perché**, con la frase
// dell'errore: il confine Tauri consegna `{kind, message}`, e `String(error)`
// ne faceva `[object Object]` (I65).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualDriver, setMotionDriver } from "../moto";
import { clearHistory, notify, openHistory, recentNotices, setWatcherOff, TOAST_STACK_LIMIT } from "./notify";

describe("il gesto di un toast", () => {
  afterEach(() => {
    clearHistory();
    document.body.innerHTML = "";
  });

  it("rifiutato dal backend, notifica il messaggio dell'errore", async () => {
    const refused = { kind: "already_exists", message: "Il file esiste già" };
    notify("Nota eliminata", "info", { label: "Ricrea la nota", run: () => Promise.reject(refused) });
    document.querySelector<HTMLButtonElement>(".toast-action")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recentNotices()[0]).toMatchObject({ text: "Il file esiste già", tone: "guasto" });
  });

  it("un errore della webview dà il suo messaggio, senza il prefisso `Error:`", async () => {
    notify("Nota eliminata", "info", { label: "Riprova", run: () => Promise.reject(new Error("rotto qui")) });
    document.querySelector<HTMLButtonElement>(".toast-action")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recentNotices()[0]!.text).toBe("rotto qui");
  });
});

describe("la pila dei toast", () => {
  afterEach(() => {
    clearHistory();
    document.body.innerHTML = "";
  });
  const toasts = () => [...document.querySelectorAll<HTMLElement>("#toasts > .toast")];

  it("due avvisi restano tutti e due, il più recente in fondo", () => {
    notify("Prima", "info");
    notify("Seconda", "info");
    expect(toasts().map((toast) => toast.querySelector(".toast-text")?.textContent)).toEqual(["Prima", "Seconda"]);
  });

  it("più azioni accanto allo stesso messaggio, ognuna col suo gesto", () => {
    const ran: string[] = [];
    notify("Fatto", "info", [
      { label: "Annulla", hint: "Sposta la nota", run: () => void ran.push("annulla") },
      { label: "Apri", run: () => void ran.push("apri") },
    ]);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".toast-action")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Annulla", "Apri"]);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Annulla: Sposta la nota");
    buttons[1]!.click();
    expect(ran).toEqual(["apri"]);
    expect(toasts()).toHaveLength(0);
  });

  it("un avviso identico a quello in fondo ne rinnova il contatore invece di aprirne un altro", () => {
    notify("Salvataggio non riuscito", "guasto");
    notify("Salvataggio non riuscito", "guasto");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.querySelector(".toast-text")?.textContent).toBe("Salvataggio non riuscito ×2");
  });

  it("oltre il limite esce il più vecchio e un «+N altri» lo conta", () => {
    for (let i = 0; i <= TOAST_STACK_LIMIT; i += 1) notify(`Avviso ${i}`, "guasto");
    expect(toasts()).toHaveLength(TOAST_STACK_LIMIT);
    expect(toasts()[0]!.textContent).toContain("Avviso 1");
    expect(document.querySelector("#toasts > .toast-more")?.textContent).toBe("+1 altri");
  });

  it("chiuso, esce come immagine in meno di un battito e gli altri scorrono al suo posto", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    // Il layout in happy-dom non c'è: ogni toast è alto 50 px nella sua pila.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = this.classList.contains("toast") && this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return { left: 0, top: index * 50, width: 300, height: 40, right: 300, bottom: index * 50 + 40, x: 0, y: index * 50, toJSON: () => ({}) } as DOMRect;
    });
    try {
      notify("Prima", "info");
      notify("Seconda", "info");
      toasts()[0]!.querySelector<HTMLButtonElement>(".toast-close")!.click();
      // Lo stato cambia subito: nella pila resta la seconda.
      expect(toasts().map((toast) => toast.querySelector(".toast-text")?.textContent)).toEqual(["Seconda"]);
      const ghost = document.querySelector<HTMLElement>("body > .toast[aria-hidden='true']");
      expect(ghost?.textContent).toContain("Prima");
      const exit = driver.plays.find((play) => play.el === ghost)!;
      expect(exit.timing.duration).toBeLessThanOrEqual(140);
      // La seconda parte da dove era, 50 px più in basso.
      // L'ultima sua corsa: la prima è la sua entrata.
      const slide = driver.plays.filter((play) => play.el === toasts()[0]).pop()!;
      expect(slide.keyframes[0]!.transform).toBe("translate(0px, 50px)");
    } finally {
      vi.restoreAllMocks();
      setMotionDriver(null);
    }
  });

  it("chiuso l'ultimo toast la pila sparisce", () => {
    notify("Solo", "guasto");
    document.querySelector<HTMLButtonElement>(".toast-close")!.click();
    expect(document.getElementById("toasts")).toBeNull();
  });
});

describe("il rilevamento assente, nel centro", () => {
  afterEach(() => {
    setWatcherOff(false);
    openHistory(false);
    clearHistory();
    document.body.innerHTML = "";
  });

  it("dice che cosa non si vede e offre il gesto che lo rimette", async () => {
    document.body.innerHTML = `<button id="notify-button"></button><div id="notify-panel"><ul id="notify-list"></ul></div>`;
    let reopened = 0;
    setWatcherOff(true, async () => void reopened++);
    openHistory(true);
    const note = document.querySelector("#notify-list > li")!;
    expect(note.textContent).toContain("Riaprire il vault le rilegge");
    const button = note.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Riapri il vault");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reopened).toBe(1);
    // Tornato il rilevamento, la riga e il suo gesto non ci sono più.
    setWatcherOff(false);
    expect(document.querySelector("#notify-list button")).toBeNull();
  });

  it("l'ora di un avviso è relativa, i secondi nel suggerimento", () => {
    document.body.innerHTML = `<button id="notify-button"></button><div id="notify-panel"><ul id="notify-list"></ul></div>`;
    notify("Fatto", "info");
    openHistory(true);
    expect(document.querySelector(".notify-ora")!.textContent).toBe("adesso");
  });
});
