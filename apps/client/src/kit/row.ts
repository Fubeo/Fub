// La riga della lingua dei menu: una linea sola, con la figura, il nome e a
// destra, in grigio, ciò che serve (una nota, la scorciatoia in monospazio, la
// freccia di un sottomenu). La usano il menu (`ui/menu.ts`), lo spazio comandi
// e il «/», perché le tre superfici dicano le voci nello stesso modo.
//
// La riga non sa che cosa fa: niente ascolti, niente fuoco. Chi la monta le dà
// il ruolo, la mette nel suo giro di frecce e risponde al clic. Il kit le dà la
// forma, le parti e gli stati, che la pelle veste (`skin/kit.css`):
//
// - accesa (`data-lit`): la voce scelta, col puntatore o con le frecce;
// - premuta (`data-pressed`): la risposta prima che il menu si chiuda;
// - spenta (`aria-disabled`), col perché nella nota a destra, che si vede
//   sempre.
//
// Le parti portano `kit-row-<parte>` e, accanto, la classe che dà chi monta
// (`parts`): così una superficie tiene i suoi nomi e la pelle comune resta una.
import { iconEl } from "../ui/icons";
import "./kit.css";

/// Le classi di chi monta, parte per parte, accanto a quelle del kit.
export interface RowParts {
  readonly icon?: string;
  readonly label?: string;
  readonly note?: string;
  readonly keys?: string;
  readonly more?: string;
}

export interface RowOptions {
  /// Il nome della voce: il testo che si legge, una riga sola, tagliata.
  readonly label: string;
  /// Un nome di `ui/icons.ts`. Un nome che non esiste lascia il posto vuoto.
  readonly icon?: string;
  /// Tiene il posto della figura anche senza icona, perché i nomi di un
  /// elenco stiano allineati. Di serie solo se c'è `icon`.
  readonly holdIcon?: boolean;
  /// A destra, in grigio: la cartella, la sintassi di un blocco, il perché di
  /// una voce spenta. Si taglia prima del nome.
  readonly note?: string;
  /// La scorciatoia, a destra in monospazio. È anche `aria-keyshortcuts`.
  readonly keys?: string;
  /// La freccia di un sottomenu, a destra.
  readonly more?: boolean;
  /// Spenta: resta al suo posto e non risponde. Il perché va in `note`.
  readonly disabled?: boolean;
  /// `normal` è la riga da 34 px dei menu e del «/»; `large` quella da 38
  /// dello spazio comandi.
  readonly size?: "normal" | "large";
  /// Di serie un pulsante; `div` per una riga che contiene altri pulsanti
  /// (le scelte accanto al nome).
  readonly tag?: "button" | "div";
  readonly role?: string;
  /// La classe di chi monta, sulla riga accanto a `kit-row`.
  readonly className?: string;
  readonly parts?: RowParts;
}

/// La riga e le sue parti, per chi deve aggiungerci qualcosa al posto giusto.
export interface RowHandle {
  readonly element: HTMLElement;
  /// Il posto della figura, se c'è.
  readonly icon: HTMLElement | null;
  readonly label: HTMLElement;
  readonly note: HTMLElement | null;
  readonly keys: HTMLElement | null;
  readonly more: HTMLElement | null;
}

const classes = (own: string, extra: string | undefined): string => (extra ? `${own} ${extra}` : own);

function part<K extends keyof HTMLElementTagNameMap>(tag: K, own: string, extra: string | undefined): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = classes(own, extra);
  return node;
}

/// Accende o spegne un pezzo del kit (riga o tessera): la scelta che si vede.
export function markLit(element: HTMLElement, on: boolean): void {
  if (on) element.dataset.lit = "";
  else delete element.dataset.lit;
}

/// Segna un pezzo del kit come premuto: la risposta al gesto, prima che la
/// superficie si chiuda. Non si muove: col moto ridotto è identico.
export function markPressed(element: HTMLElement, on: boolean): void {
  if (on) element.dataset.pressed = "";
  else delete element.dataset.pressed;
}

/// Una riga della lingua dei menu.
export function createRow(options: RowOptions): RowHandle {
  const tag = options.tag ?? "button";
  const element = document.createElement(tag);
  element.className = classes("kit-row", options.className);
  if (element instanceof HTMLButtonElement) element.type = "button";
  if (options.role) element.setAttribute("role", options.role);
  if (options.size === "large") element.dataset.size = "large";
  if (options.disabled) element.setAttribute("aria-disabled", "true");
  const parts = options.parts ?? {};

  const glyph = options.icon === undefined ? null : iconEl(options.icon);
  let icon: HTMLElement | null = null;
  if (glyph !== null || options.holdIcon || (options.holdIcon === undefined && options.icon !== undefined)) {
    icon = part("span", "kit-row-icon", parts.icon);
    icon.setAttribute("aria-hidden", "true");
    if (glyph !== null) icon.append(glyph);
    element.append(icon);
  }

  const label = part("span", "kit-row-label", parts.label);
  label.textContent = options.label;
  element.append(label);

  let note: HTMLElement | null = null;
  if (options.note) {
    note = part("span", "kit-row-note", parts.note);
    note.textContent = options.note;
    element.append(note);
  }

  let keys: HTMLElement | null = null;
  if (options.keys) {
    keys = part("kbd", "kit-row-keys", parts.keys);
    keys.textContent = options.keys;
    element.append(keys);
    element.setAttribute("aria-keyshortcuts", options.keys);
  }

  let more: HTMLElement | null = null;
  if (options.more) {
    more = part("span", "kit-row-more", parts.more);
    more.setAttribute("aria-hidden", "true");
    more.textContent = "›";
    element.append(more);
    element.setAttribute("aria-haspopup", "menu");
  }

  return { element, icon, label, note, keys, more };
}
