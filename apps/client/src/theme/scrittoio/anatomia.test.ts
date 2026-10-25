// L'anatomia della serie Scrittoio, pezzo per pezzo.
//
// Ogni pezzo di pelle ha accanto il suo modulo: le classi che il CSS nomina e
// gli hook che il modulo dichiara devono coincidere nei due versi. Chi aggiunge
// un componente tocca due file suoi; questo presidio dice quale dei due è
// rimasto indietro, e in quale pezzo.
import { describe, expect, it } from "vitest";

import { COMPONENTS, HOOK_LAYERS, HOOKS, hooksOf, LAYER_CONFLICTS, LAYERS, LOOK_HOOKS, PARTS, STATE_NAMES } from "./anatomia";
import { ORDER } from "./skin/order";

const skinParts = import.meta.glob("./skin/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const shellSources = import.meta.glob(["../../**/*.ts", "!../../**/*.test.ts", "../../../index.html"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Attributi scritti dai renderer Rust (HTML reso), non dalla shell.
const RENDERED_ATTRIBUTES = new Set(["embed-url", "embed-path"]);

function partText(part: string): string {
  const text = skinParts[`./skin/${part}.css`];
  if (text === undefined) throw new Error(`manca skin/${part}.css`);
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function classesOf(css: string): string[] {
  // Le classi stanno nei selettori: ciò che precede una graffa aperta. Così un
  // `1.5px` o un `0.4` dentro una dichiarazione non diventa una classe.
  const classes = new Set<string>();
  for (const selector of css.matchAll(/(^|[{}])([^{}]*)\{/g)) {
    for (const match of selector[2]!.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(match[1]!);
  }
  return [...classes].sort();
}

describe("i pezzi della pelle e la loro anatomia", () => {
  it("l'ordine nomina tutti i pezzi che ci sono, e solo quelli", () => {
    const files = Object.keys(skinParts)
      .map((path) => path.replace("./skin/", "").replace(".css", ""))
      .sort();
    expect([...ORDER].sort()).toEqual(files);
    expect(PARTS.map((part) => part.part)).toEqual([...ORDER]);
  });

  for (const part of ORDER) {
    it(`${part}: classi del CSS e hook dichiarati coincidono`, () => {
      expect(classesOf(partText(part))).toEqual([...hooksOf(part)].sort());
    });
  }

  it("l'unione degli hook non ha doppioni", () => {
    expect(new Set(HOOKS).size).toBe(HOOKS.length);
  });

  it("veste soltanto attributi data-* che qualcuno scrive", () => {
    const css = ORDER.map(partText).join("\n");
    const source = Object.values(shellSources).join("\n");
    const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const orphans = [...new Set([...css.matchAll(/\[data-([a-z0-9-]+)/g)].map((m) => m[1]!))]
      .filter((name) => !RENDERED_ATTRIBUTES.has(name))
      .filter((name) =>
        !source.includes(`data-${name}`) && !source.includes(`dataset.${camel(name)}`) &&
        !source.includes(`"${camel(name)}"`)
      );
    expect(orphans).toEqual([]);
  });

  it("ha stati ammessi, e ogni stato ha almeno un componente", () => {
    const names = new Set(COMPONENTS.flatMap((component) => component.states.map((state) => state.name)));
    expect([...names].sort()).toEqual([...STATE_NAMES].sort());
    for (const component of COMPONENTS) {
      expect(component.states.length, component.name).toBeGreaterThan(0);
      expect(new Set(component.states.map((state) => state.name)).size, component.name).toBe(component.states.length);
    }
  });

  it("dentro un pezzo non duplica né svuota componenti", () => {
    for (const part of PARTS) {
      const names = part.components.map((component) => component.name);
      expect(new Set(names).size, part.part).toBe(names.length);
      for (const component of part.components) expect(component.hooks.length, component.name).toBeGreaterThan(0);
    }
  });
});

describe("lo strato di ogni hook", () => {
  it("ogni hook ha uno strato, e uno solo", () => {
    expect(LAYER_CONFLICTS).toEqual([]);
    for (const hook of HOOKS) expect(LAYERS, hook).toContain(HOOK_LAYERS[hook]);
    expect(Object.keys(HOOK_LAYERS).sort()).toEqual([...HOOKS].sort());
  });

  it("i segni di Fub sono segno", () => {
    for (const hook of [
      "rich-proof-spelling", "rich-proof-grammar", "ProseMirror-selectednode",
      "cm-searchMatch", "cm-searchMatch-selected", "cm-cursor", "cm-selectionBackground",
      "grid-comment-mark", "grid-fill-handle", "canvas-node-handle",
    ]) {
      expect(HOOK_LAYERS[hook], hook).toBe("segno");
    }
  });

  it("il contenuto è contenuto, la cornice cornice", () => {
    for (const hook of ["rich-para", "rich-heading", "rich-page", "grid-cell", "cm-line", "markdown-rendered", ...LOOK_HOOKS]) {
      expect(HOOK_LAYERS[hook], hook).toBe("contenuto");
    }
    for (const hook of ["rich-ribbon", "rich-findbar", "grid-ribbon", "grid-header", "pane-editor", "pane-toolbar", "media-surface"]) {
      expect(HOOK_LAYERS[hook], hook).toBe("cornice");
    }
  });
});
