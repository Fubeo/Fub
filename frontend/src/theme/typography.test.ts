// Presidio della scala tipografica: ogni voce dichiarata dal foglio deve arrivare
// a una superficie vera, senza una seconda misura nascosta nell'editor.
import { describe, expect, it } from "vitest";
import dark from "./serie/sheet-dark.css?raw";
import light from "./serie/sheet-light.css?raw";
import preview from "./serie/skin/preview.css?raw";
import editorTheme from "../editor/theme.ts?raw";

const TYPOGRAPHY = {
  "font-reading": '"Literata Variable", Georgia, "Times New Roman", serif',
  "text-2xl": "19px",
  "text-3xl": "23px",
  "text-reading": "16px",
  "leading-tight": "1.35",
  "leading-normal": "1.5",
  "leading-relaxed": "1.7",
  "content-width": "70ch",
} as const;

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function tokens(css: string): Record<string, string> {
  return Object.fromEntries(
    [...withoutComments(css).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

describe("il vocabolario tipografico è gemello nelle due luci", () => {
  it("dichiara ogni valore previsto senza divergenze", () => {
    const darkTokens = tokens(dark);
    const lightTokens = tokens(light);
    expect(
      Object.keys(TYPOGRAPHY).filter(
        (name) =>
          darkTokens[name] !== TYPOGRAPHY[name as keyof typeof TYPOGRAPHY] ||
          lightTokens[name] !== TYPOGRAPHY[name as keyof typeof TYPOGRAPHY] ||
          darkTokens[name] !== lightTokens[name],
      ),
    ).toEqual([]);
  });
});

describe("la scala tipografica è consumata", () => {
  it("ogni token appare in almeno una regola reale dell'app", () => {
    const rules = `${withoutComments(preview)}\n${withoutComments(editorTheme)}`;
    expect(Object.keys(TYPOGRAPHY).filter((name) => !rules.includes(`var(--${name})`))).toEqual([]);
  });
});
