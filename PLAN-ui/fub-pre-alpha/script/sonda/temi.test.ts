// I temi d'esempio del simulatore (blocchi/93-tema-*.css):
// 1. passano il sanitizer della pelle con i SOLI ganci di oggi (nessun gancio nuovo);
// 2. sopra il foglio di serie, le coppie di contrasto di theme-2 reggono in ogni
//    luce che il tema ha, col contrasto normale e con l'alto.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = process.env.CLIENT!;
const postcss = createRequire(`${CLIENT}/package.json`)("postcss");
const { themeCssViolations } = await import(`${CLIENT}/src/ui/sanitize-css.ts`);
const { THEME_2_CONTRAST_PAIRS, THEME_2_OPTIONAL_PAIRS, THEME_2_PROFILE, THEME_2_VOCABULARY } = await import(
  `${CLIENT}/src/theme/scrittoio/profile.ts`
);
const { CONTENT_GATE } = await import(`${CLIENT}/src/theme/scrittoio/anatomia.ts`);
const { sheet } = await import(`${CLIENT}/src/theme/scrittoio/recipe.ts`);
const { contrast } = await import(`${CLIENT}/src/theme/contrast.ts`);

const dir = fileURLToPath(new URL("../../blocchi", import.meta.url));
const files = readdirSync(dir).filter((f) => /^93-tema-.*\.css$/.test(f)).sort();
const LUCI: Record<string, ("light" | "dark")[]> = {
  "93-tema-carta.css": ["light"],
  "93-tema-mare.css": ["light", "dark"],
  "93-tema-officina.css": ["light", "dark"],
};

const tokensOf = (css: string) =>
  Object.fromEntries(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([_a-zA-Z][_a-zA-Z0-9-]*)\s*:\s*([^;{}]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );

/** I token che il tema dichiara per una luce e un livello, nell'ordine della cascata. */
function themeTokens(css: string, light: string, level: string): Record<string, string> {
  const out: { spec: number; order: number; k: string; v: string }[] = [];
  let order = 0;
  postcss.parse(css).walkRules((rule: { selectors: string[]; walkDecls: (f: (d: { prop: string; value: string }) => void) => void }) => {
    for (const sel of rule.selectors) {
      const s = sel.trim();
      if (!s.startsWith(":root")) continue;
      const theme = /\[data-theme="(\w+)"\]/.exec(s)?.[1];
      const contrastSel = /\[data-contrast="(\w+)"\]/.exec(s)?.[1];
      if (theme && theme !== light) continue;
      if (contrastSel && contrastSel !== level) continue;
      const spec = (theme ? 1 : 0) + (contrastSel ? 1 : 0);
      rule.walkDecls((d) => {
        if (d.prop.startsWith("--")) out.push({ spec, order: order++, k: d.prop.slice(2), v: d.value.trim() });
      });
    }
  });
  out.sort((a, b) => a.spec - b.spec || a.order - b.order);
  return Object.fromEntries(out.map((x) => [x.k, x.v]));
}

describe("i temi d'esempio del simulatore", () => {
  it("ci sono", () => {
    expect(files).toEqual(Object.keys(LUCI).sort());
  });
  for (const f of files) {
    const css = readFileSync(join(dir, f), "utf8");
    it(`${f}: pelle con i soli ganci di oggi`, () => {
      const v = themeCssViolations(css, {
        assetNamespace: "",
        allowedHooks: THEME_2_PROFILE.hooks,
        vocabulary: THEME_2_VOCABULARY,
        gate: CONTENT_GATE,
        requiredRoles: [],
        kind: "skin",
      });
      for (const x of v) {
        process.stderr.write(`${f} ${x.code} ${x.line}:${x.column} ${x.detail} :: ${(css.split("\n")[x.line - 1] ?? "").trim()}\n`);
      }
      expect(v.length).toBe(0);
    });
    for (const light of LUCI[f] ?? []) {
      for (const level of ["normal", "high"] as const) {
        it(`${f}: contrasto, ${light} ${level}`, () => {
          const base = tokensOf(sheet(light, level));
          const tema = themeTokens(css, light, level);
          const t: Record<string, string> = { ...base, ...tema };
          const bad: string[] = [];
          for (const [ink, bg, min, where] of [...THEME_2_CONTRAST_PAIRS, ...THEME_2_OPTIONAL_PAIRS]) {
            const a = t[ink];
            const b = t[bg];
            if (a === undefined || b === undefined) continue;
            // Contano solo le coppie che il tema tocca: le altre sono già della serie.
            if (!(ink in tema) && !(bg in tema)) continue;
            try {
              const r = contrast(a, b);
              if (r < min) bad.push(`--${ink} ${a} su --${bg} ${b}: ${r.toFixed(2)} < ${min} (${where})`);
            } catch (e) {
              bad.push(`--${ink} su --${bg}: ${(e as Error).message}`);
            }
          }
          if (bad.length) process.stderr.write(`${f} ${light} ${level}\n  ` + bad.join("\n  ") + "\n");
          expect(bad).toEqual([]);
        });
      }
    }
  }
});
