// Ogni modalità dichiara l'aspetto del suo contenuto (`SurfaceMode.looks`).
//
// Una modalità che non dichiara niente vale `tema`, cioè ciò che succedeva
// prima che gli aspetti esistessero; per le superfici che hanno un aspetto loro
// — il documento, il foglio di calcolo — è proprio ciò che non va. L'elenco qui
// sotto è quello delle modalità che non hanno ancora dichiarato: può solo
// accorciarsi, e quando è vuoto il campo diventa obbligatorio.
//
// I sorgenti si leggono con `import.meta.glob`, come in `ink/boundary.test.ts`.
import { describe, expect, it } from "vitest";
import { LOOKS } from "../../theme/content-look";

const sources = import.meta.glob(["../**/*.ts", "!../**/*.test.ts", "!../**/test-support.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Le modalità senza aspetto, come `file#id`: il foglio di calcolo aspetta N8.
const UNDECLARED = new Set(["core/bootstrap.ts#sheet"]);

/// Una modalità come si scrive: `{ id: "…", label: …, contextMode: … }` su una
/// riga, con o senza `looks`.
const MODE = /\{\s*id:\s*"([^"]+)",\s*label:[^\n]*?contextMode:[^\n]*?\}/g;
const DECLARED = /looks:\s*\[([^\]]*)\]/;

function modes(): { key: string; looks: string[] | null }[] {
  const found: { key: string; looks: string[] | null }[] = [];
  for (const [path, text] of Object.entries(sources)) {
    for (const match of text.matchAll(MODE)) {
      const declared = DECLARED.exec(match[0]);
      found.push({
        key: `${path.replace(/^\.\.\//, "").replace(/^\.\//, "core/")}#${match[1]}`,
        looks: declared ? declared[1]!.split(",").map((look) => look.trim().replace(/^"|"$/g, "")).filter(Boolean) : null,
      });
    }
  }
  return found;
}

describe("gli aspetti delle modalità", () => {
  const all = modes();

  it("le modalità ci sono, e si leggono", () => {
    expect(all.length).toBeGreaterThan(15);
    expect(all.map((mode) => mode.key)).toContain("text/profiles/markdown/surface.ts#live_preview");
  });

  it("ogni modalità dichiara i suoi aspetti, tranne quelle dell'elenco", () => {
    const missing = all.filter((mode) => mode.looks === null).map((mode) => mode.key);
    expect(missing.sort()).toEqual([...UNDECLARED].sort());
  });

  it("gli aspetti dichiarati sono aspetti, senza doppioni", () => {
    for (const mode of all) {
      if (!mode.looks) continue;
      expect(mode.looks.length, mode.key).toBeGreaterThan(0);
      expect(new Set(mode.looks).size, mode.key).toBe(mode.looks.length);
      for (const look of mode.looks) expect(LOOKS, mode.key).toContain(look);
    }
  });

  it("le superfici di oggi dichiarano la regola di oggi", () => {
    const of = (key: string) => all.find((mode) => mode.key === key)?.looks;
    expect(of("text/profiles/markdown/surface.ts#reading")).toEqual(["tema"]);
    expect(of("text/profiles/svg.ts#source")).toEqual(["tema"]);
    expect(of("text/profiles/svg.ts#reading")).toEqual(["file"]);
    expect(of("canvas/surface.ts#canvas")).toEqual(["tema"]);
    expect(of("spatial/modes.ts#draw")).toEqual(["file"]);
    expect(of("media/media-surface.ts#view")).toEqual(["file"]);
    expect(of("base/data.ts#base")).toEqual(["tema"]);
    expect(of("rich/surface.ts#document")).toEqual(["file", "adattato"]);
    expect(of("rich/surface.ts#writing")).toEqual(["tema"]);
    expect(of("rich/surface.ts#reading")).toEqual(["file", "adattato"]);
  });
});
