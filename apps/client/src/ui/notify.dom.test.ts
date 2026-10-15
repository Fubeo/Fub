// @vitest-environment happy-dom
// Il gesto di un toast che il backend rifiuta dice **perché**, con la frase
// dell'errore: il confine Tauri consegna `{kind, message}`, e `String(error)`
// ne faceva `[object Object]` (I65).
import { afterEach, describe, expect, it } from "vitest";
import { clearHistory, notify, recentNotices, TOAST_STACK_LIMIT } from "./notify";

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

  it("chiuso l'ultimo toast la pila sparisce", () => {
    notify("Solo", "guasto");
    document.querySelector<HTMLButtonElement>(".toast-close")!.click();
    expect(document.getElementById("toasts")).toBeNull();
  });
});
