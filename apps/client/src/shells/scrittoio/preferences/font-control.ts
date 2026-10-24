// I caratteri, come controllo: ogni scelta scritta con sé stessa.
//
// Nel form generico un carattere è una tendina di nomi, e un nome non dice
// com'è fatta una lettera. Qui ogni voce è un bottone col suo nome disegnato
// nel carattere che nomina, in un gruppo di scelta. Quando le voci sono poche
// la vista disegna già un gruppo di scelta (il segmentato): lì basta scrivere
// ogni bottone col suo carattere (`fontSamples`). Le voci e i loro nomi sono
// quelli della tendina della vista (cioè dello schema), le pile quelle della
// serie in vigore: una voce che la serie non conosce si scrive nel carattere
// dell'interfaccia, ed è comunque sceglibile.
import { themeSeries } from "../../../theme/theme";
import type { Lifetime } from "../../../ui/lifetime";
import { radioGroup } from "./radios";
import { choiceField, chooseThrough, rowFor, setAttr, setDisabled, type Dress, type Piece } from "./rows";

/// Quale famiglia della serie risponde a una chiave.
export type FontFamily = "reading" | "ui" | "mono";

function stacks(family: FontFamily): Readonly<Record<string, string>> {
  const series = themeSeries();
  if (family === "reading") return series.readingFonts;
  return (family === "ui" ? series.uiFonts : series.monoFonts) ?? {};
}

/// Scrive ogni bottone del segmentato di queste chiavi col carattere che nomina.
export function fontSamples(body: HTMLElement, keys: readonly (readonly [string, FontFamily])[]): Piece {
  return () => {
    for (const [key, family] of keys) {
      const known = stacks(family);
      for (const option of rowFor(body, key)?.querySelectorAll<HTMLElement>(".segmented-option[data-choice]") ?? []) {
        const stack = known[option.dataset.choice ?? ""] ?? "";
        if (option.style.fontFamily !== stack) option.style.fontFamily = stack;
      }
    }
    return false;
  };
}

export function fontControl(lifetime: Lifetime, key: string, family: FontFamily): Dress<HTMLSelectElement> {
  const element = document.createElement("div");
  element.className = "prefs-fonts";
  element.setAttribute("role", "radiogroup");

  /// Le voci disegnate, per riconoscere una tendina uguale a quella di prima.
  let drawn = "";

  const group = radioGroup(lifetime, element, (radio) => {
    const row = element.closest<HTMLElement>(".setting-row");
    const field = row ? choiceField(row) : null;
    if (field && radio.dataset.value !== undefined) chooseThrough(field, radio.dataset.value);
  });

  const draw = (options: readonly HTMLOptionElement[]): void => {
    const known = stacks(family);
    const radios = options.map((option, index) => {
      const radio = document.createElement("button");
      radio.type = "button";
      radio.className = "prefs-font";
      radio.id = `prefs-font-${key.replace(/\W/g, "-")}-${index}`;
      radio.dataset.value = option.value;
      radio.setAttribute("role", "radio");
      radio.setAttribute("aria-checked", "false");
      radio.tabIndex = -1;
      radio.textContent = option.textContent ?? option.value;
      const stack = known[option.value];
      if (stack) radio.style.fontFamily = stack;
      return radio;
    });
    element.replaceChildren(...radios);
  };

  return {
    key,
    element,
    field: choiceField,
    update(row, field) {
      const options = [...field.options];
      const signature = options.map((option) => `${option.value}\u0000${option.textContent ?? ""}`).join("\u0001");
      if (signature !== drawn) {
        drawn = signature;
        draw(options);
      }
      const radios = [...element.querySelectorAll<HTMLButtonElement>(".prefs-font")];
      for (const radio of radios) setAttr(radio, "aria-checked", String(radio.dataset.value === field.value));
      setDisabled(radios, field.disabled);
      group.settle();
      setAttr(element, "aria-label", row.querySelector(".setting-text > label")?.textContent ?? "");
      setAttr(element, "aria-describedby", field.getAttribute("aria-describedby"));
      setAttr(element, "aria-disabled", field.disabled ? "true" : null);
    },
  };
}
