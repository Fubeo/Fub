// Il CSS nuovo che va in `skin/` passa il sanitizer della pelle di Tema 2?
// I ganci nuovi sono ammessi qui, e il piano li elenca: `anatomia` li deve
// dichiarare nel task del blocco che li usa.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = process.env.CLIENT!;
const { themeCssViolations } = await import(`${CLIENT}/src/ui/sanitize-css.ts`);
const { THEME_2_PROFILE, THEME_2_VOCABULARY } = await import(`${CLIENT}/src/theme/scrittoio/profile.ts`);
const { CONTENT_GATE } = await import(`${CLIENT}/src/theme/scrittoio/anatomia.ts`);

const dir = fileURLToPath(new URL("../../blocchi", import.meta.url));
// Pelle è ciò che va in `skin/`: la struttura (structure.css), il telefono
// (mobile.css) e la serie (series.ts) non passano dal sanitizer nell'app.
const pelle = (f: string) => /^\/\* → [^*]*skin\//.test(readFileSync(join(dir, f), "utf8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".css") && pelle(f)).sort();
const css = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const classes = new Set<string>();
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-z][a-z0-9-]*[a-z0-9])/g)) classes.add(m[1]!);
const known = new Set<string>(THEME_2_PROFILE.hooks);
const nuovi = [...classes].filter((c) => !known.has(c)).sort();

describe("i blocchi della pelle", () => {
  it("passano il sanitizer, con i ganci nuovi dichiarati", () => {
    process.stderr.write(`PELLE: ${files.join(" ")}\nGANCI NUOVI: ${nuovi.join(" ")}\n`);
    const v = themeCssViolations(css, {
      assetNamespace: "",
      allowedHooks: [...THEME_2_PROFILE.hooks, ...nuovi],
      vocabulary: THEME_2_VOCABULARY,
      gate: CONTENT_GATE,
      requiredRoles: [],
      kind: "skin",
    });
    for (const x of v) {
      process.stderr.write(`${x.code} ${x.line}:${x.column} ${x.detail} :: ${(css.split("\n")[x.line - 1] ?? "").trim()}\n`);
    }
    expect(v.length).toBe(0);
  });
});
