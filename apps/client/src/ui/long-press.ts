// La pressione lunga apre lo stesso menu del tasto destro.
//
// I menu contestuali della shell ascoltano `contextmenu`, che il mouse emette
// col tasto destro e la tastiera col tasto Menu o con Maiusc+F10. Un dito non
// ha né l'uno né l'altro, e WKWebView (iOS) non emette `contextmenu` alla
// pressione lunga: senza questo ponte, su un telefono quei menu non si aprono.
//
// Il ponte è uno, sul documento, e traduce la pressione lunga di un dito o di
// una penna in un `contextmenu` sul punto premuto: ogni menu esistente la
// riceve senza saperlo, e un menu nuovo non deve ricordarsene. Dove la
// piattaforma il `contextmenu` lo emette da sé (Android), il primo dei due vince
// e l'altro si fa da parte. Nei campi di testo la pressione lunga resta della
// piattaforma: lì seleziona.
import type { Lifetime } from "./lifetime";

/// Quanto deve durare la pressione perché sia lunga.
export const LONG_PRESS_MS = 500;
/// Quanto può muoversi il dito prima che la pressione diventi uno scorrimento.
const SLOP_PX = 10;
const EDITABLE = "input, textarea, [contenteditable]:not([contenteditable='false'])";

export function mountLongPressMenus(lifetime: Lifetime): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number; pointer: number } | null = null;
  // Dopo una pressione lunga andata a segno, il `click` del dito che si alza e
  // il `contextmenu` nativo della stessa pressione sono doppioni. Il prossimo
  // `pointerdown` apre una pressione nuova e li rimette in gioco.
  let pressed = false;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    origin = null;
  };
  lifetime.add(cancel);

  lifetime.listen(document, "pointerdown", (e) => {
    cancel();
    pressed = false;
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    const target = e.target;
    if (!(target instanceof Element) || target.closest(EDITABLE)) return;
    const { clientX, clientY } = e;
    origin = { x: clientX, y: clientY, pointer: e.pointerId };
    timer = setTimeout(() => {
      timer = undefined;
      origin = null;
      if (!target.isConnected) return;
      pressed = true;
      target.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 2,
      }));
    }, LONG_PRESS_MS);
  });
  lifetime.listen(document, "pointermove", (e) => {
    if (!origin || e.pointerId !== origin.pointer) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > SLOP_PX) cancel();
  });
  lifetime.listen(document, "pointerup", cancel);
  lifetime.listen(document, "pointercancel", cancel);
  lifetime.listen(document, "contextmenu", (e) => {
    if (!e.isTrusted) return;
    if (timer !== undefined) {
      // La piattaforma è arrivata prima: il ponte si fa da parte.
      cancel();
    } else if (pressed) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, { capture: true });
  lifetime.listen(document, "click", (e) => {
    if (!pressed) return;
    pressed = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}
