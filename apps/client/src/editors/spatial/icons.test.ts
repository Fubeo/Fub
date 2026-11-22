// @vitest-environment happy-dom

// I sorgenti si leggono con `import.meta.glob`, come in `ink/boundary.test.ts`.
import { describe, expect, it } from "vitest";
import { icon } from "../../ui/icons";
import { THEME_ICON_LIMITS } from "../../rules/mirrored";
import { DRAW_ICONS, ensureDrawIcons } from "./icons";
import { TOOLS } from "./tools/registry";

/// Tutti i `.ts` del client, contenuto compreso; le chiavi sono relative a
/// questo file.
const ALL = import.meta.glob(["../../**/*.ts", "!../../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const SPATIAL = Object.entries(ALL).filter(([path]) => path.startsWith("../spatial/") || path.startsWith("./"));

describe("il catalogo delle icone del disegno", () => {
  it("registra ogni figura, con tracciati in una griglia di 24", () => {
    ensureDrawIcons();
    for (const [name, paths] of Object.entries(DRAW_ICONS)) {
      expect(name).toMatch(/^draw-[a-z0-9-]+$/);
      expect(paths.length).toBeGreaterThan(0);
      expect(icon(name)).not.toBe("");
    }
  });

  it("ha la figura di ogni strumento e di ogni nome che il disegno chiama", () => {
    for (const tool of TOOLS) expect(DRAW_ICONS, tool.id).toHaveProperty([tool.icon]);
    const named = new Set<string>();
    for (const [, text] of SPATIAL) {
      for (const match of text.matchAll(/(?:icon:\s*|iconEl\(|icon\()"(draw-[a-z0-9-]+)"/g)) named.add(match[1]!);
    }
    expect(named.size).toBeGreaterThan(20);
    for (const name of named) expect(DRAW_ICONS, name).toHaveProperty([name]);
  });

  it("nessuno registra una figura `draw-` fuori dal catalogo", () => {
    const spatial = new Set(SPATIAL.map(([path]) => path));
    const outside = Object.entries(ALL)
      .filter(([path]) => path !== "./icons.ts" && path !== "../spatial/icons.ts")
      .filter(([path, text]) => /registerIcon\(\s*["'`]draw-/.test(text) || (spatial.has(path) && /registerIcon\(/.test(text)))
      .map(([path]) => path);
    expect(outside).toEqual([]);
  });

  it("le dieci figure di Elaborazione tracciati sono diverse, e ognuna fa vedere la parte che resta", () => {
    const nomi = Object.keys(DRAW_ICONS).filter((nome) => nome.startsWith("draw-pf-"));
    expect(nomi).toHaveLength(10);
    const corpi = new Set(nomi.map((nome) => DRAW_ICONS[nome]!.join("|")));
    expect(corpi.size).toBe(10);
    // Il pieno è un tratteggio a 45°: tanti segmenti `Ma bLc d` con c - a = b - d.
    const pieno = (d: string) =>
      [...d.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].filter(
        ([, a, b, c, e]) => Math.abs(Number(c) - Number(a) - (Number(b) - Number(e))) < 1e-6 && Number(c) > Number(a),
      ).length;
    for (const nome of nomi) {
      const tracciati = DRAW_ICONS[nome]!;
      const righe = Math.max(...tracciati.map(pieno));
      // Contorno lascia solo i bordi: è l'unica senza pieno.
      if (nome === "draw-pf-outline") expect(righe, nome).toBe(0);
      else expect(righe, nome).toBeGreaterThanOrEqual(3);
      // Reggono anche nei limiti di un set del tema, che può ridisegnarle.
      expect(tracciati.length, nome).toBeLessThanOrEqual(THEME_ICON_LIMITS.paths);
      expect(tracciati.join("").length, nome).toBeLessThan(THEME_ICON_LIMITS.icon_bytes);
    }
  });
});
