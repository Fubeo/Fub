// Presidio della scala tipografica: ogni voce dichiarata dal foglio deve arrivare
// a una superficie vera, senza una seconda misura nascosta nell'editor.
import { describe, expect, it } from "vitest";
import dark from "./scrittoio/sheet-dark.css?raw";
import light from "./scrittoio/sheet-light.css?raw";
import skin from "./scrittoio/skin.css?raw";
import editorTheme from "../editors/text/theme.ts?raw";

/// Il ritmo del documento dello Scrittoio: Newsreader, corpo 17, interlinea
/// 1,65, giustezza 68 caratteri.
const TYPOGRAPHY = {
  "font-reading": '"Newsreader Variable", Georgia, "Times New Roman", serif',
  "text-2xl": "19px",
  "text-3xl": "23px",
  "text-reading": "17px",
  "leading-tight": "1.3",
  "leading-normal": "1.45",
  "leading-relaxed": "1.65",
  "content-width": "68ch",
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
    const rules = `${withoutComments(skin)}\n${withoutComments(editorTheme)}`;
    expect(Object.keys(TYPOGRAPHY).filter((name) => !rules.includes(`var(--${name})`))).toEqual([]);
  });
});
