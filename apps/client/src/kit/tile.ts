// La tessera della lingua dei menu: una scelta che si riconosce dalla figura.
// Le tessere stanno in fila sopra le righe: le parti della barra degli appunti
// nel menu (Taglia, Copia, Incolla), gli ambiti dello spazio comandi, i
// blocchi più usati del «/».
//
// Due forme:
//
// - `stack`: la figura in un quadrato da 40 px con gli angoli da 11, il nome
//   sotto (il «/»);
// - `inline`: la figura e il nome affiancati, in una parte di una barra (gli
//   appunti del menu).
//
// Come la riga (`row.ts`), la tessera non ascolta niente: chi la monta la
// mette nel suo giro di frecce e risponde al clic. Gli stati sono gli stessi:
// accesa (`markLit`), premuta (`markPressed`: la spunta d'accento al posto
// della figura), spenta (`aria-disabled`) col perché che chi ascolta sente e
// chi guarda legge nel suggerimento.
import { iconEl } from "../ui/icons";
import { attachTooltip } from "../ui/tooltip";
import type { Lifetime } from "../ui/lifetime";

export interface TileParts {
  readonly icon?: string;
  readonly label?: string;
}

export interface TileOptions {
  /// Il nome, che si legge e che chi ascolta sente.
  readonly label: string;
  /// Un nome di `ui/icons.ts`.
  readonly icon?: string;
  /// Un segno scritto al posto dell'icona: il prefisso di un ambito (`>`,
  /// `#`), una sigla (`H1`). Senza icona né segno, la forma `stack` scrive la
  /// prima lettera del nome, perché la fila resti di quadrati.
  readonly glyph?: string;
  /// Di serie `inline`.
  readonly shape?: "stack" | "inline";
  /// La scorciatoia, per chi ascolta (`aria-keyshortcuts`): una tessera non ha
  /// posto per scriverla.
  readonly keys?: string;
  /// Spenta, col perché. Il perché si sente (`aria-description`) e, con una
  /// vita, si legge nel suggerimento.
  readonly disabled?: { readonly reason: string };
  readonly role?: string;
  readonly className?: string;
  readonly parts?: TileParts;
  /// Possiede il suggerimento del perché, se c'è.
  readonly lifetime?: Lifetime;
}

const classes = (own: string, extra: string | undefined): string => (extra ? `${own} ${extra}` : own);

/// Il segno di una tessera senza icona: il suo, o la prima lettera del nome.
function signOf(options: TileOptions): string {
  if (options.glyph) return options.glyph;
  const first = [...options.label.trim()][0];
  return first === undefined ? "" : first.toLocaleUpperCase();
}

/// Una tessera della lingua dei menu.
export function createTile(options: TileOptions): HTMLButtonElement {
  const shape = options.shape ?? "inline";
  const button = document.createElement("button");
  button.type = "button";
  button.className = classes("kit-tile", options.className);
  button.dataset.shape = shape;
  if (options.role) button.setAttribute("role", options.role);
  if (options.keys) button.setAttribute("aria-keyshortcuts", options.keys);

  const glyph = options.icon === undefined ? null : iconEl(options.icon);
  const sign = glyph === null && (options.glyph || shape === "stack") ? signOf(options) : "";
  if (glyph !== null || sign !== "") {
    const figure = document.createElement("span");
    figure.className = classes("kit-tile-icon", options.parts?.icon);
    figure.setAttribute("aria-hidden", "true");
    if (glyph !== null) {
      glyph.setAttribute("aria-hidden", "true");
      figure.append(glyph);
    } else {
      figure.textContent = sign;
    }
    button.append(figure);
  }

  const label = document.createElement("span");
  label.className = classes("kit-tile-label", options.parts?.label);
  label.textContent = options.label;
  button.append(label);

  if (options.disabled) {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-description", options.disabled.reason);
    if (options.lifetime) options.lifetime.add(attachTooltip(button, options.disabled.reason));
  }
  return button;
}
