// Il puntatore della prova comune sulla cornice (`TableFrame`): la maniglia di
// riempimento e le intestazioni, per i driver della cornice e della tabella
// delle note. Solo per i test.

import type { ConformancePointer } from "../conformance";

/// Esegue `gesture` sulla cornice dentro `root`. I movimenti vanno al
/// documento, come quelli veri; `elementFromPoint`, che happy-dom non sa
/// calcolare, dà per il tempo del gesto l'elemento sotto il puntatore.
export function framePointer(root: HTMLElement, gesture: ConformancePointer): void {
  const doc = root.ownerDocument;
  const mouse = (target: EventTarget, type: string) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  const under = (element: Element, run: () => void) => {
    const own = Object.getOwnPropertyDescriptor(doc, "elementFromPoint");
    Object.defineProperty(doc, "elementFromPoint", { configurable: true, value: () => element });
    try {
      run();
    } finally {
      if (own) Object.defineProperty(doc, "elementFromPoint", own);
      else delete (doc as { elementFromPoint?: unknown }).elementFromPoint;
    }
  };
  const need = <T extends Element>(element: T | null, what: string): T => {
    if (!element) throw new Error(`la cornice non ha ${what}`);
    return element;
  };
  switch (gesture.kind) {
    case "fill": {
      const handle = need(root.querySelector<HTMLElement>(".tb-fill"), "la maniglia");
      const cell = need(root.querySelector(`[data-row="${gesture.to.row}"][data-col="${gesture.to.column}"]`), "la cella");
      under(cell, () => {
        mouse(handle, "mousedown");
        mouse(cell, "mousemove");
        mouse(cell, "mouseup");
      });
      return;
    }
    case "fill-double":
      mouse(need(root.querySelector<HTMLElement>(".tb-fill"), "la maniglia"), "dblclick");
      return;
    case "header": {
      const header = (index: number) => gesture.axis === "column"
        ? need(root.querySelector(`.tb-letter[data-col="${index}"]`), `la lettera ${index}`)
        : need(root.querySelector(`.tb-rowhead[data-row="${index}"]`), `il numero ${index}`);
      const start = header(gesture.index);
      const end = header(gesture.to ?? gesture.index);
      under(end, () => {
        mouse(start, "mousedown");
        if (gesture.to !== undefined) mouse(end, "mousemove");
        mouse(end, "mouseup");
      });
      return;
    }
  }
}
