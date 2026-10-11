// @vitest-environment happy-dom
// La finestra di «Rendi modificabile»: ciò che resta sbiadito nell'anteprima
// di dopo, il perché di ogni parte che resta, la frase, l'elenco delle
// traduzioni e i pulsanti.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { changeLines, editableDialog, editableMessage, fadedMarkup, LISTED_LEFTOVERS, leftoverText, reasonText } from "./editable-dialog";
import type { EditablePlan, Leftover, Reason } from "./make-editable";

const FADE = "opacity:0.25!important";

/// Un piano con ciò che serve alla finestra: `ops` dice soltanto quante
/// operazioni ci sono.
function plan(overrides: Partial<Omit<EditablePlan, "ops">> & { readonly ops?: number } = {}): EditablePlan {
  const { ops = 1, ...rest } = overrides;
  return {
    ops: Array.from({ length: ops }, () => ({ op: "adopt" as const })),
    converted: 0,
    translations: new Map(),
    leftovers: [],
    rules: 0,
    sheets: 0,
    invisible: 0,
    after: ops > 0 ? "<svg/>" : null,
    ...rest,
  };
}

const left = (reason: Reason, name: string | null = null, tag = "switch"): Leftover => ({ path: [0], tag, name, reason });

/// Ogni perché, uno per tipo.
const REASONS: readonly Reason[] = [
  { kind: "element", tag: "switch" },
  { kind: "use" },
  { kind: "place", tag: "linearGradient" },
  { kind: "attribute", name: "requiredFeatures" },
  { kind: "missing", name: "x1" },
  { kind: "property", name: "color", value: "#c00" },
  { kind: "condition", text: "@media print" },
  { kind: "selector", text: "rect:hover" },
  { kind: "shared", text: ".a" },
  { kind: "structure" },
  { kind: "import" },
  { kind: "unit", value: "2ex" },
  { kind: "resource", id: "f1" },
  { kind: "copy" },
  { kind: "linked", id: "i-star" },
  { kind: "locked" },
  { kind: "text" },
  { kind: "child", tag: "foreignObject" },
  { kind: "unknown" },
];

beforeEach(() => {
  vi.stubGlobal("navigator", { language: "it-IT" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const open of document.querySelectorAll(".shell-dialog")) open.remove();
});

describe("ciò che resta, sbiadito", () => {
  it("aggiunge l'opacità in coda allo `style`, o un `style` prima della chiusura del tag", () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect style="fill:red" width="1"/>\n  <g>\n    <circle r="1" />\n    <switch><rect/></switch>\n  </g>\n</svg>';
    expect(fadedMarkup(text, [[0], [1, 0], [1, 1]])).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg">\n  <rect style="fill:red;${FADE}" width="1"/>\n  <g>\n    <circle r="1"  style="${FADE}"/>\n    <switch style="${FADE}"><rect/></switch>\n  </g>\n</svg>`,
    );
  });

  it("conta soltanto i figli elemento, e lascia stare un percorso che non porta a niente o il testo che non si legge", () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"><!-- nota -->testo<rect/><circle/></svg>';
    expect(fadedMarkup(text, [[1]])).toBe(`<svg xmlns="http://www.w3.org/2000/svg"><!-- nota -->testo<rect/><circle style="${FADE}"/></svg>`);
    expect(fadedMarkup(text, [[5], [0, 0], []])).toBe(text);
    expect(fadedMarkup("<svg", [[0]])).toBe("<svg");
    expect(fadedMarkup(text, [])).toBe(text);
  });
});

describe("il perché", () => {
  it("ha parole per ogni tipo, in italiano e in inglese, coi nomi al loro posto", () => {
    for (const language of ["it-IT", "en-GB"]) {
      vi.stubGlobal("navigator", { language });
      const texts = REASONS.map(reasonText);
      for (const text of texts) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/[{}]/);
      }
      expect(new Set(texts).size).toBe(REASONS.length);
    }
    vi.stubGlobal("navigator", { language: "it-IT" });
    expect(reasonText({ kind: "property", name: "color", value: "#c00" })).toBe("lo stile «color: #c00» non si scrive nel formato di FubDraw");
    expect(reasonText({ kind: "linked", id: "i-star" })).toBe("è legata a «i-star», che resta com’è: diventano modificabili insieme");
  });

  it("cita un selettore lungo accorciato, su una riga", () => {
    const long = `.a,\n  ${"rect.b ".repeat(20)}`;
    const text = reasonText({ kind: "selector", text: long });
    const quoted = /«(.*)»/.exec(text)![1]!;
    expect(quoted.length).toBe(60);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted).not.toContain("\n");
  });

  it("nomina la parte col suo nome, o col tag", () => {
    expect(leftoverText(left({ kind: "element", tag: "switch" }))).toBe("«switch»: FubDraw non ha l’elemento «switch»");
    expect(leftoverText(left({ kind: "locked" }, "Logo", "g"))).toBe("«Logo»: sta in un livello o in un gruppo bloccato");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(leftoverText(left({ kind: "copy" }, "Star", "path"))).toBe("“Star”: a “use” also shows it elsewhere");
  });
});

describe("la frase e gli elenchi", () => {
  it("dice quante parti diventano modificabili, quante restano, ciò che non si vede e l'adozione", () => {
    expect(editableMessage({ plan: plan({ converted: 1 }), adopts: false })).toBe("Una parte di un altro programma diventa modificabile, e si vede come prima.");
    expect(editableMessage({ plan: plan({ converted: 3, leftovers: [left({ kind: "text" }), left({ kind: "use" })], invisible: 1 }), adopts: true })).toBe(
      "3 parti di altri programmi diventano modificabili, e si vedono come prima. 2 parti restano come sono: sotto, il perché. Una parte che non si vede, come i metadati o le impostazioni di un altro programma, resta com’è. Il file riceve anche i due attributi di FubDraw sulla radice.",
    );
    expect(editableMessage({ plan: plan({ ops: 0, leftovers: [left({ kind: "text" })] }), adopts: true })).toBe("Niente diventa modificabile senza cambiare ciò che si vede. Una parte resta com’è: sotto, il perché.");
    expect(editableMessage({ plan: plan({ rules: 2 }), adopts: false })).toBe("Niente diventa modificabile senza cambiare ciò che si vede. Dai fogli di stile se ne va ciò che non sceglie più niente.");
  });

  it("elenca le traduzioni nel loro ordine, poi le regole e i fogli che se ne vanno", () => {
    const translations = new Map([["use", 2], ["style", 4], ["color", 1]] as const);
    expect(changeLines(plan({ translations, rules: 3, sheets: 1 }))).toEqual([
      "Stile in linea scritto come attributi: 4",
      "Colori di CSS scritti come #rrggbb: 1",
      "use diventati istanze di simboli: 2",
      "Regole dei fogli di stile tolte: 3",
      "Fogli di stile tolti: 1",
    ]);
    expect(changeLines(plan())).toEqual([]);
  });
});

describe("la finestra", () => {
  const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".shell-dialog")!;
  const buttons = (): string[] => [...dialog().querySelectorAll("button")].map((button) => button.textContent ?? "");

  it("mostra prima e dopo, la frase, gli elenchi; conferma col fuoco sulla conferma", async () => {
    const leftovers = [left({ kind: "element", tag: "switch" }), left({ kind: "unit", value: "2ex" }, "Nota", "text")];
    const shown = editableDialog({ plan: plan({ converted: 2, leftovers, translations: new Map([["style", 2]]) }), all: true, adopts: false, before: "blob:prima", after: "blob:dopo" });
    const box = dialog();
    expect(box.querySelector(".palette-heading")!.textContent).toBe("Rendi modificabile il disegno");
    expect(document.getElementById(box.getAttribute("aria-describedby")!)!.textContent).toBe(
      "2 parti di altri programmi diventano modificabili, e si vedono come prima. 2 parti restano come sono: sotto, il perché.",
    );
    expect([...box.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["blob:prima", "blob:dopo"]);
    expect(box.querySelector(".draw-editable-pair")!.getAttribute("aria-hidden")).toBe("true");
    expect([...box.querySelectorAll("figcaption")].map((caption) => caption.textContent)).toEqual(["Prima", "Dopo: ciò che resta è sbiadito"]);
    expect([...box.querySelectorAll(".draw-editable-heading")].map((heading) => heading.textContent)).toEqual(["Elementi riscritti", "Che cosa resta com’è"]);
    expect([...box.querySelectorAll(".draw-editable-list li")].map((item) => item.textContent)).toEqual([
      "Stile in linea scritto come attributi: 2",
      "«switch»: FubDraw non ha l’elemento «switch»",
      "«Nota»: la misura «2ex» non si sa calcolare",
    ]);
    expect(buttons()).toEqual(["Rendi modificabile", "Annulla"]);
    expect(document.activeElement?.textContent).toBe("Rendi modificabile");
    const issues = await checkAccessibility(box);
    expect(issues, formatIssues(issues)).toEqual([]);
    box.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await expect(shown).resolves.toBe(true);
  });

  it("si annulla col suo pulsante; su una parte ha il titolo breve", async () => {
    const shown = editableDialog({ plan: plan({ converted: 1 }), all: false, adopts: false, before: null, after: null });
    expect(dialog().querySelector(".palette-heading")!.textContent).toBe("Rendi modificabile");
    expect(dialog().querySelector("img")).toBeNull();
    expect(dialog().querySelector(".draw-editable-details")).toBeNull();
    [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Annulla")!.click();
    await expect(shown).resolves.toBe(false);
  });

  it("senza niente da fare dice perché e si chiude soltanto", async () => {
    const shown = editableDialog({ plan: plan({ ops: 0, leftovers: [left({ kind: "copy" }, "r", "rect")] }), all: false, adopts: false, before: null, after: null });
    expect(dialog().querySelector(".draw-editable-pair")).toBeNull();
    expect(buttons()).toEqual(["Chiudi"]);
    dialog().querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await expect(shown).resolves.toBe(false);
  });

  it(`nomina al più ${LISTED_LEFTOVERS} parti che restano, e dice quante sono le altre`, async () => {
    const many = Array.from({ length: LISTED_LEFTOVERS + 3 }, (_, at) => left({ kind: "text" }, `T${at}`, "text"));
    const shown = editableDialog({ plan: plan({ converted: 1, leftovers: many }), all: true, adopts: false, before: null, after: null });
    const items = [...dialog().querySelectorAll(".draw-editable-list li")];
    expect(items).toHaveLength(LISTED_LEFTOVERS + 1);
    expect(items[items.length - 1]!.textContent).toBe("E altre 3 parti.");
    expect(items[items.length - 1]!.className).toBe("draw-editable-more");
    dialog().querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await shown;
  });
});
