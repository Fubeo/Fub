// I segni di Fub sul documento (revisioni, ricerca, commenti, correttore)
// prendono i colori della carta su cui stanno, e soltanto quelli.
//
// La carta di ogni aspetto ricollega i ruoli `--doc-*` ai suoi: con la carta
// chiara di notte un segno che leggesse `--accent` o `--danger` scenderebbe a
// 2:1. Il contrasto di ogni ruolo sulla sua carta lo prova la ricetta
// (`THEME_2_OPTIONAL_PAIRS` in `recipe.test.ts`); qui si prova che i segni
// leggono quei ruoli, dalla pelle e non dall'elemento.
import { describe, expect, it } from "vitest";
import editors from "./skin/editors.css?raw";
import { THEME_2_OPTIONAL_PAIRS } from "./profile";

const MARKS = [
  "rich-ins",
  "rich-del",
  "rich-ins-mark",
  "rich-del-mark",
  "rich-find",
  "rich-find-current",
  "rich-comment",
  "rich-proof-spelling",
  "rich-proof-grammar",
];

/// I ruoli che una regola legge, per le regole il cui selettore nomina `hook`.
function rolesOf(css: string, hook: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const roles: string[] = [];
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(",").map((selector) => selector.trim());
    if (!selectors.some((selector) => new RegExp(`\\.${hook}(?![\\w-])`).test(selector))) continue;
    for (const match of rule[2]!.matchAll(/var\(--([\w-]+)/g)) roles.push(match[1]!);
  }
  return roles;
}

describe("i segni del documento", () => {
  const paper = new Set(THEME_2_OPTIONAL_PAIRS.flatMap(([ink, background]) => [ink, background]));

  it.each(MARKS)("%s legge soltanto i ruoli della carta", (hook) => {
    const roles = rolesOf(editors, hook);
    expect(roles.length, hook).toBeGreaterThan(0);
    for (const role of roles) expect(role.startsWith("doc-"), `${hook}: --${role}`).toBe(true);
  });

  it("ogni segno ha il suo ruolo facoltativo, provato dalla ricetta", () => {
    const own: Readonly<Record<string, string>> = {
      "rich-ins": "doc-ins",
      "rich-del": "doc-del",
      "rich-find": "doc-find",
      "rich-find-current": "doc-find-now",
      "rich-comment": "doc-comment",
      "rich-proof-spelling": "doc-proof-spell",
      "rich-proof-grammar": "doc-proof-gram",
    };
    for (const [hook, role] of Object.entries(own)) {
      expect(rolesOf(editors, hook), hook).toContain(role);
      expect(paper.has(role), role).toBe(true);
    }
  });
});
