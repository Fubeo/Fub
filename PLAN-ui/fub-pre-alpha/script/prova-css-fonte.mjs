// Una fonte sola per il CSS di Scrittoio 2: ogni blocco del simulatore che
// viene da Scrittoio 2 (posto «struttura», «pelle», «telefono», «serie») deve
// coincidere con il blocco della stessa destinazione nel prototipo approvato
// (`PLAN-ui/scrittoio-2.html` del ramo `piano/scrittoio-2`), tolte le varianti
// «com'era», i commenti e gli spazi. Esce con 1 alla prima differenza.
// node prova-css-fonte.mjs <scrittoio-2.html> <simulatore.html>
//   git show origin/piano/scrittoio-2:PLAN-ui/scrittoio-2.html > /un/file.html
import { readFileSync } from "node:fs";
const [protoFile, simFile] = process.argv.slice(2);
const VAR = /\/\*\s*variante ([\w-]+)\s*\*\/([\s\S]*?)\/\*\s*fine variante \1\s*\*\//g;
const POSTI = new Set(["struttura", "pelle", "telefono", "serie"]);
function blocchi(html) {
  const m = new Map();
  for (const [, attr, css] of html.matchAll(/<style([^>]*data-destinazione="[^"]*"[^>]*)>([\s\S]*?)<\/style>/g)) {
    const dest = attr.match(/data-destinazione="([^"]*)"/)[1];
    const posto = attr.match(/data-posto="([^"]*)"/)?.[1];
    if (!POSTI.has(posto)) continue;
    m.set(`${posto} ${dest}`, (m.get(`${posto} ${dest}`) ?? "") + css);
  }
  return m;
}
const norma = (css) =>
  css
    .replace(VAR, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,>])\s*/g, "$1")
    .trim();
const proto = blocchi(readFileSync(protoFile, "utf8"));
const sim = blocchi(readFileSync(simFile, "utf8"));
let falli = 0;
for (const [k, css] of proto) {
  const a = norma(css);
  const b = sim.has(k) ? norma(sim.get(k)) : null;
  if (b === null) {
    console.log(`NO   ${k}: nel simulatore non c'è`);
    falli++;
  } else if (a !== b) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(`NO   ${k}: diverso dal carattere ${i}\n     prototipo: …${a.slice(Math.max(0, i - 60), i + 80)}\n     simulatore: …${b.slice(Math.max(0, i - 60), i + 80)}`);
    falli++;
  } else console.log(`ok   ${k} (${(a.length / 1024).toFixed(1)} KB)`);
}
for (const k of sim.keys()) if (!proto.has(k)) (console.log(`NO   ${k}: nel prototipo non c'è`), falli++);
console.log(falli ? `${falli} blocchi diversi` : `tutti uguali: ${proto.size} blocchi`);
process.exit(falli ? 1 : 0);
