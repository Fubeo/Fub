// La scheda al passaggio: un'anteprima che compare accanto a ciò che si indica.
//
// È un popover che nessuno ha chiesto con un gesto, e per questo ha regole sue:
// - aspetta prima di aprirsi, e chi passa soltanto non la vede;
// - resta aperta finché il puntatore è su di lei: ci si può entrare;
// - ce n'è una sola alla volta, in tutta la shell;
// - non prende il fuoco: chi sta scrivendo continua a scrivere;
// - il contenuto si carica quando serve, e un caricamento superato da uno più
//   nuovo viene annullato (il suo segnale) e il suo esito scartato (la corsa).
//
// Si apre anche col fuoco, ma solo quello arrivato dalla tastiera: un clic
// che mette a fuoco un collegamento non è una domanda. Chi la chiede con
// `show(target, { focus: true })` ci entra invece da tastiera: il fuoco va
// alla prima azione, ed Esc o Tab oltre il bordo lo riportano dov'era.
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { Race } from "../ui/race";
import { openPopover, type PopoverAlign, type PopoverHandle, type PopoverPlacement } from "./popover";

interface HoverCardCommon {
  /// Il contenuto della scheda per questo bersaglio. `null`, o un rigetto,
  /// vogliono dire «niente da mostrare». `signal` si interrompe quando il
  /// caricamento non serve più.
  load: (target: HTMLElement, signal: AbortSignal) => Promise<Node | null>;
  /// L'attesa prima di aprire (ms). Di serie 350.
  openDelay?: number;
  /// L'attesa prima di chiudere (ms): il tempo di arrivare sulla scheda. Di
  /// serie 150.
  closeDelay?: number;
  /// Di serie `bottom`.
  placement?: PopoverPlacement;
  /// Di serie `start`.
  align?: PopoverAlign;
  gap?: number;
  /// Il nome accessibile della scheda, fisso o secondo il bersaglio.
  label?: string | ((target: HTMLElement) => string);
  lifetime: Lifetime;
}

/// Un bersaglio solo, oppure tutti quelli che `selector` trova dentro `root`:
/// con la delega le righe possono nascere e sparire senza riattaccare niente.
export type HoverCardOptions = HoverCardCommon &
  (
    | { target: HTMLElement; delegate?: undefined }
    | { delegate: { root: HTMLElement; selector: string }; target?: undefined }
  );

export interface HoverCardHandle {
  /// Apre la scheda di `target` senza attesa; con `focus` ci porta il fuoco.
  show(target: HTMLElement, options?: { focus?: boolean }): void;
  /// Chiude la scheda e annulla ciò che stava per aprirsi.
  hide(): void;
  readonly open: boolean;
}

export const HOVER_OPEN_DELAY_MS = 350;
export const HOVER_CLOSE_DELAY_MS = 150;

interface OpenCard {
  target: HTMLElement;
  popover: PopoverHandle;
  life: Lifetime;
}

/// La scheda aperta, di chiunque sia: aprirne un'altra chiude questa.
let current: HoverCardHandle | null = null;

function keyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // Un motore che non conosce il selettore: meglio una scheda in più.
    return true;
  }
}

export function attachHoverCard(options: HoverCardOptions): HoverCardHandle {
  const { lifetime } = options;
  const root = options.delegate ? options.delegate.root : options.target;
  const selector = options.delegate ? options.delegate.selector : null;
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const openDelay = options.openDelay ?? HOVER_OPEN_DELAY_MS;
  const closeDelay = options.closeDelay ?? HOVER_CLOSE_DELAY_MS;
  const race = new Race();

  /// Il bersaglio che aspetta di aprirsi, o che sta caricando.
  let pending: HTMLElement | null = null;
  let loading: AbortController | null = null;
  let card: OpenCard | null = null;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;

  const targetOf = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Element) || !root.contains(node)) return null;
    if (selector === null) return root;
    const el = node.closest(selector);
    return el instanceof HTMLElement && root.contains(el) ? el : null;
  };

  const stay = (): void => {
    view.clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const cancelPending = (): void => {
    view.clearTimeout(openTimer);
    openTimer = undefined;
    pending = null;
    if (!loading) return;
    loading.abort();
    loading = null;
    race.cancel();
  };
  const closeCard = (): void => {
    stay();
    card?.popover.close();
  };
  const leaveSoon = (): void => {
    if (!card || closeTimer !== undefined) return;
    closeTimer = view.setTimeout(closeCard, closeDelay);
  };

  const show = (target: HTMLElement, content: Node, byPointer: boolean, focus: boolean): void => {
    closeCard();
    if (current !== handle) current?.hide();
    const life = openLifetime();
    const label = typeof options.label === "function" ? options.label(target) : options.label;
    const popover = openPopover({
      anchor: target,
      content,
      className: "kit-hover-card",
      placement: options.placement,
      align: options.align,
      gap: options.gap,
      // Non è un dialogo: non prende il fuoco e non chiede niente. Col suo
      // nome è una regione, contenuto a margine di ciò che si indica: sta nel
      // `body`, fuori dai punti di riferimento della pagina, e così la si
      // ritrova fra le regioni finché è aperta. Senza nome resta un gruppo.
      role: label ? "region" : "group",
      label,
      autoFocus: focus,
      returnFocus: focus,
      onClose() {
        life.close();
        if (card?.life !== life) return;
        card = null;
        stay();
        if (current === handle) current = null;
      },
      lifetime,
    });
    if (popover.closed) {
      life.close();
      return;
    }
    card = { target, popover, life };
    current = handle;
    // Chi ascolta sa che il bersaglio ha altro da dire, finché la scheda c'è.
    const details = target.getAttribute("aria-details");
    target.setAttribute("aria-details", popover.element.id);
    life.add(() => {
      if (details === null) target.removeAttribute("aria-details");
      else target.setAttribute("aria-details", details);
    });

    life.listen(popover.element, "pointerenter", stay);
    life.listen(popover.element, "pointerleave", leaveSoon);
    life.listen(popover.element, "focusin", stay);
    life.listen(popover.element, "focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (popover.element.contains(next) || target.contains(next))) return;
      leaveSoon();
    });
    if (byPointer) {
      // Un bersaglio tolto o spostato sotto un puntatore fermo non manda
      // nessuna uscita: al primo movimento ci si accorge che non è più lì.
      life.listen(doc, "pointermove", (event) => {
        if (!target.isConnected) {
          closeCard();
          return;
        }
        const over = event.target;
        if (over instanceof Node && (target.contains(over) || popover.element.contains(over))) return;
        leaveSoon();
      });
    }
  };

  const begin = (target: HTMLElement, byPointer: boolean, focus: boolean): void => {
    openTimer = undefined;
    const controller = new AbortController();
    loading = controller;
    // L'errore diventa un valore prima del cancello: vale «niente da mostrare».
    let loaded: Promise<Node | null>;
    try {
      loaded = options.load(target, controller.signal);
    } catch {
      loaded = Promise.resolve(null);
    }
    void race.last(async (expected) => {
      const content = await expected(loaded.catch(() => null));
      loading = null;
      pending = null;
      if (content && target.isConnected) show(target, content, byPointer, focus);
    });
  };

  const request = (target: HTMLElement, delay: number, byPointer: boolean, focus = false): void => {
    stay();
    if (lifetime.closed || card?.target === target || pending === target) return;
    cancelPending();
    pending = target;
    if (delay > 0) openTimer = view.setTimeout(() => begin(target, byPointer, focus), delay);
    else begin(target, byPointer, focus);
  };
  const leave = (target: HTMLElement): void => {
    if (pending === target) cancelPending();
    if (card?.target === target) leaveSoon();
  };

  lifetime.listen(root, "pointerover", (event) => {
    // Un dito non passa sopra: tocca, e quello è un altro gesto.
    if (event.pointerType === "touch") return;
    const target = targetOf(event.target);
    if (target) request(target, openDelay, true);
  });
  lifetime.listen(root, "pointerout", (event) => {
    const target = targetOf(event.target);
    if (!target) return;
    const next = event.relatedTarget;
    if (next instanceof Node && target.contains(next)) return;
    leave(target);
  });
  lifetime.listen(root, "focusin", (event) => {
    const target = targetOf(event.target);
    if (target && keyboardFocus(target)) request(target, openDelay, false);
  });
  lifetime.listen(root, "focusout", (event) => {
    const target = targetOf(event.target);
    if (!target) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (target.contains(next) || card?.popover.element.contains(next))) {
      return;
    }
    leave(target);
  });
  // Premere il bersaglio è agire: la scheda non deve mettersi in mezzo.
  lifetime.listen(root, "pointerdown", (event) => {
    if (!targetOf(event.target)) return;
    cancelPending();
    closeCard();
  });

  const handle: HoverCardHandle = {
    show(target, { focus = false } = {}) {
      if (card?.target === target) {
        if (!focus) return;
        // Aperta dal passaggio, non riporterebbe il fuoco: si riapre.
        closeCard();
      }
      cancelPending();
      request(target, 0, false, focus);
    },
    hide() {
      cancelPending();
      closeCard();
    },
    get open() {
      return card !== null;
    },
  };
  lifetime.add(() => handle.hide());
  return handle;
}
