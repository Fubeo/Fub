// I bersagli piccoli dell'editor (UX-018, UX-021): ciò che si vede resta
// della misura del prototipo, la zona che prende il puntatore arriva a 24 px.
// La misura vera l'ha presa il banco con `elementFromPoint` (la barra della
// riga prende il clic da 4 px sopra a 5 px sotto, la colonna da 4 px a
// sinistra a 5 px a destra; il filo dei titoli chiuso è largo 24 px); qui si
// tengono le regole.
import { describe, expect, it } from "vitest";
import tabella from "./skin/tabella.css?raw";
import sheets from "../../shells/scrittoio/sheets/sheets.css?raw";

/// Le dichiarazioni delle regole il cui selettore è esattamente `selector`.
function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1]!.trim() !== selector && !rule[1]!.split(",").some((each) => each.trim() === selector)) continue;
    for (const line of rule[2]!.split(";")) {
      const [name, ...value] = line.split(":");
      if (name && value.length > 0) out[name.trim()] = value.join(":").trim();
    }
  }
  return out;
}

const px = (value: string | undefined): number => {
  const found = /^(-?\d+(?:\.\d+)?)px$/.exec(value ?? "");
  expect(found, `una misura in px, non «${value}»`).not.toBeNull();
  return Number(found![1]);
};

describe("le barre «Aggiungi una riga» e «Aggiungi una colonna»", () => {
  const add = '.cm-editor .cm-content .tb-add';

  it("la barra che si vede resta di 15 px, come `.tg-add` del prototipo", () => {
    expect(declarations(tabella, `${add}[data-add="row"]`).height).toBe("15px");
    expect(declarations(tabella, `${add}[data-add="column"]`).width).toBe("15px");
  });

  it("la zona del clic è di almeno 24 px sul lato corto, e cresce solo lì", () => {
    const base = declarations(tabella, `${add}::before`);
    expect(base).toMatchObject({ content: '""', position: "absolute", inset: "0" });
    const row = declarations(tabella, `${add}[data-add="row"]::before`);
    expect(15 - px(row.top) - px(row.bottom)).toBeGreaterThanOrEqual(24);
    expect([row.left, row.right]).toEqual([undefined, undefined]);
    const column = declarations(tabella, `${add}[data-add="column"]::before`);
    expect(15 - px(column.left) - px(column.right)).toBeGreaterThanOrEqual(24);
    expect([column.top, column.bottom]).toEqual([undefined, undefined]);
  });

  it("verso la tabella la zona si ferma al suo bordo, 4 px più su della barra", () => {
    // La barra sta 4 px fuori dalla tabella (19 px di scarto meno 15 di barra).
    const row = declarations(tabella, `${add}[data-add="row"]`);
    expect(-px(row.bottom) - 15).toBe(4);
    expect(-px(declarations(tabella, `${add}[data-add="row"]::before`).top)).toBeLessThanOrEqual(4);
    expect(-px(declarations(tabella, `${add}[data-add="column"]::before`).left)).toBeLessThanOrEqual(4);
  });
});

describe("le tacche dei titoli a margine", () => {
  it("la tacca resta di 12 px, la zona che apre l'indice è larga 24 col margine largo", () => {
    expect(declarations(sheets, ".sheet-thread-notch").width).toBe("12px");
    expect(px(declarations(sheets, `.sheet-thread[data-room="wide"] .sheet-thread-item`)["min-width"])).toBeGreaterThanOrEqual(24);
    expect(declarations(sheets, ".sheet-thread-item")["min-width"]).toBeUndefined();
  });

  it("aperto, l'indice ha righe di almeno 24 px", () => {
    const open = declarations(sheets, ".sheet-thread:is(:hover, :has(:focus-visible)) .sheet-thread-item");
    expect(px(open.height)).toBeGreaterThanOrEqual(24);
  });
});
