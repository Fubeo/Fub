// Ciò che i banchi del kit hanno in comune. Lo importano solo i `*.test.ts`:
// nel pacchetto non entra.
import { vi } from "vitest";

/// Conta gli ascolti rimasti su `targets` da quando è stata chiamata: ogni
/// registrazione senza la sua rimozione, con lo stesso tipo e la stessa
/// funzione. È la prova che uno smontaggio non lascia niente sui bersagli che
/// sopravvivono alla superficie, cioè finestra e documento.
export function listenerLedger(...targets: EventTarget[]): () => number {
  const spies = targets.map((target) => ({
    add: vi.spyOn(target, "addEventListener"),
    remove: vi.spyOn(target, "removeEventListener"),
  }));
  return () => {
    let live = 0;
    for (const { add, remove } of spies) {
      const removed = remove.mock.calls.map(([type, listener]) => ({ type, listener }));
      for (const [type, listener] of add.mock.calls) {
        const at = removed.findIndex((each) => each.type === type && each.listener === listener);
        if (at >= 0) removed.splice(at, 1);
        else live += 1;
      }
    }
    return live;
  };
}

/// Un evento del puntatore principale, col tasto sinistro.
export function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

/// Un clic col tasto sinistro come lo dà il browser, che happy-dom non
/// ricompone: pressione del puntatore, `mousedown` e, se nessuno ne ha fermato
/// l'azione di serie, il fuoco al primo antenato che lo prende; poi rilascio e
/// `click`.
export function realClick(el: HTMLElement): void {
  const mouse = (type: string, buttons: number): MouseEvent =>
    new MouseEvent(type, { button: 0, buttons, detail: 1, bubbles: true, cancelable: true });
  el.dispatchEvent(pointer("pointerdown", { buttons: 1 }));
  const down = mouse("mousedown", 1);
  el.dispatchEvent(down);
  if (!down.defaultPrevented) {
    const focusable = el.closest<HTMLElement>("button, input, select, textarea, a[href], [tabindex], [contenteditable='true']");
    focusable?.focus();
  }
  el.dispatchEvent(pointer("pointerup", { buttons: 0 }));
  el.dispatchEvent(mouse("mouseup", 0));
  el.dispatchEvent(mouse("click", 0));
}

/// Il tasto che WebKit (la WebView di Linux e di macOS) dà mentre conferma
/// una composizione: `isComposing` è già falso, il codice è 229
/// (`kit/ime.ts`). Va unito all'init di un `KeyboardEvent`.
export const WEBKIT_COMPOSING: KeyboardEventInit = { isComposing: false, keyCode: 229 };

/// Preme un tasto su `target` e rende l'evento, per guardare se è stato
/// consumato.
export function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Dà a un elemento le misure che happy-dom non calcola.
export function measure(
  el: HTMLElement,
  box: { left?: number; top?: number; width?: number; height?: number },
): void {
  const define = (name: string, value: number | undefined): void => {
    if (value !== undefined) Object.defineProperty(el, name, { value, configurable: true });
  };
  define("offsetLeft", box.left);
  define("offsetTop", box.top);
  define("offsetWidth", box.width);
  define("offsetHeight", box.height);
}
