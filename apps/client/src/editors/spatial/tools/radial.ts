// Il menu radiale: otto voci in cerchio attorno al punto in cui lo si
// chiede, una per direzione, come le bussole dei menu a torta di Blender e la
// tavolozza a comparsa di Krita. La mano impara la direzione e non il posto:
// dopo qualche volta la voce si sceglie senza guardarla.
//
// Si usa in due modi, e il menu capisce da solo quale:
//
// - **premi, trascina, lascia**: col tasto destro tenuto, il tasto laterale
//   della penna o il dito del tocco lungo ancora giù, il menu segue quel
//   puntatore. Oltre il cerchio di mezzo vale la direzione, anche lontano
//   dalle voci; dove il puntatore si alza, la voce di quella direzione
//   parte. Alzato nel cerchio di mezzo, il menu resta aperto;
// - **aperto**: si tocca o si clicca una voce. Un tocco fuori dalle voci, o
//   nel mezzo, lo chiude senza arrivare al foglio.
//
// Dalla tastiera è un menu: le frecce girano attorno alle voci, Invio
// sceglie, Esc chiude e il fuoco torna da dove era partito. Le cifre lo
// usano come il tastierino numerico, otto direzioni attorno al 5: l'8 è la
// voce in alto, il 6 quella a destra, il 5 chiude. Sopra il menu, il nome
// della voce che il puntatore indica, o che ha il fuoco.
//
// Il menu non sa che cosa siano uno strumento o un colore: riceve otto voci,
// dalla prima in alto in senso orario, coi loro `run`. Entra col moto delle
// superfici della shell (`ui/motion.ts`), che col moto ridotto non si muove.

import { trapFocus } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { enterSurface, exitSurface, finishSurface } from "../../../ui/motion";

/// Le otto direzioni, dall'alto in senso orario: l'ordine delle voci.
export const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/// Il raggio a cui stanno le voci, dal centro, in pixel.
const RING_PX = 80;
/// Il lato di una voce: più dei 44 px di un bersaglio da dito.
const ITEM_PX = 48;
/// Il cerchio di mezzo, dove la direzione non vale ancora.
export const DEAD_PX = 28;
/// Quanto il menu sta lontano dai bordi della finestra; sopra, anche il
/// nome della voce.
const MARGIN_PX = 8;
const CAPTION_PX = 36;
/// Il menu contestuale che il sistema manda dietro al tasto laterale della
/// penna, mentre è premuto o appena lasciato, o dietro al tasto del menu
/// che l'ha aperto, non chiude il menu.
const ECHO_MS = 500;

/// Le cifre del tastierino, per direzione.
const DIGITS: Readonly<Record<string, Direction | "close">> = {
  "8": "n",
  "9": "ne",
  "6": "e",
  "3": "se",
  "2": "s",
  "1": "sw",
  "4": "w",
  "7": "nw",
  "5": "close",
};

/// Una voce del menu.
export interface RadialItem {
  /// Il nome, che il lettore di schermo legge e il menu scrive sopra di sé.
  readonly label: string;
  /// Un'icona registrata (`ui/icons.ts`).
  readonly icon?: string;
  /// Un campione di colore, con la forma che lo distingue senza colore.
  readonly swatch?: { readonly color: string; readonly shape: string };
  /// La scorciatoia del comando fuori dal menu, scritta come si preme.
  readonly hint?: string;
  /// La voce c'è ma adesso non fa niente.
  readonly disabled?: boolean;
  readonly run: () => void;
}

/// Il puntatore ancora giù che ha aperto il menu: il menu lo segue.
export interface RadialPointer {
  readonly pointerType: string;
  /// L'identità del puntatore, se la si conosce.
  readonly pointerId: number | null;
}

export interface RadialOptions {
  /// Il nome del menu.
  readonly label: string;
  /// Ciò che vale adesso, nel mezzo: un'icona e un colore.
  readonly center?: { readonly icon?: string; readonly color?: string };
  /// Il puntatore che l'ha aperto, se è ancora giù.
  readonly held?: RadialPointer | null;
  /// Aperto dalla tastiera: il nome sopra il menu segue il fuoco da subito.
  readonly keyboard?: boolean;
  /// Il puntatore che l'ha aperto si è alzato, all'ora dell'evento.
  readonly onRelease?: (at: number) => void;
  /// Il menu si è chiuso, con una voce o senza.
  readonly onClose?: () => void;
}

export interface Radial {
  /// Lo strato del menu, sopra la finestra.
  readonly element: HTMLElement;
  close(): void;
}

/// Il menu aperto, se c'è: uno alla volta.
let opened: { readonly lifetime: Lifetime; readonly close: () => void } | null = null;

/// La direzione di uno spostamento sullo schermo, `dx` a destra e `dy` in
/// basso: l'indice in [`DIRECTIONS`].
export function sectorOf(dx: number, dy: number): number {
  const turn = Math.atan2(dx, -dy) / (Math.PI / 4);
  return ((Math.round(turn) % 8) + 8) % 8;
}

/// Il punto dove sta il centro del menu chiesto in `x`, `y`: lì, se ci
/// sta tutto, o il più vicino da cui si vede intero.
export function radialCenter(x: number, y: number, width: number, height: number): readonly [number, number] {
  const half = RING_PX + ITEM_PX / 2;
  // In una finestra più piccola del menu, il menu sta nel mezzo.
  const fit = (value: number, low: number, high: number, size: number): number => (low > high ? size / 2 : Math.min(Math.max(value, low), high));
  return [fit(x, MARGIN_PX + half, width - MARGIN_PX - half, width), fit(y, MARGIN_PX + CAPTION_PX + half, height - MARGIN_PX - half, height)];
}

/// Apre il menu in `x`, `y` sullo schermo, con le otto voci dall'alto in
/// senso orario; `null` lascia vuoto un posto.
export function openRadial(x: number, y: number, items: readonly (RadialItem | null)[], options: RadialOptions): Radial {
  closeRadial();
  closeContextMenu();
  const lifetime = openLifetime();
  const [cx, cy] = radialCenter(x, y, window.innerWidth, window.innerHeight);

  const layer = document.createElement("div");
  layer.className = "draw-radial";
  const ring = document.createElement("div");
  ring.className = "draw-radial-ring";
  ring.setAttribute("role", "menu");
  ring.setAttribute("aria-label", options.label);
  ring.tabIndex = -1;
  ring.style.left = `${cx}px`;
  ring.style.top = `${cy}px`;
  layer.append(ring);

  const caption = document.createElement("div");
  caption.className = "draw-radial-caption";
  caption.setAttribute("aria-hidden", "true");
  const center = document.createElement("div");
  center.className = "draw-radial-center";
  center.setAttribute("aria-hidden", "true");
  if (options.center?.color !== undefined) center.style.setProperty("--radial-color", options.center.color);
  const glyph = options.center?.icon === undefined ? null : iconEl(options.center.icon);
  if (glyph !== null) center.append(glyph);
  ring.append(caption, center);

  // --- Le voci ---------------------------------------------------------------

  const buttons: (HTMLButtonElement | null)[] = [];
  DIRECTIONS.forEach((direction, index) => {
    const item = items[index] ?? null;
    if (item === null) {
      buttons.push(null);
      return;
    }
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-radial-item";
    control.dataset.direction = direction;
    control.setAttribute("role", "menuitem");
    control.setAttribute("aria-label", item.label);
    control.tabIndex = -1;
    const digit = Object.keys(DIGITS).find((key) => DIGITS[key] === direction)!;
    control.setAttribute("aria-keyshortcuts", digit);
    const angle = (index * Math.PI) / 4;
    control.style.left = `${Math.round(Math.sin(angle) * RING_PX * 100) / 100}px`;
    control.style.top = `${Math.round(-Math.cos(angle) * RING_PX * 100) / 100}px`;
    if (item.icon !== undefined) {
      const icon = iconEl(item.icon);
      if (icon !== null) control.append(icon);
    } else if (item.swatch !== undefined) {
      const frame = document.createElement("span");
      frame.className = "draw-swatch-frame";
      frame.dataset.shape = item.swatch.shape;
      const chip = document.createElement("span");
      chip.className = "draw-swatch";
      chip.style.setProperty("--swatch", item.swatch.color);
      frame.append(chip);
      control.append(frame);
    }
    if (item.disabled === true) control.setAttribute("aria-disabled", "true");
    control.addEventListener("click", () => activate(index));
    control.addEventListener("pointerenter", (event) => {
      if (held === null && event.pointerType !== "touch") point(index);
    });
    control.addEventListener("pointerleave", () => {
      if (held === null && hot === index) point(null);
    });
    control.addEventListener("focus", () => {
      focused = index;
      show();
    });
    ring.append(control);
    buttons.push(control);
  });
  const usable = (index: number): boolean => buttons[index] !== null && items[index]?.disabled !== true;

  // --- Ciò che si vede -------------------------------------------------------

  /// La voce che il puntatore indica, e quella che ha il fuoco.
  let hot: number | null = null;
  let focused: number | null = null;
  /// Il fuoco si mostra quando lo muove la tastiera: chi apre col puntatore
  /// guarda il puntatore.
  let keyed = options.keyboard === true;
  let held = options.held ?? null;
  /// Quando la penna che l'ha aperto col tasto laterale l'ha lasciato.
  let lifted = -Infinity;
  const born = performance.now();

  const show = (): void => {
    buttons.forEach((control, index) => control?.toggleAttribute("data-hot", index === hot));
    const named = hot ?? (keyed ? focused : null);
    const item = named === null ? null : items[named];
    caption.textContent = item === null || item === undefined ? "" : item.hint === undefined ? item.label : `${item.label} · ${item.hint}`;
    if (hot === null) center.removeAttribute("data-pointing");
    else center.dataset.pointing = DIRECTIONS[hot]!;
  };
  const point = (index: number | null): void => {
    hot = index;
    show();
  };

  const focusAt = (index: number): void => {
    buttons.forEach((control, i) => {
      if (control !== null) control.tabIndex = i === index ? 0 : -1;
    });
    focused = index;
    buttons[index]?.focus();
    show();
  };
  /// La voce dopo `from`, in senso orario se `step` è 1, saltando quelle
  /// spente e i posti vuoti.
  const next = (from: number, step: 1 | -1): number | null => {
    for (let i = 1; i <= DIRECTIONS.length; i++) {
      const index = (((from + step * i) % 8) + 8) % 8;
      if (usable(index)) return index;
    }
    return null;
  };

  // --- Scegliere -------------------------------------------------------------

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    if (opened?.lifetime === lifetime) opened = null;
    lifetime.close();
    options.onClose?.();
  };
  /// Sceglie la voce `index`: il menu si chiude, il fuoco torna, e poi la
  /// voce fa ciò che fa.
  function activate(index: number): void {
    if (done || !usable(index)) return;
    close();
    items[index]!.run();
  }

  // Il puntatore che l'ha aperto, finché è giù.
  const ours = (event: PointerEvent): boolean =>
    held !== null && event.pointerType === held.pointerType && (held.pointerId === null || event.pointerId === held.pointerId);
  const aim = (event: PointerEvent): void => {
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    point(Math.hypot(dx, dy) < DEAD_PX ? null : sectorOf(dx, dy));
  };
  lifetime.listen(
    document,
    "pointermove",
    (event) => {
      if (ours(event)) aim(event);
    },
    { capture: true },
  );
  const release = (event: PointerEvent): void => {
    if (!ours(event)) return;
    // Il sistema manda dietro al tasto della penna il suo clic destro; al
    // mouse e al dito no.
    if (held!.pointerType === "pen") lifted = event.timeStamp;
    held = null;
    options.onRelease?.(event.timeStamp);
    if (event.type === "pointerup") aim(event);
    // Alzato su una voce: parte. Nel mezzo, o su una spenta, il menu resta.
    if (event.type === "pointerup" && hot !== null && usable(hot)) activate(hot);
    else point(null);
  };
  lifetime.listen(document, "pointerup", release, { capture: true });
  lifetime.listen(document, "pointercancel", release, { capture: true });

  // Un tocco fuori dalle voci chiude, e non arriva al foglio.
  lifetime.listen(layer, "pointerdown", (event) => {
    if (ours(event)) return;
    const target = event.target as Element;
    if (target.closest(".draw-radial-item") !== null) return;
    event.preventDefault();
    close();
  });
  // Il clic destro di nuovo lo chiude, come in Krita; quello che il sistema
  // manda dietro al tasto della penna o al tasto del menu no.
  lifetime.listen(layer, "contextmenu", (event) => {
    event.preventDefault();
    if (held !== null || event.timeStamp - lifted < ECHO_MS || event.timeStamp - born < ECHO_MS) return;
    close();
  });
  lifetime.listen(window, "resize", close);
  lifetime.listen(window, "blur", close);

  lifetime.listen(ring, "keydown", (event) => {
    const from = focused ?? -1;
    let to: number | null = null;
    const digit = event.code.startsWith("Numpad") ? DIGITS[event.code.slice(6)] : DIGITS[event.key];
    if (digit !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (digit === "close") close();
      else {
        const index = DIRECTIONS.indexOf(digit);
        if (usable(index)) activate(index);
        else if (buttons[index] !== null) {
          keyed = true;
          buttons[index]!.focus();
        }
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") to = next(from < 0 ? 7 : from, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = next(from < 0 ? 0 : from, -1);
    else if (event.key === "Home") to = next(7, 1);
    else if (event.key === "End") to = next(0, -1);
    else return;
    event.preventDefault();
    keyed = true;
    if (to !== null) focusAt(to);
  });

  document.body.append(layer);
  lifetime.add(() => exitSurface(layer, () => layer.remove(), { viewTransition: false }));
  enterSurface(layer, { viewTransition: false });
  // La trappola prima del fuoco: Esc chiude, e chiudendo il fuoco torna.
  lifetime.add(trapFocus(ring, close));
  const first = next(7, 1);
  if (first === null) ring.focus();
  else focusAt(first);
  opened = { lifetime, close };
  return { element: layer, close };
}

/// Chiude il menu radiale, se è aperto.
export function closeRadial(): void {
  opened?.close();
  // Chi se ne sta andando se ne va subito: un menu nuovo non ne trova uno
  // vecchio sotto.
  for (const layer of document.querySelectorAll<HTMLElement>(".draw-radial")) finishSurface(layer);
}
