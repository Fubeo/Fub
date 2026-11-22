// Il modulo del kit: una domanda con più campi (`kit-form`), con le sue righe,
// la scelta a segmenti, la casella, la nota e l'errore.
//
// Qui stanno le regole che un campo rispetta, una volta sola: un testo che non
// è fatto di soli spazi, uno zero dove non va, un codice di colore. Le usano la
// finestra del disegno (`editors/spatial/motore/finestre.ts`) e
// `ui/form-dialog.ts`. Un numero fuori dai suoi limiti non si prende: il campo
// lo dice con la parola di chi chiama, e il pulsante di conferma resta spento
// finché il campo è in errore.
//
// Il kit non ha testo suo: le etichette, le parole degli errori e i nomi delle
// scelte arrivano da chi chiama. La geometria sta in `kit.css`, il colore nella
// pelle (`theme/scrittoio/skin/kit.css`). `kit/form.ts` non sta in
// `kit/index.ts`: lo importano solo le superfici che si caricano quando servono
// (il disegno), così il modulo non pesa sull'avvio.
import { identifier } from "../ui/a11y";
import type { Lifetime } from "../ui/lifetime";
import { textField } from "./field";
import { numberField } from "./number-field";
import type { QuantityProblem } from "./quantity";
import "./kit.css";

/// Un codice di colore come lo accetta un campo `color`: tre o sei cifre
/// esadecimali, col `#` o senza.
export const COLOR_PATTERN = "#?(?:[0-9a-fA-F]{3}){1,2}";
const COLOR_CODE = new RegExp(`^${COLOR_PATTERN}$`);

/// Il codice `#rrggbb` minuscolo di `value`, se è un codice che il campo
/// accetta.
export function sixDigits(value: string): string | null {
  const text = value.trim();
  if (!COLOR_CODE.test(text)) return null;
  const hex = text.replace("#", "").toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

/// Un codice che non va si spiega con la frase del campo, non con quella
/// generica del browser. Si rifà a ogni battuta e prima di confermare, così
/// non resta indietro rispetto al valore.
export function explainColor(control: HTMLInputElement | HTMLTextAreaElement, message: string): void {
  control.setCustomValidity(control.validity.patternMismatch ? message : "");
}

/// Un testo che non si lascia vuoto non è nemmeno fatto di soli spazi, che il
/// browser lascerebbe passare. Come per il colore, si rifà a ogni battuta: un
/// errore rimasto fermerebbe l'invio prima di arrivare qui.
export function explainBlank(control: HTMLInputElement | HTMLTextAreaElement, message: string): void {
  control.setCustomValidity(control.value !== "" && control.value.trim() === "" ? message : "");
}

/// Uno zero dove non va: il browser non ha un vincolo che lo dica. Come il
/// testo vuoto, si rifà a ogni battuta e prima di confermare.
export function explainZero(control: HTMLInputElement | HTMLTextAreaElement, message: string): void {
  control.setCustomValidity(control.value !== "" && Number(control.value) === 0 ? message : "");
}

const listen = <K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  lifetime: Lifetime | undefined,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void => {
  if (lifetime) lifetime.listen(target, type, handler);
  else target.addEventListener(type, handler as EventListener);
};

/// Il corpo di una domanda: la colonna delle sue righe, le note e gli errori.
export function formBody(children: readonly Node[]): HTMLDivElement {
  const body = document.createElement("div");
  body.className = "kit-form";
  body.append(...children);
  return body;
}

/// Una riga della domanda: un campo numerico, una scelta o una casella.
export function formRow(...children: Node[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "kit-form-row";
  row.append(...children);
  return row;
}

/// La nota della domanda: una frase in grigio che dice che cosa succede. Con
/// `live`, chi legge sente le sue parole quando cambiano.
export function formNote(text: string, live = false): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "kit-form-note";
  if (live) note.setAttribute("role", "status");
  note.textContent = text;
  return note;
}

/// L'errore della domanda: una frase che dice che cosa non va e che cosa fare.
/// Lo annuncia chi legge, appena compare.
export function formError(text: string): HTMLParagraphElement {
  const error = document.createElement("p");
  error.className = "kit-form-error";
  error.setAttribute("role", "alert");
  error.textContent = text;
  return error;
}

export interface FormChoice {
  readonly value: string;
  readonly label: string;
}

export interface FormChoiceOptions {
  /// Il nome della scelta, che lo dice a chi ascolta.
  readonly label: string;
  readonly choices: readonly FormChoice[];
  /// Il valore acceso: deve essere uno di `choices`.
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly lifetime?: Lifetime;
}

export interface FormChoiceHandle {
  /// La riga: il nome e il gruppo di scelte.
  readonly element: HTMLDivElement;
  value(): string;
}

/// Una scelta a segmenti: un gruppo `radiogroup` di pulsanti, uno acceso. Le
/// frecce passano alla scelta accanto, e il fuoco va con loro, come in un
/// gruppo di radio.
export function formChoice(options: FormChoiceOptions): FormChoiceHandle {
  const name = document.createElement("span");
  name.className = "kit-form-label";
  name.id = identifier("kit-form-label");
  name.textContent = options.label;

  const group = document.createElement("div");
  group.className = "kit-form-choice";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", name.id);

  let current = options.value;
  const buttons = options.choices.map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kit-button kit-form-option";
    button.dataset.kind = "normal";
    button.setAttribute("role", "radio");
    button.textContent = choice.label;
    group.append(button);
    return button;
  });
  const paint = (): void => {
    const lit = options.choices.findIndex((choice) => choice.value === current);
    buttons.forEach((button, index) => {
      const on = index === (lit === -1 ? 0 : lit);
      button.setAttribute("aria-checked", String(index === lit));
      button.tabIndex = on ? 0 : -1;
    });
  };
  const choose = (index: number): void => {
    const next = options.choices[index]!.value;
    if (next !== current) {
      current = next;
      paint();
      options.onChange(next);
    }
    buttons[index]!.focus();
  };
  buttons.forEach((button, index) => {
    listen(button, options.lifetime, "click", () => choose(index));
    listen(button, options.lifetime, "keydown", (event) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      choose((index + step + buttons.length) % buttons.length);
    });
  });
  paint();

  const element = formRow(name, group);
  return { element, value: () => current };
}

export interface FormCheckOptions {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly lifetime?: Lifetime;
}

export interface FormCheckHandle {
  /// La riga, con la casella dentro la sua etichetta.
  readonly element: HTMLDivElement;
  checked(): boolean;
}

/// Una casella con la sua frase accanto: la sua etichetta la contiene, così
/// chi la sceglie la clicca anche sulla parola.
export function formCheck(options: FormCheckOptions): FormCheckHandle {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "kit-form-checkbox";
  input.id = identifier("kit-form-check");
  input.checked = options.checked;

  const text = document.createElement("span");
  text.textContent = options.label;

  const label = document.createElement("label");
  label.className = "kit-form-check";
  label.htmlFor = input.id;
  label.append(input, text);

  listen(input, options.lifetime, "change", () => options.onChange(input.checked));
  return { element: formRow(label), checked: () => input.checked };
}

export interface FormTextOptions {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  /// La frase quando il campo è vuoto o fatto di soli spazi.
  readonly blank: string;
  readonly onChange: (value: string) => void;
  readonly lifetime?: Lifetime;
}

export interface FormText {
  /// Il campo, e sotto l'errore quando c'è.
  readonly element: HTMLDivElement;
  readonly input: HTMLInputElement;
  value(): string;
  /// Vero se il valore si può prendere: non vuoto, e non fatto di soli spazi.
  valid(): boolean;
  /// Mostra la frase d'errore sotto il campo, o la toglie con `null`.
  setError(message: string | null): void;
  focus(): void;
}

/// Un testo su una riga, col suo nome sopra. Chi conferma controlla `valid()`
/// e, se non va, accende l'errore con la sua frase.
export function formText(options: FormTextOptions): FormText {
  const field = textField({
    label: options.label,
    value: options.value,
    placeholder: options.placeholder,
    lifetime: options.lifetime,
    onInput: (value) => options.onChange(value),
  });
  const element = document.createElement("div");
  element.append(field.element);
  const error = formError("");
  error.hidden = true;
  element.append(error);

  return {
    element,
    input: field.input,
    value: () => field.value(),
    valid: () => field.value().trim() !== "",
    setError(message) {
      error.textContent = message ?? "";
      error.hidden = message === null;
      if (message === null) field.input.removeAttribute("aria-invalid");
      else field.input.setAttribute("aria-invalid", "true");
    },
    focus: () => field.focus(),
  };
}

export interface FormNumberOptions {
  readonly label: string;
  readonly value: number;
  /// La sigla dell'unità accanto al numero, per esempio `px`.
  readonly unit?: string;
  /// I limiti: fuori, il valore non si prende e il campo dice perché.
  readonly min?: number;
  readonly max?: number;
  /// I decimali che il campo mostra.
  readonly places?: number;
  /// La frase quando il numero è fuori dai limiti: chi chiama la scrive con i
  /// limiti dentro.
  readonly outOfRange: (min: number | undefined, max: number | undefined) => string;
  /// Le frasi dei problemi di lettura, come le vuole il campo numerico.
  readonly problem: (problem: QuantityProblem | "mixed") => string;
  /// Un valore preso.
  readonly onChange: (value: number) => void;
  /// Quando il campo entra in errore o ne esce: il pulsante di conferma ne
  /// tiene conto.
  readonly onValidity?: (valid: boolean) => void;
  readonly lifetime?: Lifetime;
}

export interface FormNumber {
  /// Etichetta, campo e errore insieme (`kit-number`): va in una riga.
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  value(): number;
  /// Vero finché l'ultimo valore scritto non è in errore.
  valid(): boolean;
  focus(): void;
}

/// Un numero con la sua unità e i suoi limiti. Il valore preso sta nei limiti:
/// fuori, il campo dice la frase di `outOfRange` e non lo prende. Il campo in
/// errore si legge dal suo stesso attributo `aria-invalid`, così la conferma
/// segue sempre ciò che il campo mostra.
export function formNumber(options: FormNumberOptions): FormNumber {
  let value = options.value;
  const outside = (next: number): boolean =>
    (options.min !== undefined && next < options.min) || (options.max !== undefined && next > options.max);

  const field = numberField({
    label: options.label,
    value: options.value,
    unit: options.unit,
    places: options.places,
    mixedText: "",
    problem: options.problem,
    lifetime: options.lifetime,
    onCommit: (next) => {
      if (outside(next)) return options.outOfRange(options.min, options.max);
      value = next;
      options.onChange(next);
      return undefined;
    },
  });
  if (options.min !== undefined) field.input.setAttribute("aria-valuemin", String(options.min));
  if (options.max !== undefined) field.input.setAttribute("aria-valuemax", String(options.max));

  // Il valore di partenza fuori dai limiti è in errore fin dall'apertura: la conferma non può
  // partire con lui, e il campo dice il limite (K6 T13, giro 3).
  if (outside(options.value)) field.setError(options.outOfRange(options.min, options.max));

  const valid = (): boolean => field.input.getAttribute("aria-invalid") !== "true";
  if (options.onValidity) {
    // Il browser consegna le modifiche in lotti: chi guarda vede lo stato
    // in cui il lotto finisce, e lo dice solo se è cambiato.
    const report = options.onValidity;
    let last = valid();
    const watch = new MutationObserver(() => {
      const now = valid();
      if (now === last) return;
      last = now;
      report(now);
    });
    watch.observe(field.input, { attributes: true, attributeFilter: ["aria-invalid"] });
    options.lifetime?.add(() => watch.disconnect());
  }

  return {
    element: field.element,
    input: field.input,
    value: () => value,
    valid,
    focus: () => field.focus(),
  };
}

