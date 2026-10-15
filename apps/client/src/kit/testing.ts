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
