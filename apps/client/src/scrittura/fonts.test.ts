import { describe, expect, it } from "vitest";
import { fontStack, genericFamily } from "./fonts";

describe("la pila di un carattere del documento", () => {
  it.each([
    ["Calibri", '"Calibri", "Carlito", sans-serif'],
    ["Cambria", '"Cambria", "Caladea", serif'],
    ["Arial", '"Arial", "Liberation Sans", "Arimo", sans-serif'],
    ["Times New Roman", '"Times New Roman", "Liberation Serif", "Tinos", serif'],
    ["Courier New", '"Courier New", "Liberation Mono", "Cousine", monospace'],
    ["Aptos", '"Aptos", sans-serif'],
    ["Aptos Display", '"Aptos Display", sans-serif'],
    ["Verdana", '"Verdana", sans-serif'],
    ["Segoe UI", '"Segoe UI", sans-serif'],
    ["Georgia", '"Georgia", serif'],
    ["EB Garamond", '"EB Garamond", serif'],
    ["Garamond", '"Garamond", serif'],
    ["Consolas", '"Consolas", monospace'],
    ["Sconosciuto Pro", '"Sconosciuto Pro", serif'],
    ['Il "mio" carattere', '"Il \\"mio\\" carattere", serif'],
  ])("%s", (name, stack) => {
    expect(fontStack(name)).toBe(stack);
  });

  it("riconosce il nome senza badare a maiuscole e spazi", () => {
    expect(genericFamily("  CALIBRI light ")).toBe("sans-serif");
    expect(fontStack(" calibri ")).toBe('"calibri", "Carlito", sans-serif');
  });
});
