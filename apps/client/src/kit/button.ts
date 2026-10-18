// I pulsanti del kit: a icona e a testo.
//
// Un pulsante a icona non ha testo da leggere, quindi il nome arriva da chi lo
// chiede ed è sempre lì: come `aria-label` per chi ascolta e come suggerimento
// per chi guarda. Niente `title` nativo: il suggerimento è quello della shell.
import { iconEl } from "../ui/icons";
import type { Lifetime } from "../ui/lifetime";
import { attachTooltip, setTooltip } from "../ui/tooltip";
import { pressable } from "./press";

/// L'accordo di un comando, già scritto nei due modi in cui serve. Li danno
/// `displayBinding` e `ariaBinding` di `ui/commands.ts`: il kit non li chiama
/// da sé perché quel modulo porta con sé il registro e lo stato della shell.
export interface ButtonChord {
  /// Come lo si legge («Ctrl+K»): va nel suggerimento, dopo il nome.
  display: string;
  /// Come lo vuole `aria-keyshortcuts` («Control+K»). Vuoto o assente per una
  /// sequenza, che l'attributo non sa dire.
  aria?: string;
}

export type ButtonKind = "primary" | "normal" | "danger";

export interface IconButtonOptions {
  /// Un nome di `ui/icons.ts`.
  icon: string;
  /// Il nome accessibile, e il testo del suggerimento.
  label: string;
  chord?: ButtonChord;
  /// Se c'è, il pulsante è un interruttore e questo è il suo stato.
  pressed?: boolean;
  onPress: (event: MouseEvent) => void;
  /// Possiede ascolti, suggerimento e pressione. Senza, gli ascolti stanno
  /// sull'elemento e vivono quanto lui, e la pressione non c'è.
  lifetime?: Lifetime;
}

export interface TextButtonOptions {
  label: string;
  /// Di serie `normal`.
  kind?: ButtonKind;
  /// Un nome di `ui/icons.ts`, prima del testo.
  icon?: string;
  onPress: (event: MouseEvent) => void;
  lifetime?: Lifetime;
}

function wire(
  button: HTMLButtonElement,
  onPress: (event: MouseEvent) => void,
  lifetime: Lifetime | undefined,
): void {
  if (lifetime) {
    lifetime.listen(button, "click", onPress);
    pressable(button, lifetime);
  } else {
    button.addEventListener("click", onPress);
  }
}

const tooltipOf = (label: string, chord: ButtonChord | undefined): string =>
  chord?.display ? `${label} (${chord.display})` : label;

/// Dà al pulsante nome, suggerimento e accordo. Serve anche dopo, quando
/// cambiano la lingua o le scorciatoie.
export function labelButton(button: HTMLElement, label: string, chord?: ButtonChord): void {
  button.setAttribute("aria-label", label);
  setTooltip(button, tooltipOf(label, chord));
  if (chord?.aria) button.setAttribute("aria-keyshortcuts", chord.aria);
  else button.removeAttribute("aria-keyshortcuts");
}

/// Aggiorna lo stato di un pulsante interruttore.
export function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed));
}

/// Un pulsante che mostra solo un'icona.
export function iconButton(options: IconButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kit-button kit-button--icon";
  const figure = iconEl(options.icon);
  if (figure) button.append(figure);
  // Il suggerimento si registra una volta: con una vita, è lei a toglierlo.
  if (options.lifetime) {
    options.lifetime.add(attachTooltip(button, tooltipOf(options.label, options.chord)));
  }
  labelButton(button, options.label, options.chord);
  if (options.pressed !== undefined) setPressed(button, options.pressed);
  wire(button, options.onPress, options.lifetime);
  return button;
}

/// Un pulsante con il suo testo.
export function textButton(options: TextButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kit-button";
  button.dataset.kind = options.kind ?? "normal";
  const figure = options.icon ? iconEl(options.icon) : null;
  if (figure) button.append(figure);
  button.append(options.label);
  wire(button, options.onPress, options.lifetime);
  return button;
}
