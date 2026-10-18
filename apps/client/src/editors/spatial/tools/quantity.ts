// I numeri dei campi del pannello delle proprietà: si scrivono come in un
// programma di disegno, con le quattro operazioni e le unità, e valgono
// nell'unità del campo. Il pannello è in `properties.ts`; qui c'è come si
// legge ciò che si scrive, senza DOM.
//
// - **Le operazioni.** `+`, `-`, `*` e `/`, con le precedenze dell'aritmetica
//   e le parentesi: `120+15`, `(40-8)/2`. Valgono anche `−`, `×` e `÷`, che
//   arrivano incollati da un testo.
// - **Le unità.** Un numero senza unità è nell'unità del campo; uno con
//   l'unità si converte: in un campo in millimetri `1in` vale 25,4. Le unità
//   si scrivono attaccate o staccate, maiuscole o minuscole, e una vale per il
//   numero o per la parentesi che la precede.
// - **La percentuale** è una parte del valore che il campo mostra: in un
//   campo che dice 80, `50%` vale 40 e `80+10%` vale 88. Dove il campo è in
//   percentuale, come l'opacità, `%` è la sua unità.
// - **La virgola e il punto** separano entrambi i decimali, come li scrive
//   chi usa una tastiera italiana o una inglese; le migliaia non si
//   separano.

import { UNIT_SIZE, UNITS, type LengthUnit } from "../scene/rulers";

/// Come un campo legge ciò che si scrive.
export interface Measure {
  /// Le unità che il campo accetta, minuscole, e quanto vale ciascuna
  /// nell'unità del campo.
  readonly units: Readonly<Record<string, number>>;
  /// Il valore che il campo mostra, nell'unità del campo: `%` ne prende una
  /// parte. `null` per un campo misto, dove `%` non ha di che essere parte.
  readonly current: number | null;
  /// Vero se `%`, quando non è un'unità del campo, è una parte del valore.
  readonly relative: boolean;
}

/// Che cosa non va in ciò che si è scritto: niente; una scrittura che non è
/// un'espressione; un'unità che il campo non accetta; una percentuale di un
/// campo misto; un risultato che non è un numero, come una divisione per
/// zero.
export type QuantityProblem = "empty" | "syntax" | "unit" | "relative" | "finite";

export type Quantity = { readonly value: number } | { readonly problem: QuantityProblem };

/// Le unità di una lunghezza mostrata in `unit`: le cinque del documento.
export function lengthUnits(unit: LengthUnit): Readonly<Record<string, number>> {
  return Object.fromEntries(UNITS.map((other) => [other, UNIT_SIZE[other] / UNIT_SIZE[unit]]));
}

/// Le unità di un angolo, in gradi.
export const ANGLE_UNITS: Readonly<Record<string, number>> = { "°": 1, deg: 1 };

/// Le unità di un campo in percentuale.
export const PERCENT_UNITS: Readonly<Record<string, number>> = { "%": 1 };

/// Un errore della lettura, che la interrompe.
class Refusal {
  constructor(readonly problem: QuantityProblem) {}
}

/// I segni che arrivano incollati, come li legge la grammatica.
const SIGNS: Readonly<Record<string, string>> = { "−": "-", "–": "-", "×": "*", "·": "*", "÷": "/" };

/// Un numero: cifre con al più un separatore dei decimali, e l'esponente.
const NUMBER = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?/;

/// Il valore di `input` nell'unità del campo `measure`, o che cosa non va.
export function evaluate(input: string, measure: Measure): Quantity {
  const text = input.replace(/[−–×·÷]/g, (sign) => SIGNS[sign]!).toLowerCase();
  if (text.trim() === "") return { problem: "empty" };
  let at = 0;

  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at]!)) at++;
  };
  const peek = (): string => {
    skip();
    return text[at] ?? "";
  };

  const expression = (): number => {
    let value = term();
    for (let sign = peek(); sign === "+" || sign === "-"; sign = peek()) {
      at++;
      const next = term();
      value = sign === "+" ? value + next : value - next;
    }
    return value;
  };

  const term = (): number => {
    let value = unary();
    for (let sign = peek(); sign === "*" || sign === "/"; sign = peek()) {
      at++;
      const next = unary();
      value = sign === "*" ? value * next : value / next;
    }
    return value;
  };

  const unary = (): number => {
    const sign = peek();
    if (sign === "-" || sign === "+") {
      at++;
      const value = unary();
      return sign === "-" ? -value : value;
    }
    return withUnit(primary());
  };

  const primary = (): number => {
    if (peek() === "(") {
      at++;
      const value = expression();
      if (peek() !== ")") throw new Refusal("syntax");
      at++;
      return value;
    }
    const found = NUMBER.exec(text.slice(at));
    if (found === null) throw new Refusal("syntax");
    at += found[0].length;
    return Number(found[0].replace(",", "."));
  };

  /// L'unità dopo un numero o una parentesi, se c'è.
  const withUnit = (value: number): number => {
    const next = peek();
    let unit: string;
    if (next === "%" || next === "°") {
      unit = next;
    } else {
      const word = /^[a-z]+/.exec(text.slice(at));
      if (word === null) return value;
      unit = word[0];
    }
    at += unit.length;
    const factor = measure.units[unit];
    if (factor !== undefined) return value * factor;
    if (unit !== "%" || !measure.relative) throw new Refusal("unit");
    if (measure.current === null) throw new Refusal("relative");
    return (value / 100) * measure.current;
  };

  try {
    const value = expression();
    if (peek() !== "") return { problem: "syntax" };
    if (!Number.isFinite(value)) return { problem: "finite" };
    // Lo zero col segno è zero.
    return { value: value + 0 };
  } catch (error) {
    if (error instanceof Refusal) return { problem: error.problem };
    throw error;
  }
}
