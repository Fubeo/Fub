// I numeri dei campi del pannello delle proprietà: operazioni, unità e
// percentuali, e che cosa non va in ciò che non si legge.

import { describe, expect, it } from "vitest";
import { ANGLE_UNITS, evaluate, lengthUnits, PERCENT_UNITS, type Measure } from "./quantity";

const mm: Measure = { units: lengthUnits("mm"), current: 80, relative: true };
const px: Measure = { units: lengthUnits("px"), current: 200, relative: true };

const value = (input: string, measure: Measure): number => {
  const out = evaluate(input, measure);
  if (!("value" in out)) throw new Error(`${input}: ${out.problem}`);
  return out.value;
};

describe("le operazioni", () => {
  it("valgono con le precedenze dell'aritmetica e le parentesi", () => {
    expect(value("120+15", px)).toBe(135);
    expect(value("(40-8)/2", px)).toBe(16);
    expect(value("2+3*4", px)).toBe(14);
    expect(value("2*(3+4)", px)).toBe(14);
    expect(value("10-4-3", px)).toBe(3);
    expect(value("64/4/2", px)).toBe(8);
  });

  it("leggono il segno davanti a un numero e a una parentesi", () => {
    expect(value("-12", px)).toBe(-12);
    expect(value("+12", px)).toBe(12);
    expect(value("-(3+4)", px)).toBe(-7);
    expect(value("5--2", px)).toBe(7);
    expect(Object.is(value("-0", px), 0)).toBe(true);
  });

  it("accettano gli spazi e i segni che arrivano incollati", () => {
    expect(value("  120 + 15 ", px)).toBe(135);
    expect(value("10 − 4", px)).toBe(6);
    expect(value("3 × 4", px)).toBe(12);
    expect(value("12 ÷ 4", px)).toBe(3);
  });

  it("leggono la virgola e il punto come separatori dei decimali", () => {
    expect(value("12,5", px)).toBe(12.5);
    expect(value("12.5", px)).toBe(12.5);
    expect(value(",5", px)).toBe(0.5);
    expect(value("3.", px)).toBe(3);
    expect(value("1e2", px)).toBe(100);
  });
});

describe("le unità", () => {
  it("convertono nell'unità del campo", () => {
    expect(value("1in", mm)).toBeCloseTo(25.4, 9);
    expect(value("2cm", mm)).toBeCloseTo(20, 9);
    expect(value("96px", mm)).toBeCloseTo(25.4, 9);
    expect(value("72pt", px)).toBeCloseTo(96, 9);
    expect(value("25.4mm", px)).toBeCloseTo(96, 9);
  });

  it("si scrivono attaccate o staccate, maiuscole o minuscole", () => {
    expect(value("1 in", mm)).toBeCloseTo(25.4, 9);
    expect(value("1IN", mm)).toBeCloseTo(25.4, 9);
  });

  it("valgono per il numero o la parentesi che le precede, anche in un'operazione", () => {
    expect(value("1in + 5", mm)).toBeCloseTo(30.4, 9);
    expect(value("(1+1)in", mm)).toBeCloseTo(50.8, 9);
    expect(value("10mm/2", mm)).toBe(5);
  });

  it("degli angoli sono i gradi, col segno o col nome", () => {
    const angle: Measure = { units: ANGLE_UNITS, current: 30, relative: false };
    expect(value("45°", angle)).toBe(45);
    expect(value("45 deg", angle)).toBe(45);
    expect(evaluate("45mm", angle)).toEqual({ problem: "unit" });
  });

  it("che il campo non accetta non passano", () => {
    expect(evaluate("12em", mm)).toEqual({ problem: "unit" });
    expect(evaluate("12 metri", mm)).toEqual({ problem: "unit" });
  });
});

describe("la percentuale", () => {
  it("è una parte del valore che il campo mostra", () => {
    expect(value("50%", mm)).toBe(40);
    expect(value("80+10%", mm)).toBe(88);
    expect(value("150 %", px)).toBe(300);
  });

  it("in un campo misto non ha di che essere parte", () => {
    expect(evaluate("50%", { ...mm, current: null })).toEqual({ problem: "relative" });
    expect(value("12", { ...mm, current: null })).toBe(12);
  });

  it("dove il campo è in percentuale è la sua unità", () => {
    const opacity: Measure = { units: PERCENT_UNITS, current: 40, relative: false };
    expect(value("50%", opacity)).toBe(50);
    expect(value("50", opacity)).toBe(50);
  });

  it("dove non vale come parte non passa", () => {
    expect(evaluate("50%", { units: ANGLE_UNITS, current: 30, relative: false })).toEqual({ problem: "unit" });
  });
});

describe("ciò che non si legge", () => {
  it("dice che cosa non va", () => {
    expect(evaluate("", px)).toEqual({ problem: "empty" });
    expect(evaluate("   ", px)).toEqual({ problem: "empty" });
    expect(evaluate("12+", px)).toEqual({ problem: "syntax" });
    expect(evaluate("(12", px)).toEqual({ problem: "syntax" });
    expect(evaluate("12)", px)).toEqual({ problem: "syntax" });
    expect(evaluate("1 2", px)).toEqual({ problem: "syntax" });
    expect(evaluate("abc", px)).toEqual({ problem: "syntax" });
    expect(evaluate("1,5,5", px)).toEqual({ problem: "syntax" });
    expect(evaluate("4/0", px)).toEqual({ problem: "finite" });
    expect(evaluate("1e400", px)).toEqual({ problem: "finite" });
  });
});
