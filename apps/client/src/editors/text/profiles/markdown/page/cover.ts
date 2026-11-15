// La copertina della pagina (E3): l'immagine di `cover:` in cima alla testata,
// alta 112 px (110 al telefono, la misura è della pelle), o un colore pieno
// (`cover: "#a3c4f3"`). Al passaggio «Cambia copertina» e, per un'immagine,
// «Riposiziona»; riposizionare è un trascinamento in verticale (o ↑ ↓ da
// tastiera) che scrive la posizione in `cover-y:`, da 0 (la cima
// dell'immagine) a 100 (il fondo). In Lettura e in sola lettura la copertina
// si guarda e basta.
import { markPresence } from "../../../../core/presence";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { imageHtml } from "../render-inline";
import { liveStrings } from "../strings";

/// La posizione in verticale quando `cover-y:` non c'è: il centro.
export const COVER_Y_DEFAULT = 50;
/// Di quanto sposta un tasto freccia, e con Maiuscolo.
const STEP = 5;
const FINE_STEP = 1;

/// `cover-y:` come numero da 0 a 100; `null` se manca o non è un numero.
export function coverYOf(value: string | null): number | null {
  if (value === null || !/^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return null;
  return clampY(Number(value));
}

/// Il colore di una copertina a tinta unita: `#rgb` o `#rrggbb` (con o senza
/// trasparenza); `null` se `cover:` è un'immagine.
export function coverColorOf(value: string): string | null {
  const color = value.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : null;
}

function clampY(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export interface CoverHost {
  /// Si scrive: Scrittura fuori dalla sola lettura. Senza, niente strumenti.
  readonly editable: boolean;
  /// Monta l'immagine (l'HTML della resa) e ne dà lo smontaggio.
  readonly mountImage?: (root: HTMLElement, html: string) => () => void;
  /// «Cambia copertina»: il riquadro della copertina, ancorato al pulsante.
  change(anchor: HTMLElement): void;
  /// Scrive la posizione scelta (`cover-y:`).
  reposition(y: number): void;
  /// L'altezza della testata è cambiata (l'immagine è arrivata).
  measure(): void;
}

/// La copertina di `src`, alla posizione `y` (`null`: il centro).
export function coverElement(src: string, y: number | null, host: CoverHost, life: Lifetime): HTMLElement {
  const cover = document.createElement("div");
  cover.className = "cm-fub-page-cover";
  const color = coverColorOf(src);
  if (color) {
    // Una tinta scritta dall'utente, non dal tema: l'unico stile in riga
    // della testata, dato col CSSOM (il CSP non lo ferma).
    cover.dataset.color = "true";
    cover.style.backgroundColor = color;
  }
  let position = y ?? COVER_Y_DEFAULT;
  const image = (): HTMLImageElement | null => cover.querySelector("img");
  const place = (value: number) => {
    const img = image();
    if (img) img.style.objectPosition = `50% ${value}%`;
  };
  if (host.mountImage && !color) life.add(host.mountImage(cover, imageHtml("", src)));
  place(position);
  life.listen(cover, "load", () => {
    place(position);
    host.measure();
  }, { capture: true });
  if (!host.editable) return cover;

  const tools = document.createElement("div");
  tools.className = "cm-fub-page-cover-tools";
  markPresence(tools, "hover");
  const button = (label: string, run: (button: HTMLButtonElement) => void): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "cm-fub-page-cover-tool";
    element.textContent = label;
    life.listen(element, "click", () => run(element));
    return element;
  };
  const change = button(liveStrings.t("page.cover.change"), (anchor) => host.change(anchor));
  const move = button(liveStrings.t("page.cover.reposition"), () => startReposition());
  // Un colore non ha niente da spostare.
  tools.append(...(color ? [change] : [change, move]));
  cover.append(tools);

  /// Il riposizionamento: la copertina prende il fuoco, il puntatore la
  /// trascina, ↑ ↓ la spostano, Invio (o «Salva») scrive, Esc torna com'era.
  let moving: Lifetime | null = null;
  life.add(() => moving?.close());
  const startReposition = () => {
    if (moving) return;
    const own = openLifetime();
    moving = own;
    const before = position;
    cover.dataset.reposition = "true";
    cover.tabIndex = 0;
    cover.setAttribute("role", "slider");
    cover.setAttribute("aria-label", liveStrings.t("page.cover.reposition.label"));
    cover.setAttribute("aria-orientation", "vertical");
    cover.setAttribute("aria-valuemin", "0");
    cover.setAttribute("aria-valuemax", "100");
    const show = (value: number) => {
      position = clampY(value);
      cover.setAttribute("aria-valuenow", String(position));
      place(position);
    };
    show(position);
    tools.hidden = true;
    const bar = document.createElement("div");
    bar.className = "cm-fub-page-cover-tools cm-fub-page-cover-moving";
    markPresence(bar, "request");
    const hint = document.createElement("span");
    hint.className = "cm-fub-page-cover-hint";
    hint.textContent = liveStrings.t("page.cover.reposition.hint");
    // Finito, il fuoco torna a «Riposiziona», da dove si era partiti: la
    // copertina smette di essere un cursore e non tiene più il fuoco. Se la
    // posizione si scrive la testata si rifà, e chi la ospita ritrova il
    // pulsante (`blocks/page.ts`).
    const finish = (keep: boolean) => {
      if (!keep) show(before);
      own.close();
      move.focus({ preventScroll: true });
      if (keep && position !== before) host.reposition(position);
    };
    const save = button(liveStrings.t("page.cover.reposition.save"), () => finish(true));
    const cancel = button(liveStrings.t("page.cover.reposition.cancel"), () => finish(false));
    bar.append(hint, cancel, save);
    cover.append(bar);
    own.add(() => {
      moving = null;
      bar.remove();
      tools.hidden = false;
      delete cover.dataset.reposition;
      cover.removeAttribute("tabindex");
      for (const name of ["role", "aria-label", "aria-orientation", "aria-valuemin", "aria-valuemax", "aria-valuenow"]) cover.removeAttribute(name);
    });
    // Quanto si può spostare: la parte dell'immagine che la copertina taglia.
    const travel = (): number => {
      const img = image();
      const height = cover.clientHeight || 1;
      if (!img || !img.naturalWidth || !img.naturalHeight) return height;
      const drawn = img.clientWidth * img.naturalHeight / img.naturalWidth;
      return Math.max(1, drawn - height);
    };
    let drag: { y: number; from: number; id: number } | null = null;
    own.listen(cover, "pointerdown", (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
      event.preventDefault();
      drag = { y: event.clientY, from: position, id: event.pointerId };
      cover.setPointerCapture?.(event.pointerId);
      cover.focus({ preventScroll: true });
    });
    own.listen(cover, "pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      // L'immagine segue il puntatore: in giù mostra la parte di sopra.
      show(drag.from - (event.clientY - drag.y) / travel() * 100);
    });
    const release = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      cover.releasePointerCapture?.(event.pointerId);
    };
    own.listen(cover, "pointerup", release);
    own.listen(cover, "pointercancel", release);
    own.listen(cover, "keydown", (event) => {
      if (event.target !== cover) return;
      const step = event.shiftKey ? FINE_STEP : STEP;
      // Come col puntatore: ↑ porta su l'immagine e ne mostra la parte di sotto.
      if (event.key === "ArrowUp") show(position + step);
      else if (event.key === "ArrowDown") show(position - step);
      else if (event.key === "Home") show(0);
      else if (event.key === "End") show(100);
      else if (event.key === "Enter") finish(true);
      else if (event.key === "Escape") finish(false);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    cover.focus({ preventScroll: true });
  };
  return cover;
}
