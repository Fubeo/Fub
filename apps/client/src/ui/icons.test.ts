import { describe, expect, it } from "vitest";

import {
  ICON_FILL,
  ICON_GRID,
  ICON_LINECAP,
  ICON_LINEJOIN,
  ICON_SIZE,
  ICON_STROKE,
  ICON_STROKE_WIDTH,
  icon,
  iconNames,
} from "./icons";

function svgParts(name: string): { attrs: string; body: string } {
  const html = icon(name);
  const match = html.match(/^<svg\s+([^>]+)>([\s\S]*)<\/svg>$/);
  expect(match, `icona ${name} non produce un SVG completo`).not.toBeNull();
  return { attrs: match?.[1] ?? "", body: match?.[2] ?? "" };
}

function attr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}=\"([^\"]+)\"`));
  expect(match, `manca l'attributo ${name}`).not.toBeNull();
  return match?.[1] ?? "";
}

/// I sorgenti arrivano dal glob raw di Vite: il test resta eseguibile nella webview
/// e il typecheck non deve dipendere dai tipi Node.
const sources = import.meta.glob("../**/*.{ts,tsx,js,mjs,html,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("il costrutto delle icone", () => {
  it("tutte le icone rispettano griglia e tratto dichiarati", () => {
    const names = iconNames();
    // La roadmap conta ventuno icone nel set (§31.4, misurabile con questo test).
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      const { attrs, body } = svgParts(name);
      expect(attr(attrs, "viewBox")).toBe(`0 0 ${ICON_GRID} ${ICON_GRID}`);
      expect(Number(attr(attrs, "width"))).toBe(ICON_SIZE);
      expect(Number(attr(attrs, "height"))).toBe(ICON_SIZE);
      expect(attr(attrs, "fill")).toBe(ICON_FILL);
      expect(attr(attrs, "stroke")).toBe(ICON_STROKE);
      expect(Number(attr(attrs, "stroke-width"))).toBe(ICON_STROKE_WIDTH);
      expect(attr(attrs, "stroke-linecap")).toBe(ICON_LINECAP);
      expect(attr(attrs, "stroke-linejoin")).toBe(ICON_LINEJOIN);
      expect(body).not.toMatch(/\b(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)=/);

      // Ogni coordinata disegnata resta nella viewBox; i flag numerici degli
      // archi sono anch'essi compresi e rendono il controllo totale sui path.
      for (const token of body.match(/-?(?:\d+\.\d+|\d+)/g) ?? []) {
        const coordinate = Number(token);
        expect(Math.abs(coordinate), `${name}: ${token} esce dalla griglia`).toBeLessThanOrEqual(ICON_GRID);
      }
    }
  });

  it("nessun SVG chrome è dichiarato fuori da icons.ts", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => path !== "./icons.ts" && !path.endsWith("/ui/icons.ts") && !/\.test\./.test(path))
      .filter(([, text]) => /<svg\b/i.test(text))
      .map(([path]) => path);
    expect(offenders, `SVG fuori dal modulo icone: ${offenders.join(", ")}`).toEqual([]);
  });
});
