// Il campo di testo del kit.
//
// Il nome è sempre una `label[for]` esplicita. Può non vedersi (`labelHidden`
// la rende `.sr-only`), ma c'è: un `aria-labelledby` verso un'etichetta che uno
// scorrimento può ritagliare non conta come nome per chi la cerca.
import { identifier } from "../ui/a11y";
import { iconEl } from "../ui/icons";
import type { Lifetime } from "../ui/lifetime";

export interface TextFieldOptions {
  /// Il nome del campo.
  label: string;
  /// L'etichetta resta per chi ascolta e non si vede.
  labelHidden?: boolean;
  placeholder?: string;
  value?: string;
  /// Un nome di `ui/icons.ts`, prima del testo.
  icon?: string;
  /// Mostra il pulsante che svuota il campo, quando c'è qualcosa da svuotare.
  /// `label` è il suo nome accessibile.
  clearable?: { label: string };
  /// A ogni modifica dell'utente, e quando il campo viene svuotato.
  onInput?: (value: string) => void;
  /// Invio nel campo.
  onSubmit?: (value: string) => void;
  /// Possiede gli ascolti. Senza, stanno sugli elementi e vivono quanto loro.
  lifetime?: Lifetime;
}

export interface TextField {
  /// Etichetta e campo insieme: è ciò che si monta.
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  value(): string;
  /// Scrive il valore senza chiamare `onInput`: è il programma, non l'utente.
  setValue(value: string): void;
  focus(): void;
}

export function textField(options: TextFieldOptions): TextField {
  const element = document.createElement("div");
  element.className = "kit-field";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "kit-field-input";
  input.id = identifier("kit-field");
  input.autocomplete = "off";
  if (options.placeholder) input.placeholder = options.placeholder;
  input.value = options.value ?? "";

  const label = document.createElement("label");
  label.className = options.labelHidden ? "kit-field-label sr-only" : "kit-field-label";
  label.htmlFor = input.id;
  label.textContent = options.label;

  const box = document.createElement("div");
  box.className = "kit-field-box";
  if (options.icon) {
    const figure = iconEl(options.icon);
    if (figure) {
      const holder = document.createElement("span");
      holder.className = "kit-field-icon";
      holder.append(figure);
      box.append(holder);
    }
  }
  box.append(input);

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    if (options.lifetime) options.lifetime.listen(target, type, handler);
    else target.addEventListener(type, handler as EventListener);
  };

  let clear: HTMLButtonElement | null = null;
  const sync = (): void => {
    if (clear) clear.hidden = input.value === "";
  };
  if (options.clearable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kit-field-clear";
    button.setAttribute("aria-label", options.clearable.label);
    const figure = iconEl("close");
    if (figure) button.append(figure);
    listen(button, "click", () => {
      input.value = "";
      sync();
      options.onInput?.("");
      input.focus();
    });
    box.append(button);
    clear = button;
  }
  sync();

  listen(input, "input", () => {
    sync();
    options.onInput?.(input.value);
  });
  listen(input, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || !options.onSubmit) return;
    event.preventDefault();
    options.onSubmit(input.value);
  });

  element.append(label, box);
  return {
    element,
    input,
    value: () => input.value,
    setValue(value) {
      input.value = value;
      sync();
    },
    focus: () => input.focus(),
  };
}
