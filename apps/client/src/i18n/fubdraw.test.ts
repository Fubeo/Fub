// Il nome «FubDraw» non arriva a chi usa Fub (PA T33, D14).
//
// FubDraw è il nome tecnico del formato dei disegni (ADR 0203): resta nel
// namespace `fub:`, negli id, nello stato `fubdraw` e in `fubdraw://live`. Chi
// legge un avviso, un'etichetta o una diagnosi sente parlare di Fub, o del
// disegno. Questo test guarda i testi che una persona vede: il catalogo della
// shell, ogni catalogo di un editor (i moduli `strings.ts` che espongono
// `catalogFor`), i messaggi della diagnostica dei disegni e i rifiuti del
// motore della scena, che arrivano alla shell e a MCP. I descrittori dei
// formati sono Rust, e la loro guardia sta in `fub-format-svg/tests/model.rs`.
import { describe, expect, it } from "vitest";
import { CODE_MESSAGES } from "../editors/spatial/scene/diagnostics";
import engineSource from "../editors/spatial/scene/engine.ts?raw";
import { catalogFor } from "./strings";

const NAME = "FubDraw";
const LANGUAGES = ["it", "en"] as const;

/// Le voci di un catalogo che nominano FubDraw, come `chiave: testo`.
function naming(table: Readonly<Record<string, string>>): string[] {
  return Object.entries(table)
    .filter(([, text]) => text.includes(NAME))
    .map(([key, text]) => `${key}: ${text}`);
}

interface WithCatalog {
  catalogFor(language: string): Readonly<Record<string, string>>;
}

function isCatalog(value: unknown): value is WithCatalog {
  return typeof value === "object" && value !== null && typeof (value as Partial<WithCatalog>).catalogFor === "function";
}

const modules = import.meta.glob<Record<string, unknown>>("../**/strings.ts", { eager: true });

describe("il nome FubDraw", () => {
  it("non è nel catalogo della shell, in nessuna lingua", () => {
    for (const language of LANGUAGES) {
      expect(naming(catalogFor(language)), language).toEqual([]);
    }
  });

  it("non è nei cataloghi degli editor, in nessuna lingua", () => {
    const catalogs = Object.entries(modules).flatMap(([path, exports]) =>
      Object.entries(exports)
        .filter((entry): entry is [string, WithCatalog] => isCatalog(entry[1]))
        .map(([name, catalog]) => [`${path}#${name}`, catalog] as const),
    );
    // Il disegno e l'import hanno i loro: se il glob non li trovasse, la
    // guardia non guarderebbe niente.
    const paths = catalogs.map(([where]) => where);
    expect(paths).toContain("../editors/spatial/strings.ts#drawStrings");
    expect(paths).toContain("../editors/spatial/import/strings.ts#importStrings");
    for (const [where, catalog] of catalogs) {
      for (const language of LANGUAGES) {
        expect(naming(catalog.catalogFor(language)), `${where} (${language})`).toEqual([]);
      }
    }
  });

  it("non è nei messaggi della diagnostica dei disegni", () => {
    expect(naming(CODE_MESSAGES)).toEqual([]);
  });

  it("non è nei rifiuti del motore della scena", () => {
    const rejects = engineSource.split("\n").filter((line) => /\breject\(/.test(line) && line.includes(NAME));
    expect(rejects).toEqual([]);
  });
});
