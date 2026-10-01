// Lo stile dei diagrammi: i nomi, la preferenza e la direttiva `%% stile:`
// che un diagramma porta nel sorgente.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIAGRAM_STYLE,
  DIAGRAM_STYLE_SETTING,
  diagramStyleNamed,
  diagramStyleOf,
  diagramStylePreference,
  onDiagramStyleChange,
  ownDiagramStyle,
  setDiagramStylePreference,
  styleDirective,
  styleDirectiveEdit,
  type SourceEdit,
} from "./diagram-style";
import { DIAGRAM_STYLE_KEY } from "./theme";

function apply(source: string, edit: SourceEdit | null): string {
  return edit ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to) : source;
}

describe("i nomi degli stili", () => {
  it("riconosce id e alias inglesi, senza badare a maiuscole", () => {
    expect(diagramStyleNamed("Aurora")).toBe("aurora");
    expect(diagramStyleNamed(" INK ")).toBe("inchiostro");
    expect(diagramStyleNamed("watercolour")).toBe("acquerello");
    expect(diagramStyleNamed("harmony")).toBe("armonia");
    expect(diagramStyleNamed("neon")).toBeNull();
  });

  it("un valore sconosciuto dell'impostazione è il predefinito", () => {
    expect(diagramStyleOf("blueprint")).toBe("blueprint");
    expect(diagramStyleOf("neon")).toBe(DEFAULT_DIAGRAM_STYLE);
    expect(diagramStyleOf(3)).toBe(DEFAULT_DIAGRAM_STYLE);
    expect(diagramStyleOf(undefined)).toBe(DEFAULT_DIAGRAM_STYLE);
  });

  it("chi scrive l'impostazione usa la chiave che il tema rilegge", () => {
    expect(DIAGRAM_STYLE_SETTING).toBe(DIAGRAM_STYLE_KEY);
  });
});

describe("la preferenza", () => {
  it("avvisa soltanto quando cambia, e il disposer ritira l'ascolto", () => {
    setDiagramStylePreference(undefined);
    let calls = 0;
    const stop = onDiagramStyleChange(() => calls++);
    try {
      setDiagramStylePreference("aurora");
      setDiagramStylePreference("aurora");
      expect(diagramStylePreference()).toBe("aurora");
      expect(calls).toBe(1);
      setDiagramStylePreference("neon");
      expect(diagramStylePreference()).toBe(DEFAULT_DIAGRAM_STYLE);
      expect(calls).toBe(2);
    } finally {
      stop();
    }
    setDiagramStylePreference("inchiostro");
    expect(calls).toBe(2);
    setDiagramStylePreference(undefined);
  });
});

describe("la direttiva nel sorgente", () => {
  it("legge la prima riga `%% stile:` o `%% style:`, dovunque sia", () => {
    expect(ownDiagramStyle("%% stile: aurora\nflowchart LR\nA-->B")).toBe("aurora");
    expect(ownDiagramStyle("flowchart LR\n  %%   Style :  Ink  \nA-->B")).toBe("inchiostro");
    expect(ownDiagramStyle("%% stile: aurora\r\nflowchart LR")).toBe("aurora");
    expect(ownDiagramStyle("flowchart LR\nA-->B")).toBeNull();
    // Un nome che non è uno stile non vale, ma la riga resta una direttiva.
    expect(styleDirective("%% stile: neon\nflowchart LR")).toEqual({ style: null, from: 0, to: 14 });
    // `%%{…}%%` è di Mermaid, e un commento qualsiasi non è una direttiva.
    expect(ownDiagramStyle("%%{init: {'theme': 'forest'}}%%\nflowchart LR")).toBeNull();
    expect(ownDiagramStyle("%% lo stile: aurora mi piace\nflowchart LR")).toBeNull();
  });

  it("scrive la direttiva in cima, la riscrive al suo posto e la toglie con l'a capo", () => {
    const plain = "flowchart LR\nA-->B";
    const styled = apply(plain, styleDirectiveEdit(plain, "blueprint"));
    expect(styled).toBe("%% stile: blueprint\nflowchart LR\nA-->B");
    expect(ownDiagramStyle(styled)).toBe("blueprint");
    const moved = "flowchart LR\n%% style: ink\nA-->B";
    expect(apply(moved, styleDirectiveEdit(moved, "aurora"))).toBe("flowchart LR\n%% stile: aurora\nA-->B");
    expect(apply(styled, styleDirectiveEdit(styled, null))).toBe(plain);
    expect(apply("%% stile: aurora", styleDirectiveEdit("%% stile: aurora", null))).toBe("");
  });

  it("non propone modifiche che non cambiano niente", () => {
    expect(styleDirectiveEdit("flowchart LR", null)).toBeNull();
    expect(styleDirectiveEdit("%% stile: aurora\nflowchart LR", "aurora")).toBeNull();
    // Un alias è lo stesso stile: resta com'è scritto.
    expect(styleDirectiveEdit("%% style: ink\nflowchart LR", "inchiostro")).toBeNull();
  });
});
