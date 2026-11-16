// **Il presidio dell'eccezione del combobox modale nel banco
// dell'accessibilità**: il lanciatore senza anello passa, e ogni scorciatoia
// per farci passare un campo qualunque resta rossa.
//
// Il banco vero (`a11y.mjs`) apre un browser e non gira qui; qui gira il suo
// giudizio, `a11y-rules.mjs`. I fatti imitano quelli che il banco raccoglie
// sul lanciatore in luce chiara: il cursore prende il colore del testo, la
// riga attiva non ha un fondo suo e la segna il rettangolo del kit.
import { describe, expect, it } from "vitest";

import type { ComboboxFacts, Look } from "./a11y-rules.mjs";
import { alpha, modalComboboxGap } from "./a11y-rules.mjs";

const plain: Look = {
  background: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  border: "none",
  outline: "none",
  boxShadow: "none",
};
const filled: Look = { ...plain, background: "rgba(23, 31, 28, 0.06)" };

const launcher = (patch: Partial<ComboboxFacts> = {}): ComboboxFacts => ({
  tag: "INPUT",
  role: "combobox",
  focusVisible: true,
  readOnly: false,
  disabled: false,
  caretColor: "auto",
  color: "rgb(23, 31, 28)",
  width: 520,
  height: 54,
  visibility: "visible",
  controls: "listbox",
  dialog: { modal: "true" },
  descendant: {
    exists: true,
    look: plain,
    otherLook: plain,
    highlight: { hidden: false, look: filled, sameSize: true },
  },
  ...patch,
});

describe("l'alfa di un colore calcolato", () => {
  it("riconosce le forme che il browser calcola", () => {
    expect(alpha("transparent")).toBe(0);
    expect(alpha("rgba(0, 0, 0, 0)")).toBe(0);
    expect(alpha("rgba(1, 2, 3, 0.5)")).toBe(0.5);
    expect(alpha("rgb(1, 2, 3)")).toBe(1);
    expect(alpha("rgb(1 2 3 / 0)")).toBe(0);
    expect(alpha("color(srgb 1 0 0 / 0)")).toBe(0);
    expect(alpha("oklch(0.5 0.1 120 / 40%)")).toBeCloseTo(0.4);
    expect(alpha("#0000")).toBe(0);
    expect(alpha("#00000080")).toBeCloseTo(128 / 255);
    expect(alpha("blu")).toBeNull();
  });
});

describe("il combobox di una finestra modale", () => {
  it("passa col cursore visibile e la riga attiva segnata dal rettangolo del kit", () => {
    expect(modalComboboxGap(launcher())).toBeNull();
  });

  it("passa col cursore e un colore suo", () => {
    expect(modalComboboxGap(launcher({ caretColor: "rgb(0, 110, 70)" }))).toBeNull();
  });

  it("passa con la riga attiva che si distingue da sola", () => {
    expect(
      modalComboboxGap(launcher({ descendant: { exists: true, look: filled, otherLook: plain, highlight: null } })),
    ).toBeNull();
  });

  it("passa senza riga attiva (la lista è vuota): basta il cursore", () => {
    expect(modalComboboxGap(launcher({ descendant: null }))).toBeNull();
  });

  it("non passa con il cursore trasparente", () => {
    expect(modalComboboxGap(launcher({ caretColor: "transparent" }))).toBe("cursore trasparente");
    expect(modalComboboxGap(launcher({ caretColor: "rgba(0, 0, 0, 0)" }))).toBe("cursore trasparente");
    expect(modalComboboxGap(launcher({ caretColor: "auto", color: "rgba(0, 0, 0, 0)" }))).toBe("cursore trasparente");
  });

  it("non passa senza aria-modal, o fuori da una finestra", () => {
    expect(modalComboboxGap(launcher({ dialog: { modal: null } }))).toBe("la finestra non è modale");
    expect(modalComboboxGap(launcher({ dialog: { modal: "false" } }))).toBe("la finestra non è modale");
    expect(modalComboboxGap(launcher({ dialog: null }))).toBe("fuori da una finestra");
  });

  it("non passa senza un listbox in aria-controls", () => {
    expect(modalComboboxGap(launcher({ controls: null }))).toBe("aria-controls non porta a un listbox");
    expect(modalComboboxGap(launcher({ controls: "grid" }))).toBe("aria-controls non porta a un listbox");
  });

  it("non passa con la riga attiva indistinguibile", () => {
    const gap = "la riga attiva non si distingue dalle altre";
    expect(modalComboboxGap(launcher({ descendant: { exists: true, look: plain, otherLook: plain, highlight: null } }))).toBe(gap);
    // Il rettangolo c'è ma è nascosto, trasparente, o di un'altra misura.
    for (const highlight of [
      { hidden: true, look: filled, sameSize: true },
      { hidden: false, look: plain, sameSize: true },
      { hidden: false, look: filled, sameSize: false },
    ]) {
      expect(modalComboboxGap(launcher({ descendant: { exists: true, look: plain, otherLook: plain, highlight } }))).toBe(gap);
    }
    // L'unica opzione, senza un segno suo né il rettangolo.
    expect(modalComboboxGap(launcher({ descendant: { exists: true, look: plain, otherLook: null, highlight: null } }))).toBe(gap);
  });

  it("non passa se la riga attiva nominata non esiste", () => {
    expect(modalComboboxGap(launcher({ descendant: { exists: false } }))).toBe("la riga attiva non esiste");
  });

  it("non passa per un campo che non si può scrivere o non si vede", () => {
    expect(modalComboboxGap(launcher({ readOnly: true }))).toBe("campo in sola lettura");
    expect(modalComboboxGap(launcher({ disabled: true }))).toBe("campo disattivato");
    expect(modalComboboxGap(launcher({ width: 0 }))).toBe("campo senza dimensioni");
    expect(modalComboboxGap(launcher({ visibility: "hidden" }))).toBe("campo nascosto");
  });

  it("non passa per un campo che non è un combobox o non ha :focus-visible", () => {
    expect(modalComboboxGap(launcher({ role: "searchbox" }))).toBe("non è un input combobox");
    expect(modalComboboxGap(launcher({ tag: "DIV" }))).toBe("non è un input combobox");
    expect(modalComboboxGap(launcher({ focusVisible: false }))).toBe("senza :focus-visible");
    expect(modalComboboxGap(null)).toBe("nessun fatto");
  });
});
