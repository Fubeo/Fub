// Il popover: una superficie ancorata a qualcosa, sopra tutto il resto.
//
// Sta nel `body` e non accanto all'ancora: un contenitore che ritaglia o che
// qualcuno riconcilia non deve poterla tagliare né togliere. La posizione è
// `fixed` e si ricalcola quando la finestra cambia misura o qualcosa scorre.
//
// Regole che tiene per chi la usa:
// - si gira dall'altra parte se da quella chiesta non c'è posto, e scivola
//   lungo l'ancora per restare dentro la finestra;
// - Esc è del piano in cima, e riporta il fuoco a chi l'aveva;
// - un gesto fuori la chiude senza consumarlo: il clic arriva a chi doveva;
// - un popover aperto da dentro un altro non è «fuori» per il primo.
import { DURATION, animate, exitGhost } from "../moto";
import { focusableElements, identifier } from "../ui/a11y";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import { dismissChildren, isTopLayer, layerHolds, openLayer } from "./layers";
import { adopt } from "./owned";

export type PopoverPlacement = "top" | "bottom" | "left" | "right";
export type PopoverAlign = "start" | "center" | "end";

/// Perché un popover si è chiuso.
export type PopoverCloseReason =
  /// Esc.
  | "escape"
  /// Un gesto o il fuoco sono andati altrove.
  | "outside"
  /// Tab è uscito dal bordo della superficie.
  | "tab"
  /// L'ancora non è più nel documento.
  | "detached"
  /// Si è chiuso il piano da cui era nato.
  | "parent"
  /// Si è chiusa la vita che lo possedeva.
  | "lifetime"
  /// Lo ha chiuso chi lo aveva aperto.
  | "manual";

/// Un rettangolo nella finestra (px).
export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/// Ciò a cui ancorarsi quando non è un elemento: una selezione (`Range`), un
/// punto, un rettangolo calcolato.
export interface VirtualAnchor {
  getBoundingClientRect(): AnchorBox;
}

export type PopoverAnchor = Element | VirtualAnchor;

export interface PopoverOptions {
  anchor: PopoverAnchor;
  /// Il contenuto. Resta di chi lo passa: alla chiusura esce con la superficie.
  content: Node;
  /// Il lato dell'ancora su cui stare. Di serie `bottom`.
  placement?: PopoverPlacement;
  /// L'allineamento lungo l'ancora. Di serie `start`.
  align?: PopoverAlign;
  /// La distanza dall'ancora (px). Di serie 6.
  gap?: number;
  /// Il ruolo della superficie. Di serie `dialog` se ha un nome, sennò `group`:
  /// un dialogo senza nome non si annuncia.
  role?: string;
  /// Il nome accessibile, scritto.
  label?: string;
  /// Il nome accessibile, come id di chi lo porta.
  labelledBy?: string;
  /// Classi in più sulla superficie, oltre a `kit-popover`.
  className?: string;
  /// Un gesto o il fuoco altrove la chiudono. Di serie sì.
  dismissOnOutside?: boolean;
  /// Esc la chiude. Di serie sì.
  dismissOnEscape?: boolean;
  /// Alla chiusura il fuoco torna a chi l'aveva. Di serie sì.
  returnFocus?: boolean;
  /// All'apertura il fuoco entra nella superficie. Di serie sì.
  autoFocus?: boolean;
  onClose?: (reason: PopoverCloseReason) => void;
  /// Chiuderla chiude il popover.
  lifetime: Lifetime;
}

export interface PopoverHandle {
  /// La superficie.
  readonly element: HTMLElement;
  /// Chiude. Vale una volta; di serie il motivo è `manual`.
  close(reason?: PopoverCloseReason): void;
  /// Ricalcola la posizione: per chi cambia l'ancora o il contenuto.
  reposition(): void;
  readonly closed: boolean;
}

export interface PlaceOptions {
  placement: PopoverPlacement;
  align: PopoverAlign;
  gap: number;
  /// Lo spazio da lasciare ai bordi della finestra (px). Di serie 8.
  margin?: number;
}

export interface Placed {
  left: number;
  top: number;
  /// Il lato su cui è finita, dopo l'eventuale giro.
  placement: PopoverPlacement;
  /// Il punto della superficie più vicino all'ancora (px dal suo angolo): è
  /// l'origine da cui entra.
  originX: number;
  originY: number;
}

/// Lo spazio che resta sempre fra la superficie e il bordo della finestra.
export const POPOVER_MARGIN_PX = 8;
const DEFAULT_GAP_PX = 6;
/// Di quanto la superficie parte spostata verso l'ancora (px).
const ENTER_OFFSET_PX = 6;
const ENTER_SCALE = 0.96;
const EXIT_SCALE = 0.98;

const OPPOSITE: Record<PopoverPlacement, PopoverPlacement> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/// Dove mettere una superficie di misura `size` rispetto ad `anchor`, dentro
/// `viewport`. Si gira sul lato opposto solo se quello chiesto non basta e
/// l'altro ha più posto; poi scivola per restare dentro i margini.
export function placePopover(
  anchor: AnchorBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: PlaceOptions,
): Placed {
  const margin = options.margin ?? POPOVER_MARGIN_PX;
  const { gap, align } = options;
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  const room: Record<PopoverPlacement, number> = {
    top: anchor.top - gap - margin,
    bottom: viewport.height - bottom - gap - margin,
    left: anchor.left - gap - margin,
    right: viewport.width - right - gap - margin,
  };
  const vertical = options.placement === "top" || options.placement === "bottom";
  const need = vertical ? size.height : size.width;
  let placement = options.placement;
  if (room[placement] < need && room[OPPOSITE[placement]] > room[placement]) {
    placement = OPPOSITE[placement];
  }

  const along = (start: number, length: number, extent: number): number => {
    if (align === "center") return start + (length - extent) / 2;
    return align === "end" ? start + length - extent : start;
  };
  let left: number;
  let top: number;
  if (vertical) {
    left = along(anchor.left, anchor.width, size.width);
    top = placement === "top" ? anchor.top - gap - size.height : bottom + gap;
  } else {
    left = placement === "left" ? anchor.left - gap - size.width : right + gap;
    top = along(anchor.top, anchor.height, size.height);
  }
  left = Math.round(clamp(left, margin, viewport.width - size.width - margin));
  top = Math.round(clamp(top, margin, viewport.height - size.height - margin));

  const centerX = clamp(anchor.left + anchor.width / 2 - left, 0, size.width);
  const centerY = clamp(anchor.top + anchor.height / 2 - top, 0, size.height);
  return {
    left,
    top,
    placement,
    originX: Math.round(vertical ? centerX : placement === "right" ? 0 : size.width),
    originY: Math.round(vertical ? (placement === "bottom" ? 0 : size.height) : centerY),
  };
}

/// Vero se l'ancora è un pulsante: solo lui dice «aperto» e «controllo».
function isButton(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "BUTTON" || el.getAttribute("role") === "button")
  );
}

/// Apre una superficie ancorata ad `anchor`.
/// Le due componenti di una `scale` calcolata: `none`, un numero o due.
function scaleOf(value: string | undefined): [number, number] {
  const parts = (value ?? "").trim().split(/\s+/).map(Number.parseFloat);
  const x = parts[0];
  if (!Number.isFinite(x) || x <= 0) return [1, 1];
  const y = parts.length > 1 && Number.isFinite(parts[1]) && parts[1] > 0 ? parts[1] : x;
  return [x, y];
}

/// Il rettangolo dell'ancora a riposo. Un bottone che si preme ha ceduto di
/// poco proprio nell'istante in cui apre (`press.ts` muove `scale`), e il
/// rettangolo che se ne misura è quello rimpicciolito: ancorata a quello, la
/// superficie resterebbe spostata anche a pressione finita, cioè in un posto
/// diverso da quello che ha senza movimento. Si toglie la sola `scale`
/// dell'ancora: ciò che muove i suoi antenati non la riguarda.
function restingBox(anchor: PopoverAnchor, view: Window | null): AnchorBox {
  const box = anchor.getBoundingClientRect();
  if (!view || !(anchor instanceof Element)) return box;
  const style = view.getComputedStyle(anchor);
  const [sx, sy] = scaleOf(style.scale);
  if (sx === 1 && sy === 1) return box;
  const width = box.width / sx;
  const height = box.height / sy;
  // Calcolata, l'origine è in px dal bordo a riposo; di serie è il centro.
  const origin = (style.transformOrigin ?? "").split(/\s+/).map(Number.parseFloat);
  const ox = Number.isFinite(origin[0]) ? origin[0] : width / 2;
  const oy = Number.isFinite(origin[1]) ? origin[1] : height / 2;
  return { left: box.left - ox * (1 - sx), top: box.top - oy * (1 - sy), width, height };
}

export function openPopover(options: PopoverOptions): PopoverHandle {
  const anchorEl = options.anchor instanceof Element ? options.anchor : null;
  const doc = anchorEl?.ownerDocument ?? document;
  const view = doc.defaultView;
  const returnFocus = options.returnFocus !== false;
  // Il `body` a fuoco vuol dire che il fuoco non l'aveva nessuno.
  const focused = doc.activeElement;
  const previous = focused instanceof HTMLElement && focused !== doc.body ? focused : null;
  const origin = anchorEl ?? previous;

  const surface = doc.createElement("div");
  surface.className = options.className ? `kit-popover ${options.className}` : "kit-popover";
  surface.id = identifier("kit-popover");
  surface.tabIndex = -1;
  const named = Boolean(options.label || options.labelledBy);
  surface.setAttribute("role", options.role ?? (named ? "dialog" : "group"));
  if (options.label) surface.setAttribute("aria-label", options.label);
  if (options.labelledBy) surface.setAttribute("aria-labelledby", options.labelledBy);
  // Sopra un dialogo va sul suo piano: più in basso finirebbe dietro il velo.
  if (origin?.closest('[aria-modal="true"]')) surface.dataset.layer = "modal";
  surface.append(options.content);
  doc.body.append(surface);

  const own = openLifetime();
  let closed = false;
  /// Ritira il popover dalla vita che lo possiede.
  let released: Teardown = () => {};

  const reposition = (): void => {
    if (closed) return;
    if (anchorEl && !anchorEl.isConnected) {
      close("detached");
      return;
    }
    const placed = placePopover(
      restingBox(options.anchor, view),
      { width: surface.offsetWidth, height: surface.offsetHeight },
      {
        width: doc.documentElement.clientWidth || view?.innerWidth || 0,
        height: doc.documentElement.clientHeight || view?.innerHeight || 0,
      },
      {
        placement: options.placement ?? "bottom",
        align: options.align ?? "start",
        gap: options.gap ?? DEFAULT_GAP_PX,
      },
    );
    surface.style.left = `${placed.left}px`;
    surface.style.top = `${placed.top}px`;
    surface.style.transformOrigin = `${placed.originX}px ${placed.originY}px`;
    surface.dataset.placement = placed.placement;
  };

  const close = (reason: PopoverCloseReason = "manual"): void => {
    if (closed) return;
    // I piani nati da questo se ne vanno prima: il loro fuoco torna qui dentro
    // e segue poi il nostro.
    dismissChildren(layer);
    closed = true;
    const held = surface.contains(doc.activeElement);
    released();
    release();
    // L'uscita è di un'immagine: la superficie vera va via subito.
    exitGhost(surface, { to: { opacity: 0, scale: EXIT_SCALE }, duration: DURATION.swap });
    surface.remove();
    own.close();
    if (button) {
      button.setAttribute("aria-expanded", "false");
      if (controlled === null) button.removeAttribute("aria-controls");
      else button.setAttribute("aria-controls", controlled);
    }
    // Chi ha messo il fuoco altrove di proposito se lo tiene.
    if (held && returnFocus && reason !== "outside") {
      const target = previous?.isConnected ? previous : anchorEl;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    }
    options.onClose?.(reason);
  };

  const { layer, release } = openLayer(surface, origin, anchorEl, () => close("parent"));

  const button = isButton(anchorEl) ? anchorEl : null;
  const controlled = button?.getAttribute("aria-controls") ?? null;
  if (button) {
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", surface.id);
  }

  if (options.dismissOnEscape !== false) {
    // Sulla finestra e in cattura: sopra un dialogo il tasto deve fermarsi qui,
    // prima che la trappola del fuoco, che ascolta il documento, chiuda lui.
    own.listen(
      (view ?? doc) as EventTarget,
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.isComposing || !isTopLayer(layer)) return;
        event.preventDefault();
        event.stopPropagation();
        close("escape");
      },
      { capture: true },
    );
  }
  if (options.dismissOnOutside !== false) {
    // Non si ferma e non si annulla: il gesto prosegue verso chi lo aspettava.
    own.listen(
      doc,
      "pointerdown",
      (event) => {
        if (event.target instanceof Node && layerHolds(layer, event.target)) return;
        close("outside");
      },
      { capture: true },
    );
    /// Il fuoco è uscito senza dire dove andava: lo dice il prossimo che lo
    /// riceve.
    let unbound = false;
    own.listen(surface, "focusout", (event) => {
      const next = event.relatedTarget;
      // Senza destinazione il fuoco è uscito dalla finestra, e tornerà qui;
      // oppure gli è stato tolto, e arriverà altrove.
      if (!(next instanceof Node)) {
        unbound = true;
        return;
      }
      if (layerHolds(layer, next)) return;
      close("outside");
    });
    own.listen(
      doc,
      "focusin",
      (event) => {
        if (!unbound) return;
        unbound = false;
        if (event.target instanceof Node && layerHolds(layer, event.target)) return;
        close("outside");
      },
      { capture: true },
    );
  }
  // La superficie sta in fondo al `body`: senza questo Tab dal suo bordo
  // porterebbe all'altro capo della pagina.
  own.listen(surface, "keydown", (event) => {
    if (event.key !== "Tab" || event.defaultPrevented || !returnFocus) return;
    const inside = focusableElements(surface);
    const current = doc.activeElement;
    const leaving =
      inside.length === 0 ||
      (event.shiftKey
        ? current === inside[0] || current === surface
        : current === inside[inside.length - 1]);
    if (!leaving) return;
    event.preventDefault();
    close("tab");
  });

  if (view) own.listen(view, "resize", reposition);
  // Lo scorrimento non risale: in cattura sul documento si sente quello di
  // ogni contenitore. Quello dentro la superficie non sposta l'ancora.
  own.listen(
    doc,
    "scroll",
    (event) => {
      if (event.target instanceof Node && surface.contains(event.target)) return;
      reposition();
    },
    { capture: true, passive: true },
  );
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(reposition);
    observer.observe(surface);
    own.add(() => observer.disconnect());
  }

  reposition();
  if (!closed) {
    const side = surface.dataset.placement as PopoverPlacement | undefined;
    animate(surface, {
      from: {
        opacity: 0,
        scale: ENTER_SCALE,
        x: side === "left" ? ENTER_OFFSET_PX : side === "right" ? -ENTER_OFFSET_PX : 0,
        y: side === "top" ? ENTER_OFFSET_PX : side === "bottom" ? -ENTER_OFFSET_PX : 0,
      },
      spring: "soft",
      whenReduced: "fade",
      lifetime: own,
    });
    if (options.autoFocus !== false) {
      (focusableElements(surface)[0] ?? surface).focus({ preventScroll: true });
    }
    // Per ultima: su una vita già chiusa lo smontaggio parte qui, a cose fatte.
    released = adopt(options.lifetime, () => close("lifetime"));
  }

  return {
    element: surface,
    close,
    reposition,
    get closed() {
      return closed;
    },
  };
}
