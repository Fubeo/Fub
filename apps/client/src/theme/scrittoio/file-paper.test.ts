// La carta del file (PA T56): chiara in ogni luce, con i segni di Fub che ci
// stanno sopra presi dalla carta e non dal tema.
//
// Al buio l'accento del tema è un verde chiaro: sul bianco della carta
// starebbe a 2,2:1. Qui si prova che l'anello del fuoco, la sintassi della
// formula, il cursore e i segni della griglia leggono i ruoli della carta,
// che le intestazioni (cornice) restano del tema, e che una scheda colorata
// della lavagna mescola il suo colore nella carta e non nel niente.
import { describe, expect, it } from "vitest";
import structure from "./structure.css?raw";
import editors from "./skin/editors.css?raw";
import drawers from "./skin/drawers.css?raw";

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selectors: match[1]!.split(/,(?![^()]*\))/).map((selector) => selector.trim()), body: match[2]! });
  }
  return out;
}

/// Il valore di `property` nell'ultima regola che ha esattamente `selector`.
function declared(css: string, selector: string, property: string): string | null {
  let value: string | null = null;
  for (const rule of rules(css)) {
    if (!rule.selectors.includes(selector)) continue;
    const match = new RegExp(`(?:^|;)\\s*${property.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+)`).exec(rule.body);
    if (match) value = match[1]!.trim();
  }
  return value;
}

const PAPER = [".look-file .rich-desk", ".look-file .grid-viewport"];
const SYNTAX = ["keyword", "name", "function", "literal", "type", "operator", "string", "heading"];

describe("la carta del file", () => {
  it.each(PAPER)("%s: l'anello e il cursore prendono l'accento della carta", (paper) => {
    expect(declared(structure, paper, "--focus-ring")).toMatch(/^var\(--paper-link, #[0-9a-f]{6}\)$/);
    expect(declared(structure, paper, "--doc-caret")).toMatch(/^var\(--paper-link, #[0-9a-f]{6}\)$/);
  });

  it.each(PAPER)("%s: la sintassi è d'inchiostro, come in Excel", (paper) => {
    for (const role of SYNTAX) expect(declared(structure, paper, `--syn-${role}`), role).toBe("var(--doc-fg)");
    expect(declared(structure, paper, "--syn-comment")).toBe("var(--doc-gutter-fg)");
    expect(declared(structure, paper, "--syn-invalid")).toBe("var(--doc-danger)");
  });

  it("le superfici che riempiono il riquadro hanno l'anello dentro", () => {
    for (const selector of [".cm-editor > .cm-scroller:focus-visible", ".pane-preview:focus-visible", ".graph-main:focus-visible"]) {
      expect(declared(structure, selector, "outline-offset"), selector).toBe("calc(-1 * var(--focus-ring-width))");
    }
  });
});

describe("i segni della griglia sulla carta", () => {
  // La pelle non dichiara variabili (`structure.test.ts`): i ruoli dei segni
  // si ridichiarano in `structure.css`, accanto alla carta.
  const marks = rules(structure).find((rule) => rule.selectors.some((selector) => selector.startsWith(".look-file :is(.grid-cell")));

  it("ridichiarano l'accento e il velo dalla carta", () => {
    expect(marks, "la regola dei segni sulla carta").toBeDefined();
    expect(marks!.body).toMatch(/--accent:\s*var\(--paper-link, #[0-9a-f]{6}\)/);
    expect(marks!.body).toMatch(/--accent-veil:\s*color-mix\(in srgb, var\(--paper-link, #[0-9a-f]{6}\) 12%, transparent\)/);
    for (const hook of ["grid-cell", "grid-selection", "grid-fill-handle", "grid-cell-editor", "grid-object", "grid-comment-mark"]) {
      expect(marks!.selectors[0], hook).toMatch(new RegExp(`\\.${hook}(?![\\w-])`));
    }
  });

  it("non toccano la riga né le intestazioni, che sono cornice", () => {
    expect(marks!.selectors).toHaveLength(1);
    expect(marks!.selectors[0]).not.toMatch(/\.grid-(row|header|corner)(?![\w-])/);
  });

  it("la cella in modifica ha il fondo della carta", () => {
    expect(declared(editors, ".look-file .grid-cell-editor", "background")).toBe("var(--doc-bg)");
    expect(declared(editors, ".look-file .grid-fill-handle", "border-color")).toBe("var(--doc-bg)");
  });
});

describe("le azioni e le pillole", () => {
  it("l'azione di un avviso prende l'inchiostro d'accento più forte", () => {
    expect(declared(drawers, ".conflict-banner .link-button", "color")).toBe("var(--accent-soft)");
    expect(declared(drawers, ".sheet-notice .link-button", "color")).toBe("var(--accent-soft)");
  });

  it("la pillola dei commenti ha l'anello dentro, e tiene la sua ombra", () => {
    expect(declared(editors, ".rich-side-open:focus-visible", "box-shadow")).toBe(
      "inset 0 0 0 var(--focus-ring-width) var(--focus-ring), var(--shadow-2)",
    );
  });
});

describe("le schede colorate della lavagna", () => {
  it("mescolano il colore nella carta della scheda, non nel niente", () => {
    for (const key of ["1", "2", "4", "5", "6"]) {
      const background = declared(editors, `.canvas-node[data-canvas-color="${key}"]`, "background");
      expect(background, key).toMatch(/^color-mix\(in srgb, var\(--[\w-]+\) \d+%, var\(--doc-bg\)\)$/);
    }
    for (const rule of rules(editors)) {
      if (!rule.selectors.some((selector) => selector.startsWith(".canvas-node[data-canvas-color"))) continue;
      expect(rule.body, rule.selectors.join(", ")).not.toMatch(/transparent\)/);
    }
  });
});
