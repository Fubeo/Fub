// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import {
  explainBlank,
  explainColor,
  explainZero,
  formChoice,
  formCheck,
  formError,
  formNote,
  formNumber,
  formText,
  sixDigits,
  type FormNumberOptions,
} from "./form";
import { press } from "./testing";

let life: Lifetime;

const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function numberOptions(extra: Partial<FormNumberOptions> = {}): FormNumberOptions {
  return {
    label: "Spostamento",
    value: 6,
    unit: "px",
    min: 1,
    max: 9,
    outOfRange: (min, max) => `Scrivi un numero fra ${min} e ${max}.`,
    problem: (problem) => `non va: ${problem}`,
    onChange: () => {},
    lifetime: life,
    ...extra,
  };
}

beforeEach(() => {
  life = openLifetime();
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
});

describe("formNumber: il numero con i suoi limiti", () => {
  it("prende un valore dentro i limiti e lo dice a chi chiama", () => {
    const taken: number[] = [];
    const field = formNumber(numberOptions({ onChange: (value) => taken.push(value) }));
    document.body.append(field.element);
    type(field.input, "7");
    press(field.input, "Enter");
    expect(taken).toEqual([7]);
    expect(field.value()).toBe(7);
    expect(field.valid()).toBe(true);
  });

  it("fuori dai limiti non prende il valore: dice la frase e il campo è in errore", async () => {
    const taken: number[] = [];
    const validity: boolean[] = [];
    const field = formNumber(numberOptions({ onChange: (value) => taken.push(value), onValidity: (valid) => validity.push(valid) }));
    document.body.append(field.element);
    type(field.input, "12");
    press(field.input, "Enter");
    await flush();
    expect(taken).toEqual([]);
    expect(field.value()).toBe(6);
    expect(field.valid()).toBe(false);
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
    expect(field.element.querySelector(".kit-number-error")?.textContent).toBe("Scrivi un numero fra 1 e 9.");
    expect(validity).toEqual([false]);
  });

  it("torna valido quando il valore rientra, e lo dice", async () => {
    const validity: boolean[] = [];
    const field = formNumber(numberOptions({ onValidity: (valid) => validity.push(valid) }));
    document.body.append(field.element);
    type(field.input, "0");
    press(field.input, "Enter");
    await flush();
    type(field.input, "3");
    press(field.input, "Enter");
    await flush();
    expect(field.valid()).toBe(true);
    expect(validity).toEqual([false, true]);
  });

  it("dichiara i limiti come attributi dello spinbutton", () => {
    const field = formNumber(numberOptions());
    document.body.append(field.element);
    expect(field.input.getAttribute("aria-valuemin")).toBe("1");
    expect(field.input.getAttribute("aria-valuemax")).toBe("9");
  });
});

describe("formChoice: una scelta a segmenti", () => {
  it("accende la scelta data e le frecce passano alla vicina", () => {
    const taken: string[] = [];
    const choice = formChoice({
      label: "Giunzioni",
      choices: [
        { value: "vivo", label: "Angolo vivo" },
        { value: "arrotondato", label: "Arrotondato" },
        { value: "smussato", label: "Smussato" },
      ],
      value: "arrotondato",
      onChange: (value) => taken.push(value),
      lifetime: life,
    });
    document.body.append(choice.element);
    const options = [...choice.element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(options.map((button) => button.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(options.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    options[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(taken).toEqual(["smussato"]);
    expect(choice.value()).toBe("smussato");
    expect(options[2]!.getAttribute("aria-checked")).toBe("true");
    options[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(choice.value()).toBe("vivo");
  });

  it("il gruppo è nominato dalla sua etichetta", () => {
    const choice = formChoice({ label: "Giunzioni", choices: [{ value: "a", label: "A" }], value: "a", onChange: () => {}, lifetime: life });
    document.body.append(choice.element);
    const group = choice.element.querySelector('[role="radiogroup"]');
    const name = choice.element.querySelector(".kit-form-label");
    expect(group?.getAttribute("aria-labelledby")).toBe(name?.id);
    expect(name?.textContent).toBe("Giunzioni");
  });
});

describe("formCheck: la casella con la sua frase", () => {
  it("dice il nuovo stato quando cambia, e la frase sta nell'etichetta", () => {
    const taken: boolean[] = [];
    const check = formCheck({ label: "Anteprima", checked: true, onChange: (checked) => taken.push(checked), lifetime: life });
    document.body.append(check.element);
    const input = check.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const label = check.element.querySelector<HTMLLabelElement>("label.kit-form-check")!;
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe("Anteprima");
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(taken).toEqual([false]);
    expect(check.checked()).toBe(false);
  });
});

describe("testi della domanda", () => {
  it("la nota dice in pagina con role status, l'errore con role alert", () => {
    const note = formNote("Sto preparando.", true);
    const error = formError("Non riesco.");
    expect(note.className).toBe("kit-form-note");
    expect(note.getAttribute("role")).toBe("status");
    expect(error.className).toBe("kit-form-error");
    expect(error.getAttribute("role")).toBe("alert");
  });

  it("il testo vuoto o di soli spazi non è valido, e l'errore si accende e si spegne", () => {
    const field = formText({ label: "Nome", value: "  ", blank: "Scrivi qualcosa.", onChange: () => {}, lifetime: life });
    document.body.append(field.element);
    expect(field.valid()).toBe(false);
    field.setError("Scrivi qualcosa.");
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
    field.input.value = "Ciao";
    expect(field.valid()).toBe(true);
    field.setError(null);
    expect(field.input.hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("regole dei campi, con la frase di chi chiama", () => {
  it("il vuoto e lo zero dicono la frase data, e si tolgono quando passano", () => {
    const input = document.createElement("input");
    input.value = "   ";
    explainBlank(input, "vuoto");
    expect(input.validationMessage).toBe("vuoto");
    input.value = "x";
    explainBlank(input, "vuoto");
    expect(input.validity.customError).toBe(false);
    input.value = "0";
    explainZero(input, "zero");
    expect(input.validationMessage).toBe("zero");
    input.value = "2";
    explainZero(input, "zero");
    expect(input.validity.customError).toBe(false);
  });

  it("un codice di colore sbagliato dice la frase data", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.pattern = "#?(?:[0-9a-fA-F]{3}){1,2}";
    input.value = "rosso";
    explainColor(input, "colore");
    expect(input.validationMessage).toBe("colore");
  });

  it("sixDigits porta un codice a sei cifre minuscolo, e rifiuta il resto", () => {
    expect(sixDigits("#abc")).toBe("#aabbcc");
    expect(sixDigits("ABCDEF")).toBe("#abcdef");
    expect(sixDigits(" #0A0 ")).toBe("#00aa00");
    expect(sixDigits("xyz")).toBeNull();
  });
});
