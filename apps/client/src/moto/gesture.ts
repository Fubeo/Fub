// Il trascinamento: un puntatore seguito dal premere al rilascio, con la sua
// velocità.
//
// Finché non supera la soglia il gesto non esiste: un clic resta un clic e
// arriva a chi doveva. Da lì il puntatore è catturato, e Esc lo annulla. Qui
// non si muove niente: chi ascolta decide che cosa seguire il puntatore.
//
// Due cose restano al foglio di stile dell'elemento: `touch-action: none`,
// senza il quale un dito fa scorrere la pagina e il gesto viene annullato, e
// `user-select: none`, senza il quale trascinando si seleziona il testo.
import { openLifetime, type Lifetime } from "../ui/lifetime";

export interface DragInfo {
  /// La posizione del puntatore nella finestra (px).
  readonly x: number;
  readonly y: number;
  /// Lo spostamento dal punto in cui si è premuto (px).
  readonly dx: number;
  readonly dy: number;
  /// La velocità stimata sugli ultimi campioni (px al millisecondo).
  readonly velocity: { readonly x: number; readonly y: number };
  readonly event: PointerEvent;
}

export interface DragOptions {
  /// La distanza (px) da percorrere prima che il gesto cominci. Di serie 4.
  threshold?: number;
  onStart?(info: DragInfo): void;
  onMove?(info: DragInfo): void;
  onEnd?(info: DragInfo): void;
  /// Il gesto era cominciato e non è finito con un rilascio: Esc, il sistema
  /// che se lo riprende, la finestra che perde il fuoco, lo smontaggio.
  onCancel?(): void;
  /// Possiede gli ascolti: chiuderla smonta il gesto e annulla quello in corso.
  lifetime: Lifetime;
}

const DEFAULT_THRESHOLD_PX = 4;
/// La finestra della stima (ms): un puntatore fermo più a lungo non ha velocità.
const VELOCITY_WINDOW_MS = 100;

interface Sample {
  x: number;
  y: number;
  time: number;
}

/// Rende `el` trascinabile col puntatore principale.
export function drag(el: HTMLElement, options: DragOptions): void {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD_PX;
  /// Annulla il gesto in corso, se c'è.
  let abort: (() => void) | null = null;

  options.lifetime.listen(el, "pointerdown", (down) => {
    if (!down.isPrimary || down.button !== 0) return;
    // Un gesto rimasto aperto vuol dire un rilascio mai arrivato: non deve
    // rendere sordo l'elemento.
    abort?.();
    const id = down.pointerId;
    const samples: Sample[] = [];
    // Gli ascolti di un gesto vivono quanto lui, e sul documento: prima della
    // soglia il puntatore non è catturato e può uscire dall'elemento.
    const gesture = openLifetime();
    const view = el.ownerDocument.defaultView;
    let started = false;

    const info = (event: PointerEvent): DragInfo => {
      const time = event.timeStamp;
      samples.push({ x: event.clientX, y: event.clientY, time });
      while (samples.length > 1 && time - samples[0].time > VELOCITY_WINDOW_MS) samples.shift();
      const first = samples[0];
      const span = time - first.time;
      return {
        x: event.clientX,
        y: event.clientY,
        dx: event.clientX - down.clientX,
        dy: event.clientY - down.clientY,
        velocity:
          span > 0
            ? { x: (event.clientX - first.x) / span, y: (event.clientY - first.y) / span }
            : { x: 0, y: 0 },
        event,
      };
    };
    const close = (): boolean => {
      gesture.close();
      abort = null;
      if (started && el.hasPointerCapture(id)) el.releasePointerCapture(id);
      return started;
    };
    abort = () => {
      if (close()) options.onCancel?.();
    };

    info(down);
    gesture.listen(el.ownerDocument, "pointermove", (move) => {
      if (move.pointerId !== id) return;
      const current = info(move);
      if (!started) {
        if (Math.hypot(current.dx, current.dy) < threshold) return;
        started = true;
        try {
          el.setPointerCapture(id);
        } catch {
          // Il puntatore può non essere più attivo: il gesto prosegue lo
          // stesso, gli ascolti sono sul documento.
        }
        options.onStart?.(current);
      }
      options.onMove?.(current);
    });
    gesture.listen(el.ownerDocument, "pointerup", (up) => {
      if (up.pointerId !== id) return;
      const current = info(up);
      if (close()) options.onEnd?.(current);
    });
    gesture.listen(el.ownerDocument, "pointercancel", (cancel) => {
      if (cancel.pointerId === id) abort?.();
    });
    gesture.listen(
      el.ownerDocument,
      "keydown",
      (key) => {
        if (key.key !== "Escape") return;
        // Un gesto cominciato consuma Esc: non deve chiudere anche la
        // superficie che lo ospita.
        if (started) {
          key.preventDefault();
          key.stopPropagation();
        }
        abort?.();
      },
      { capture: true },
    );
    if (view) gesture.listen(view, "blur", () => abort?.());
  });
  options.lifetime.add(() => abort?.());
}
