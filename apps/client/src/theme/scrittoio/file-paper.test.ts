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
import sheetDark from "./sheet-dark.css?raw";
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

/// I ruoli di un foglio del tema, dal suo `:root`.
function tokens(css: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) if (!out.has(match[1]!)) out.set(match[1]!, match[2]!.trim());
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi)!.map((part) => {
    const v = parseInt(part, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/// Il valore che `var(--name, #ripiego)` prende nel foglio `theme`.
function resolve(value: string, theme: ReadonlyMap<string, string>): string {
  const match = /^var\(--([\w-]+)(?:,\s*(#[0-9a-f]{6}))?\)$/i.exec(value.trim());
  if (!match) return value.trim();
  const own = theme.get(match[1]!);
  return own ? resolve(own, theme) : match[2]!;
}

const dark = tokens(sheetDark);
/// Le superfici di carta: il testo del documento, l'intestazione e il piè in
/// scrittura, la vista della griglia. Non la scrivania intera.
const PAPER = [".look-file .rich-content", ".look-file .rich-running", ".look-file .grid-viewport"];
const SYNTAX = ["keyword", "name", "function", "literal", "type", "operator", "string", "heading"];

describe("la carta del file", () => {
  it.each(PAPER)("%s: l'anello prende l'accento della carta", (paper) => {
    expect(declared(structure, paper, "--focus-ring")).toMatch(/^var\(--paper-link, #[0-9a-f]{6}\)$/);
  });

  it.each(PAPER)("%s: la sintassi è d'inchiostro, come in Excel", (paper) => {
    for (const role of SYNTAX) expect(declared(structure, paper, `--syn-${role}`), role).toBe("var(--doc-fg)");
    expect(declared(structure, paper, "--syn-comment")).toBe("var(--doc-gutter-fg)");
    expect(declared(structure, paper, "--syn-invalid")).toBe("var(--doc-danger)");
  });

  it("la scrivania non porta l'anello della carta: l'editor di un disegno ci sta col fondo del tema", () => {
    expect(declared(structure, ".look-file .rich-desk", "--focus-ring")).toBeNull();
    for (const role of SYNTAX) expect(declared(structure, ".look-file .rich-desk", `--syn-${role}`), role).toBeNull();
    // Al buio l'anello del tema regge sul fondo del tema; quello della carta no.
    expect(contrast(resolve("var(--focus-ring)", dark), resolve("var(--sheet)", dark))).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve("var(--paper-link, #007249)", dark), resolve("var(--sheet)", dark))).toBeLessThan(3);
  });

  it("il cursore viene da `--paper-caret`, il ruolo del contratto, e la carta non lo ridichiara", () => {
    const caret = declared(structure, ".look-file", "--doc-caret");
    expect(caret).toMatch(/^var\(--paper-caret, #[0-9a-f]{6}\)$/);
    for (const paper of [".look-file .rich-desk", ...PAPER]) expect(declared(structure, paper, "--doc-caret"), paper).toBeNull();
    // Al buio il cursore della carta sta sul bianco della carta.
    expect(contrast(resolve(caret!, dark), resolve("var(--paper-bg, #ffffff)", dark))).toBeGreaterThanOrEqual(3);
  });

  it("le superfici che riempiono il riquadro hanno l'anello dentro", () => {
    for (const selector of [".pane-preview:focus-visible", ".graph-main:focus-visible"]) {
      expect(declared(structure, selector, "outline-offset"), selector).toBe("calc(-1 * var(--focus-ring-width))");
    }
  });

  it("nell'editor l'anello lo disegna l'editor, sopra i numeri di riga che coprirebbero quello dello scroller", () => {
    const ring = ".cm-editor:has(> .cm-scroller:focus-visible)::after";
    expect(declared(structure, ring, "outline")).toBe("var(--focus-ring-width) solid var(--focus-ring)");
    expect(declared(structure, ring, "outline-offset")).toBe("calc(-1 * var(--focus-ring-width))");
    expect(declared(structure, ring, "inset")).toBe("0");
    expect(declared(structure, ring, "pointer-events")).toBe("none");
    // Sopra le gutter di CodeMirror, che stanno a 200.
    expect(Number(declared(structure, ring, "z-index"))).toBeGreaterThan(200);
    expect(declared(structure, ".cm-editor > .cm-scroller:focus-visible", "outline")).toBe("none");
  });
});

describe("i segni della griglia sulla carta", () => {
  // La pelle non dichiara variabili (`structure.test.ts`): i ruoli dei segni
  // si ridichiarano in `structure.css`, accanto alla carta.
  const marks = rules(structure).find((rule) => rule.selectors.some((selector) => /:is\(\.grid-cell/.test(selector)));

  it("ridichiarano l'accento e il velo dalla carta", () => {
    expect(marks, "la regola dei segni sulla carta").toBeDefined();
    expect(marks!.body).toMatch(/--accent:\s*var\(--paper-link, #[0-9a-f]{6}\)/);
    expect(marks!.body).toMatch(/--accent-veil:\s*color-mix\(in srgb, var\(--paper-link, #[0-9a-f]{6}\) 12%, transparent\)/);
    for (const hook of ["grid-cell", "grid-selection", "grid-cell-editor", "grid-object", "grid-comment-mark"]) {
      expect(marks!.selectors[0], hook).toMatch(new RegExp(`\\.${hook}(?![\\w-])`));
    }
  });

  it("solo nella vista della griglia: la scheda di un foglio sulla lavagna tiene l'accento del tema", () => {
    expect(marks!.selectors).toHaveLength(1);
    expect(marks!.selectors[0]!.startsWith(".look-file .grid-viewport :is(")).toBe(true);
    // La scheda ha `look-file` sul fondo del tema: al buio l'accento del tema
    // regge, quello della carta no.
    const sheet = resolve("var(--sheet)", dark);
    expect(contrast(resolve("var(--accent)", dark), sheet)).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve("var(--paper-link, #007249)", dark), sheet)).toBeLessThan(3);
  });

  it("non toccano la riga né le intestazioni, che sono cornice", () => {
    expect(marks!.selectors[0]).not.toMatch(/\.grid-(row|header|corner)(?![\w-])/);
  });

  it("la cella in modifica e il testo di un oggetto hanno il fondo della carta, sotto l'inchiostro della carta", () => {
    for (const hook of ["grid-cell-editor", "grid-object-text-editor"]) {
      expect(declared(editors, `.look-file .${hook}`, "background"), hook).toBe("var(--doc-bg)");
    }
    expect(declared(editors, ".grid-object-text-editor", "color")).toBe("var(--doc-fg)");
    // Sulla carta `--doc-bg` e `--doc-fg` sono quelli della carta: al buio
    // l'inchiostro sul fondo dei pannelli starebbe a 1,1:1.
    const paperBg = resolve(declared(structure, ".look-file .grid-viewport", "--doc-bg")!, dark);
    const paperFg = resolve(declared(structure, ".look-file .grid-viewport", "--doc-fg")!, dark);
    expect(contrast(paperFg, paperBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperFg, resolve("var(--bg-elev)", dark))).toBeLessThan(1.5);
    // Il quadratino del riempimento (motore dei segni) ha il bordo della carta.
    expect(declared(editors, ".grid-mark-handle", "box-shadow")).toBe("0 0 0 1px var(--doc-bg, #ffffff)");
  });
});

describe("le azioni e le pillole", () => {
  it("l'azione di un avviso prende l'inchiostro d'accento più forte", () => {
    expect(declared(drawers, ".conflict-banner .link-button", "color")).toBe("var(--accent-soft)");
    expect(declared(drawers, ".sheet-notice .link-button", "color")).toBe("var(--accent-soft)");
  });

  it("al passaggio l'azione di un avviso cambia ancora colore", () => {
    for (const selector of [".conflict-banner .link-button:hover", ".sheet-notice .link-button:hover"]) {
      expect(declared(drawers, selector, "color"), selector).toBe("var(--accent)");
    }
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
