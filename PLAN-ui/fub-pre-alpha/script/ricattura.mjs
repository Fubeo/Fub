// Rifà le catture che il simulatore usa, col CSS nuovo di oggi (blocchi/*.css)
// e coi mods di oggi, in una cartella a parte: catture-r/<cartella>/.
// Serve perché una cattura presa prima di un cambio dei blocchi ha la foto col
// CSS di allora, mentre il simulatore monta il CSS di oggi: la foto e il
// simulatore non coincidono più e il confronto dei pixel non dice nulla.
// Per ogni cartella usa i file stati-*.json che l'hanno riempita (l'ultimo che
// definisce l'id vince, come quando si giravano a mano) e solo gli id che
// vincono da quella cartella (l'ordine di CARTELLE in elenco-sim.mjs).
// node ricattura.mjs <client> [cartelle=giro2,s2] [solo=id,id] [secco=1]
// Poi: confronta catture-r con catture (stesse misure), e scambia le cartelle.
//
// Dal repository, senza la cartella catture/ (su un'altra macchina): quali
// catture ci sono lo dicono i dati impacchettati, DATI=<cartella con
// sim-dati-N.js>, e ogni id va alla prima cartella di CARTELLE che lo
// definisce. Poi le catture nuove entrano con
//   DATI=… RIFATTE=catture-r/<cartella> node costruisci-sim.mjs <out>
// `secco=1` dice solo cosa catturerebbe, senza aprire il client.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root, indiceCatture, CARTELLE } from "./elenco-sim.mjs";
import { datiDi } from "./dati-sim.mjs";

const [client, ...resto] = process.argv.slice(2);
const opz = Object.fromEntries(resto.map((a) => a.split("=")));
const scelte = opz.cartelle ? new Set(opz.cartelle.split(",")) : null;
const solo = opz.solo ? new Set(opz.solo.split(",")) : null;
const secco = opz.secco === "1";

// Quale file di stati ha riempito quale cartella (i log in catture/*.log).
const DA = {
  avvio: ["stati-avvio.json"],
  giro2: ["stati-giro2.json", "stati-giro2b.json", "stati-giro2c.json"],
  giro3: ["stati-giro3.json"],
  giro4: ["stati-giro4.json"],
  tel: ["stati-tel.json"],
  nuove: ["stati-prealpha.json"],
  nuove2: ["stati-prealpha-2.json"],
  nuove3: ["stati-prealpha-3.json"],
  nuove4: ["stati-prealpha-4.json"],
  nuove5: ["stati-prealpha-5.json"],
  nuove6: ["stati-prealpha-6.json", "stati-prealpha-6b.json"],
  s2: ["stati-tutti.json"],
  // Le pagine dei piani approvate: cattura-piani.mjs, da file:// e senza client.
  piani: ["piani-giro2.json"],
};
// Le pagine approvate da cui si fotografano gli stati p-*: quelle del ramo
// (piani/ accanto a script/), o PROTO.
const PAGINE = process.env.PROTO ?? join(root, "piani");

const definizioni = new Map();
for (const c of CARTELLE) {
  const def = new Map();
  for (const f of DA[c] ?? []) for (const s of JSON.parse(readFileSync(join(root, "script", f), "utf8"))) def.set(s.id, s);
  definizioni.set(c, def);
}

// id → cartella da cui la cattura vince.
const vinci = new Map();
if (process.env.DATI) {
  const prima = await datiDi(process.env.DATI);
  for (const k of Object.keys(prima.caps)) {
    const id = k.replace(/-(light|dark)$/, "");
    if (vinci.has(id)) continue;
    const c = CARTELLE.find((c) => definizioni.get(c).has(id));
    vinci.set(id, c ?? "?");
  }
} else {
  if (!existsSync(join(root, "catture"))) throw new Error("manca catture/: dal repository passa DATI=<cartella con sim-dati-N.js>");
  for (const [k, p] of indiceCatture()) {
    const id = k.replace(/-(light|dark)$/, "");
    if (vinci.has(id)) continue;
    vinci.set(id, CARTELLE.find((c) => p.startsWith(join(root, "catture", c) + "/")));
  }
}

const tmp = join(root, "catture-r", "_stati");
if (!secco) mkdirSync(tmp, { recursive: true });
const mancano = [];
for (const [id, c] of vinci) if (!DA[c] && (!solo || solo.has(id))) mancano.push(`${c}/${id}`);
for (const c of CARTELLE) {
  if (!DA[c] || (scelte && !scelte.has(c))) continue;
  const def = definizioni.get(c);
  const ids = [...vinci].filter(([id, d]) => d === c && (!solo || solo.has(id))).map(([id]) => id);
  const lista = [];
  for (const id of ids) {
    if (def.has(id)) lista.push(def.get(id));
    else mancano.push(`${c}/${id}`);
  }
  if (!lista.length) continue;
  console.log(`== ${c}: ${lista.length} stati`);
  if (secco) {
    console.log(lista.map((s) => s.id).sort().join(" "));
    continue;
  }
  const file = join(tmp, `${c}.json`);
  writeFileSync(file, JSON.stringify(lista, null, 1));
  const argomenti = c === "piani" ? ["cattura-piani.mjs", PAGINE, join(root, "catture-r", c), file] : ["cattura.mjs", client, join(root, "catture-r", c), join(root, "vite-cache"), file];
  execFileSync(process.execPath, [join(root, "script", argomenti[0]), ...argomenti.slice(1)], { stdio: "inherit" });
}
if (mancano.length) console.log(`senza definizione (restano quelle di prima): ${mancano.sort().join(", ")}`);
