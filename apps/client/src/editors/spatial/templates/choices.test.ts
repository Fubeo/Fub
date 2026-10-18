// Le scelte della galleria, senza DOM: le schede dalla spec del comando, gli
// argomenti che il comando riceve, che cosa si ricorda e che cosa se ne rilegge.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, VaultEntry } from "../../../host/contract";
import { drawingCreateSpec } from "../../../host/fake";
import {
  BLANK,
  FIRST,
  cardsOf,
  createArgs,
  isTemplateId,
  memoryOf,
  offersVault,
  previewLanguage,
  selectionFrom,
  templatesFolder,
  vaultDrawings,
} from "./choices";
import { TEMPLATE_IDS } from "./content";

afterEach(() => {
  vi.restoreAllMocks();
});

const entry = (id: string): VaultEntry => ({ id, kind: "document", size: 0, mtime: 0, fingerprint: null });

describe("le schede", () => {
  it("sono le scelte del comando, nel suo ordine e coi suoi titoli", () => {
    const cards = cardsOf(drawingCreateSpec(), "it");
    expect(cards.map((card) => card.id)).toEqual([BLANK, ...TEMPLATE_IDS]);
    expect(cards.map((card) => card.title)).toEqual([
      "Vuoto",
      "A4 verticale",
      "A4 orizzontale",
      "Diapositiva 16:9",
      "Diagramma di flusso",
      "Lavagna per la lezione",
      "Storyboard",
      "Mappa concettuale",
    ]);
  });

  it("«Vuoto» non ha un file; ogni altro modello conosciuto sì, e ha la sua riga", () => {
    const cards = cardsOf(drawingCreateSpec(), "it");
    expect(cards[0]).toMatchObject({ id: "blank", file: null });
    expect(cards[0]!.note).not.toBeNull();
    for (const card of cards.slice(1)) {
      expect(card.file, card.id).toBe(card.id);
      expect(card.note, card.id).not.toBeNull();
    }
  });

  it("un modello sconosciuto resta, senza file e senza riga", () => {
    const spec = drawingCreateSpec();
    const custom: CommandSpec = {
      ...spec,
      params: spec.params.map((param) =>
        param.name === "template" ? { ...param, kind: { kind: "choice", value: [{ value: "poster", title: "Manifesto" }] } } : param,
      ),
    };
    expect(cardsOf(custom, "it")).toEqual([{ id: "poster", title: "Manifesto", file: null, note: null }]);
  });

  it("un titolo vuoto ricade sul nome che questa versione conosce, nella lingua", () => {
    const spec = drawingCreateSpec();
    const empty: CommandSpec = {
      ...spec,
      params: spec.params.map((param) =>
        param.name === "template"
          ? { ...param, kind: { kind: "choice", value: [{ value: "blank", title: "" }, { value: "slide", title: " " }] } }
          : param,
      ),
    };
    expect(cardsOf(empty, "it").map((card) => card.title)).toEqual(["Vuoto", "Diapositiva 16:9"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    expect(cardsOf(empty, "en").map((card) => card.title)).toEqual(["Blank", "16:9 slide"]);
  });

  it("senza spec sono gli otto modelli; senza il parametro, il solo «Vuoto»", () => {
    expect(cardsOf(undefined, "en").map((card) => card.id)).toEqual([BLANK, ...TEMPLATE_IDS]);
    expect(cardsOf(undefined, "en")[3]!.title).toBe("16:9 slide");
    const spec = drawingCreateSpec();
    expect(cardsOf({ ...spec, params: [] }, "it").map((card) => card.id)).toEqual([BLANK]);
  });

  it("riconosce i modelli che hanno un file", () => {
    expect(isTemplateId("slide")).toBe(true);
    expect(isTemplateId("blank")).toBe(false);
    expect(isTemplateId("poster")).toBe(false);
  });
});

describe("«Dal vault» e la lingua", () => {
  it("si offre se il comando ha `from`, o se la spec non c'è", () => {
    expect(offersVault(drawingCreateSpec())).toBe(true);
    expect(offersVault(undefined)).toBe(true);
    expect(offersVault({ ...drawingCreateSpec(), params: [] })).toBe(false);
  });

  it("la cartella dei modelli viene dall'impostazione, ripulita", () => {
    expect(templatesFolder("Modelli")).toBe("Modelli");
    expect(templatesFolder(" /Modelli/Scuola/ ")).toBe("Modelli/Scuola");
    expect(templatesFolder("")).toBe("");
    expect(templatesFolder(undefined)).toBe("Templates");
    expect(templatesFolder(42)).toBe("Templates");
  });

  it("i disegni sono i `.svg` direttamente nella cartella, per nome", () => {
    const entries = [
      entry("Templates/zeta.svg"),
      entry("Templates/Atomo.SVG"),
      entry("Templates/nota.md"),
      entry("Templates/Sotto/Dentro.svg"),
      entry("Templatesx/Altro.svg"),
      entry("Fuori.svg"),
    ];
    expect(vaultDrawings(entries, "Templates")).toEqual([
      { path: "Templates/Atomo.SVG", name: "Atomo" },
      { path: "Templates/zeta.svg", name: "zeta" },
    ]);
    expect(vaultDrawings(entries, "").map((drawing) => drawing.path)).toEqual(["Fuori.svg"]);
  });

  it("la lingua delle anteprime è l'inglese per l'interfaccia in inglese, l'italiano per ogni altra", () => {
    const language = vi.spyOn(navigator, "language", "get");
    language.mockReturnValue("en-US");
    expect(previewLanguage()).toBe("en");
    language.mockReturnValue("it-IT");
    expect(previewLanguage()).toBe("it");
    language.mockReturnValue("de-DE");
    expect(previewLanguage()).toBe("it");
  });
});

describe("gli argomenti del comando", () => {
  it("sono soltanto ciò che si è riempito, senza spazi ai bordi", () => {
    expect(createArgs("", "", FIRST)).toEqual({});
    expect(createArgs("  Atomo ", " Lezioni ", { kind: "template", id: "slide" })).toEqual({ name: "Atomo", folder: "Lezioni", template: "slide" });
    expect(createArgs("   ", "", { kind: "template", id: "diagram" })).toEqual({ template: "diagram" });
  });

  it("un disegno del vault è `from`, e mai `template`", () => {
    expect(createArgs("Copia", "", { kind: "from", path: "Templates/Atomo.svg" })).toEqual({ name: "Copia", from: "Templates/Atomo.svg" });
  });
});

describe("la memoria", () => {
  const cards = cardsOf(drawingCreateSpec(), "it");
  const drawings = [{ path: "Templates/Atomo.svg", name: "Atomo" }];

  it("scrive un modello come il suo id e un disegno come `from:` e il percorso", () => {
    expect(memoryOf({ kind: "template", id: "slide" })).toBe("slide");
    expect(memoryOf({ kind: "from", path: "Templates/Atomo.svg" })).toBe("from:Templates/Atomo.svg");
  });

  it("rilegge ciò che c'è ancora", () => {
    expect(selectionFrom("storyboard", cards, drawings)).toEqual({ kind: "template", id: "storyboard" });
    expect(selectionFrom("from:Templates/Atomo.svg", cards, drawings)).toEqual({ kind: "from", path: "Templates/Atomo.svg" });
  });

  it("per il resto torna «Vuoto»", () => {
    for (const memory of [null, undefined, 3, {}, "", "poster", "from:Templates/Sparito.svg", "from:"]) {
      expect(selectionFrom(memory, cards, drawings), JSON.stringify(memory)).toEqual(FIRST);
    }
  });
});
