// Il pozzo del colore: un pulsante col colore e il suo nome, che apre il
// selettore (`picker.ts`) in un popover. È ciò che sta nelle barre e negli
// ispettori al posto di una tavolozza fissa: il nome si legge sempre, anche
// da chi non distingue le tinte.

import { identifier } from "../../ui/a11y";
import type { Lifetime } from "../../ui/lifetime";
import { openPopover, type PopoverHandle } from "../popover";
import { createColorPicker, type ColorChoice, type ColorPickerOptions, type ColorPicker } from "./picker";

export interface ColorWellOptions extends Omit<ColorPickerOptions, "onChange" | "lifetime"> {
  /// Il nome del pozzo: «Colore», «Riempimento», «Contorno».
  label: string;
  /// Il nome di un colore. Di serie quello dei campioni, o il codice.
  nameOf?: (color: string) => string;
  /// Che cosa dice una selezione mista.
  mixedText: string;
  /// Pulsanti grandi, come nello spazio «Semplice».
  large?: boolean;
  /// Ciò che cambia fra un'apertura e l'altra (i colori del documento, i
  /// recenti, se si sceglie un colore qualunque): letto a ogni apertura.
  now?: () => Partial<Pick<ColorPickerOptions, "recommended" | "documentColors" | "recent" | "theme" | "free">>;
  onChange: (color: string) => void;
  lifetime: Lifetime;
}

export interface ColorWell {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  setValue(color: string | null): void;
  /// Apre il selettore; il fuoco ci entra.
  open(): void;
  /// I testi nella lingua di adesso; il selettore aperto li prende alla
  /// prossima apertura.
  relabel(text: Pick<ColorWellOptions, "label" | "mixedText" | "text">): void;
  close(): void;
}

export function colorWell(options: ColorWellOptions): ColorWell {
  const { lifetime } = options;
  let value = options.value;
  let popover: PopoverHandle | null = null;
  let picker: ColorPicker | null = null;

  const choices = (): readonly ColorChoice[] => {
    const now = { ...options, ...options.now?.() };
    return [...(now.recommended ?? []), ...(now.documentColors ?? []), ...(now.theme ?? [])];
  };
  const nameOf = (color: string | null): string => {
    if (color === null) return options.mixedText;
    if (color === "none") return options.text.none;
    if (options.nameOf) return options.nameOf(color);
    return choices().find((choice) => choice.color.toLowerCase() === color.toLowerCase())?.name ?? color.toLowerCase();
  };

  const element = document.createElement("div");
  element.className = options.large ? "kit-color-well large" : "kit-color-well";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kit-color-well-button";
  button.id = identifier("kit-color-well");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const chip = document.createElement("span");
  chip.className = "kit-color-chip";
  chip.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "kit-color-well-name";
  button.append(chip, name);
  element.append(button);

  const paint = (): void => {
    const shown = nameOf(value);
    chip.classList.toggle("none", value === "none");
    chip.classList.toggle("mixed", value === null);
    chip.style.backgroundColor = value && value !== "none" ? value : "";
    name.textContent = shown;
    button.setAttribute("aria-label", `${options.label}: ${shown}`);
    button.title = `${options.label}: ${shown}`;
  };

  const close = (): void => popover?.close();

  const open = (): void => {
    if (popover && !popover.closed) return;
    picker = createColorPicker({
      ...options,
      ...options.now?.(),
      value,
      lifetime,
      onChange: (color) => {
        value = color;
        paint();
        options.onChange(color);
      },
    });
    button.setAttribute("aria-expanded", "true");
    popover = openPopover({
      anchor: button,
      content: picker.element,
      label: options.label,
      className: "kit-color-popover",
      lifetime,
      onClose: () => {
        button.setAttribute("aria-expanded", "false");
        picker = null;
        popover = null;
      },
    });
    picker.focus();
  };

  lifetime.listen(button, "click", () => (popover && !popover.closed ? close() : open()));
  paint();

  return {
    element,
    button,
    setValue(color) {
      value = color;
      paint();
      picker?.setValue(color);
    },
    open,
    close,
    relabel(next) {
      options = { ...options, ...next };
      paint();
    },
  };
}
