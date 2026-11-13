// La mappa dei colori dal blu di prima (matita blu, 265) al verde di serie
// (smeraldo, 160, D25), per le catture che non si possono rifare dal client
// verde: le pagine dei piani (cattura-piani.mjs con VERDE=) e le due catture
// della lavagna di prima di N6 (verde-lavagna.mjs).
//
// Legge il foglio della serie (`fub:foglio`, generato dalla ricetta) di una
// cattura blu e della stessa cattura verde, nelle due luci, e scrive per ogni
// gettone che cambia: il vecchio valore → il nuovo. Le pagine dei piani hanno
// copiato i valori del foglio blu (il loro foglio «Token»), quindi lo stesso
// valore si ritrova tale e quale nel loro CSS.
//
// node verde-mappa.mjs <cattura blu, senza -luce.json> <cattura verde, idem> <uscita.json>
// es.: node verde-mappa.mjs ../catture/s2/nota ../catture-r/s2/nota finto/verde-mappa.json
import { readFileSync, writeFileSync } from "node:fs";

const [blu, verde, out] = process.argv.slice(2);
if (!out) throw new Error("uso: node verde-mappa.mjs <blu> <verde> <uscita.json>");

const gettoni = (testo) => {
  const m = new Map();
  for (const x of testo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) if (!m.has(x[1])) m.set(x[1], x[2].trim());
  return m;
};
const foglio = (f) => {
  const s = JSON.parse(readFileSync(f, "utf8")).css.find((c) => c.label === "fub:foglio");
  if (!s) throw new Error(`${f}: manca il foglio fub:foglio`);
  return gettoni(s.text);
};
const hexTerna = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
const rgbTerna = (v) => /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v)?.slice(1, 4).join(" ");
const terna = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? hexTerna(v.toLowerCase()) : rgbTerna(v));

// Prima i gettoni che si vedono di più: se lo stesso valore vecchio va in due
// valori nuovi (succede per differenze di un'unità), vince il primo.
const PRIMA = ["--accent", "--focus-ring", "--bg", "--sheet", "--text", "--border", "--muted", "--doc-", "--paper-"];
const peso = (k) => {
  const i = PRIMA.findIndex((p) => k === p || (p.endsWith("-") && k.startsWith(p)) || k.startsWith(p + "-"));
  return i < 0 ? PRIMA.length : i;
};

const hex = {};
const terne = {};
const conflitti = [];
const metti = (tab, da, a, k) => {
  if (da === a) return;
  if (tab[da] && tab[da].a !== a) {
    conflitti.push(`${da}: ${tab[da].a} (${tab[da].k}) e ${a} (${k})`);
    if (peso(k) >= peso(tab[da].k)) return;
  }
  tab[da] = { a, k };
};
for (const luce of ["light", "dark"]) {
  const b = foglio(`${blu}-${luce}.json`);
  const v = foglio(`${verde}-${luce}.json`);
  for (const [k, vb] of b) {
    const vv = v.get(k);
    if (!vv || vv === vb) continue;
    if (/^#[0-9a-f]{6}$/i.test(vb) && /^#[0-9a-f]{6}$/i.test(vv)) metti(hex, vb.toLowerCase(), vv.toLowerCase(), `${k} ${luce}`);
    const tb = terna(vb);
    const tv = terna(vv);
    if (tb && tv) metti(terne, tb, tv, `${k} ${luce}`);
  }
}
const piatta = (tab) => Object.fromEntries(Object.entries(tab).map(([k, { a }]) => [k, a]));
writeFileSync(
  out,
  `${JSON.stringify({ nota: "Generata da script/verde-mappa.mjs: il blu di prima (265) → il verde di serie (160, D25). Non si modifica a mano.", hex: piatta(hex), terne: piatta(terne) }, null, 1)}\n`,
);
console.log(`hex ${Object.keys(hex).length}, terne ${Object.keys(terne).length}, conflitti ${conflitti.length}`);
for (const c of conflitti) console.log(`  ${c}`);
