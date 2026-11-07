// Le due catture della lavagna di prima di N6 (`s2/lavagna`, `s2/lavagna-700`)
// non hanno una definizione per rifarle (Differenze 40). Col verde di serie
// (D25) si portano al verde senza rifarle: il foglio della serie
// (`fub:foglio`) diventa quello della stessa luce di una cattura verde della
// stessa misura, e il marchio della barra diventa il logo (D26)
// come nelle catture verdi. Il resto del CSS col verde non cambia
// (verde-mappa.mjs lo dice: cambia solo `fub:foglio`). La foto PNG resta
// quella blu di prima: il confronto dei pixel lo spiega («I pixel contro la
// fonte»).
//
// node verde-lavagna.mjs <catture blu> <catture verdi>
// es.: node verde-lavagna.mjs ../catture/s2 ../catture-r/s2
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [blu, verde] = process.argv.slice(2);
if (!verde) throw new Error("uso: node verde-lavagna.mjs <catture blu> <catture verdi>");
const COPPIE = [["lavagna", "nota"], ["lavagna-700", "nota-700"]];
const GLIFO = '<span class="brand-glyph" aria-hidden="true">f</span>';
const leggi = (f) => JSON.parse(readFileSync(f, "utf8"));
const foglio = (j) => j.css.find((c) => c.label === "fub:foglio");
const logo = (body) => {
  const i = body.indexOf('<svg class="brand-logo');
  const k = body.indexOf("</svg>", i);
  if (i < 0 || k < 0) throw new Error("la cattura verde non ha il logo nel marchio");
  return body.slice(i, k + 6);
};

for (const [id, rif] of COPPIE) {
  for (const luce of ["light", "dark"]) {
    const c = leggi(join(blu, `${id}-${luce}.json`));
    const b = leggi(join(blu, `${rif}-${luce}.json`));
    const v = leggi(join(verde, `${rif}-${luce}.json`));
    // Il foglio blu della lavagna deve essere lo stesso della cattura di
    // riferimento: stessa luce, stesso contrasto, stessa densità.
    if (foglio(c).text !== foglio(b).text) throw new Error(`${id} ${luce}: il foglio non è quello di ${rif}`);
    foglio(c).text = foglio(v).text;
    // Il marchio di prima: la «f» blu, o un logo già messo da un giro
    // precedente (che si sostituisce col logo di oggi).
    const n = c.body.split(GLIFO).length - 1;
    const prima = n === 0 && c.body.includes('<svg class="brand-logo') ? logo(c.body) : null;
    if (n !== 1 && !prima) throw new Error(`${id} ${luce}: ${n} marchi «f» invece di uno, e nessun logo`);
    c.body = c.body.replace(prima ?? GLIFO, logo(v.body));
    writeFileSync(join(verde, `${id}-${luce}.json`), JSON.stringify(c));
    console.log(`ok ${id} ${luce}`);
  }
}
