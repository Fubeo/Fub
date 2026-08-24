// @vitest-environment happy-dom
//
// Le due finestrelle di `ui/menu.ts`, e la domanda che nessuno faceva loro:
// **cosa resta appeso quando si chiudono?**
//
// Erano due difetti misurati e sono uno solo: il menu contestuale registrava un
// `click` su `document` da dentro un `setTimeout`, e se il menu si chiudeva
// prima — con Escape, o scegliendo una voce da tastiera — quell'ascoltatore si
// attaccava un istante dopo a un menu che non c'era più, e restava lì fino al
// primo click qualunque; il selettore di icona, riaperto, si toglieva il nodo da
// sotto (`getElementById("icon-picker")?.remove()`) senza passare per il proprio
// `chiudi()`, e lasciava attaccati l'ascoltatore su `document` e la trappola del
// fuoco della finestrella precedente.
//
// Sono due sintomi della stessa causa — *chi registra non ha modo di
// disiscriversi* — e si chiudono insieme perché adesso i due condividono la
// forma: una `Lifetime` per finestrella aperta, e chiudere è chiuderla.
//
// # Come si guarda un ascoltatore che non deve esserci
//
// Emettendo l'evento e guardando chi risponde, mai aspettando. Per la trappola
// del fuoco la spia è `defaultPrevented` su un Tab: la trappola **mangia** il
// tasto, quindi un Tab che passa è un Tab che nessuno ha intercettato. È la
// forma scrivibile in `happy-dom`, dove il layout non esiste (buco n. 5 della
// [0112](../../../docs/decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)) e quindi non si può
// guardare *dove* è finito il fuoco.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeContextMenu, pickIcon, showContextMenu } from "./menu";

/** Un evento di mouse verosimile, che è tutto ciò che le due funzioni leggono. */
function clickEvent(): MouseEvent {
  return new MouseEvent("contextmenu", { clientX: 10, clientY: 10 });
}

/** Un Tab annullabile: torna l'evento, così si può chiedergli chi lo ha fermato. */
function tab(): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
  document.dispatchEvent(e);
  return e;
}

describe("il menu contestuale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    closeContextMenu();
    vi.useRealTimers();
  });

  it("un menu chiuso prima del tempo non porta via quello dopo", () => {
    // Il menu si apre e si chiude subito — è il gesto di chi preme Escape, o
    // sceglie una voce col ritorno a capo. Poi il timer scatta.
    showContextMenu(clickEvent(), [{ label: "Rinomina", run: () => {} }]);
    closeContextMenu();
    vi.runAllTimers();

    // Un secondo menu, e un click qualunque prima che *il suo* timer sia
    // scattato: nessuno deve chiuderlo.
    showContextMenu(clickEvent(), [{ label: "Elimina", run: () => {} }]);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.getElementById("context-menu")).not.toBeNull();
  });

  it("chiudere un menu stacca la trappola del fuoco", () => {
    showContextMenu(clickEvent(), [{ label: "Rinomina", run: () => {} }]);
    expect(tab().defaultPrevented).toBe(true);

    closeContextMenu();
    expect(tab().defaultPrevented).toBe(false);
  });
});

describe("il selettore di icona", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("riaprirlo non lascia appesa la finestrella di prima", () => {
    const choices: (string | null)[] = [];
    pickIcon(clickEvent(), (i) => choices.push(i));
    pickIcon(clickEvent(), (i) => choices.push(i));

    // Uno solo a schermo: è la parte che già funzionava.
    expect(document.querySelectorAll("#icon-picker")).toHaveLength(1);

    // Si chiude il secondo per la sua via — quella che passa da `chiudi()`.
    document.querySelector<HTMLButtonElement>("#icon-picker .icon-none")!.click();
    vi.runAllTimers();
    expect(choices).toEqual([null]);
    expect(document.getElementById("icon-picker")).toBeNull();

    // E adesso: chi risponde? Nessuno. Prima rispondeva la trappola del fuoco
    // della **prima** finestrella, che nessuno aveva mai sciolto — e mangiava
    // il linguetta di una superficie che non c'era più.
    expect(tab().defaultPrevented).toBe(false);
  });

  it("scegliere un'emoji chiude e riporta la scelta una volta sola", () => {
    const choices: (string | null)[] = [];
    pickIcon(clickEvent(), (i) => choices.push(i));
    document.querySelector<HTMLButtonElement>("#icon-picker .icon-grid button")!.click();
    vi.runAllTimers();

    expect(choices).toHaveLength(1);
    expect(document.getElementById("icon-picker")).toBeNull();
    expect(tab().defaultPrevented).toBe(false);
  });
});
