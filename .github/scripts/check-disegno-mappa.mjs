#!/usr/bin/env node
// La guardia della mappa del disegno (`crates/fub-disegno/mappa.tsv`): la
// parità con VectorCraft si prova solo se ogni funzione del motore copiato
// ha la sua riga, e ogni riga un valore ammesso in ogni colonna
// (tools/disegno-mappa/README.md).
//
//   node .github/scripts/check-disegno-mappa.mjs             la mappa di oggi
//   node .github/scripts/check-disegno-mappa.mjs --finale    anche: nessuna riga «da fare»
//   node .github/scripts/check-disegno-mappa.mjs --vectorcraft <cartella>
//                                     con un'altra copia del motore (una prova)
//   node .github/scripts/check-disegno-mappa.mjs --self-test
//
// Controlla che:
// - l'insieme delle righe sia quello che `tools/disegno-mappa/estrai.mjs`
//   legge da `vendor/vectorcraft/`, alla revisione di `upstream.lock`, con le
//   stesse colonne estratte: nomina ogni riga che manca, che avanza o che è
//   doppia;
// - famiglia, fase, task, posto, pigro e stato abbiano valori ammessi, e
//   fase e task siano quelli della famiglia;
// - una riga di Fub nomini nella `nota` la funzione di Fub che la serve, e
//   una riga esclusa il perché con la decisione (D6, D9 o D12);
// - un «aspetta» nella `nota` stia solo su una riga «da fare» e nomini un
//   task del piano K6 o P1;
// - una riga «fatto» abbia il suo caso in
//   `crates/fub-disegno/tests/famiglie/<famiglia>.json`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ESTRATTE,
  ErroreEstrazione,
  MAPPA,
  VECTORCRAFT,
  chiave,
  estrai,
  leggiMappa,
  revisione,
  scriviMappa,
} from "../../tools/disegno-mappa/estrai.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CASI = path.join(ROOT, "crates", "fub-disegno", "tests", "famiglie");

/// Le 26 famiglie, con la fase e il task del piano K6 che le porta. Le righe
/// `fub` vanno al task che tocca la parte di Fub che le serve; le escluse a
/// T2, che le ha scritte.
const FAMIGLIE = {
  nucleo: ["F1", "T11"],
  vista: ["F1", "T11"],
  tracciati: ["F1", "T12"],
  forme: ["F1", "T13"],
  trasforma: ["F1", "T13"],
  colore: ["F1", "T14"],
  aspetto: ["F1", "T15"],
  livelli: ["F1", "T15"],
  testo: ["F2", "T16"],
  pennelli: ["F2", "T17"],
  pulizia: ["F2", "T17"],
  effetti: ["F2", "T18"],
  tavole: ["F2", "T19"],
  immagini: ["F3", "T20"],
  trame: ["F2", "T21"],
  dinamici: ["F2", "T21"],
  web: ["F3", "T22"],
  simboli: ["F3", "T22"],
  formati: ["F3", "T23"],
  raster: ["F3", "T24"],
  "tre-d": ["F3", "T24"],
  stampa: ["F4", "T25"],
  prospettiva: ["F4", "T25"],
  grafici: ["F4", "T25"],
  dati: ["F4", "T26"],
  automazione: ["F4", "T26"],
};
const TASK_FUB = ["T2", "T7", "T8", "T9", "T10", "T11"];
const STATI = ["da fare", "fatto", "fub", "escluso"];
const PIGRO = ["famiglia", "nucleo", "—", "sotto:disegno-formati", "sotto:disegno-plugin", "sotto:disegno-script"];
/// I posti del modello dei task di famiglia: i sottomenu di ≡ (con il loro
/// terzo livello), i gruppi della
/// colonna, le schede dell'ispettore (con una sezione), e i posti singoli.
const POSTO = new RegExp(
  "^(?:" +
    [
      "fub",
      "escluso",
      "finestra",
      "banda",
      "tasto-destro",
      "tavolozza",
      "testata",
      "interno",
      "colonna",
      "menu/(?:file|modifica|oggetto|testo|selezione|effetto|visualizza)",
      // Il terzo livello di ≡: `SOTTOMENU` di `crates/fub-disegno/src/catalogo.rs`.
      "menu/modifica/colori",
      "menu/oggetto/(?:tracciato|trasforma|disponi|fusione|inviluppo|blocca|nascondi|elaborazione)",
      "menu/selezione/(?:uguale|oggetto)",
      "menu/effetto/(?:deforma|stilizza|distorci)",
      "menu/visualizza/guide",
      "colonna/(?:scegli|disegna|forme|testo|trasforma|colore|oggetti|prospettiva|misura|vista)",
      "ispettore/(?:design|livelli|risorse|cronologia)(?:/[a-z][a-z-]*)?",
    ].join("|") +
    ")$",
);
/// I task che un «aspetta» può nominare: quelli del piano K6, e P1.
const ATTESE = new Set([...Array.from({ length: 31 }, (_, i) => `T${i + 1}`), "P1"]);

function nome(r) {
  return `${r.fonte} ${r.id}`;
}

/// I casi di una famiglia: un array, o un oggetto con l'array `casi`; un caso
/// nomina la riga con `id` (e `fonte`, se l'id non basta).
function casiDi(famiglia, leggiCasi) {
  const testo = leggiCasi(famiglia);
  if (testo === undefined) return { errore: `manca crates/fub-disegno/tests/famiglie/${famiglia}.json` };
  let dati;
  try {
    dati = JSON.parse(testo);
  } catch (e) {
    return { errore: `crates/fub-disegno/tests/famiglie/${famiglia}.json non è JSON: ${e.message}` };
  }
  const casi = Array.isArray(dati) ? dati : Array.isArray(dati?.casi) ? dati.casi : [];
  return { casi };
}

/// Gli errori della mappa rispetto alle righe estratte, e i conti.
export function controlla(testo, estratte, rev, { finale = false, leggiCasi = () => undefined } = {}) {
  const errori = [];
  const mappa = leggiMappa(testo);
  errori.push(...mappa.errori);
  if (mappa.rev && mappa.rev !== rev) {
    errori.push(`la mappa è di VectorCraft ${mappa.rev.slice(0, 12)}, la copia di ${rev.slice(0, 12)}: rigenerala con node tools/disegno-mappa/estrai.mjs`);
  }

  const viste = new Map();
  for (const r of mappa.righe) {
    const k = chiave(r);
    if (viste.has(k)) errori.push(`riga ${r.riga}: ${nome(r)} è doppia (c'è già alla riga ${viste.get(k).riga})`);
    else viste.set(k, r);
  }
  const attese = new Map(estratte.map((e) => [chiave(e), e]));
  for (const [k, e] of attese) {
    if (!viste.has(k)) errori.push(`manca la riga ${nome(e)} («${e.etichetta}»), che il motore ha`);
  }
  for (const [k, r] of viste) {
    const e = attese.get(k);
    if (!e) {
      errori.push(`riga ${r.riga}: ${nome(r)} non c'è più nel motore`);
      continue;
    }
    for (const c of ESTRATTE) {
      if (r[c] !== String(e[c]).replace(/[\t\r\n]+/g, " ")) {
        errori.push(`riga ${r.riga}: ${nome(r)} ha ${c} «${r[c]}», il motore «${e[c]}»: rigenera con node tools/disegno-mappa/estrai.mjs`);
      }
    }
  }

  const casi = new Map();
  for (const r of viste.values()) {
    const dove = `riga ${r.riga}: ${nome(r)}`;
    const fam = r.famiglia;
    if (!fam) errori.push(`${dove} non ha famiglia (una funzione nuova del motore: scegli famiglia, fase, task, posto e pigro)`);
    else if (fam === "fub") {
      if (r.fase !== "—") errori.push(`${dove}: una riga di Fub ha fase «—», non «${r.fase}»`);
      if (!TASK_FUB.includes(r.task)) errori.push(`${dove}: una riga di Fub va a ${TASK_FUB.join(", ")}, non a «${r.task}»`);
      if (r.posto !== "fub") errori.push(`${dove}: una riga di Fub ha posto «fub», non «${r.posto}»`);
      if (!r.nota.trim()) errori.push(`${dove}: una riga di Fub nomina nella nota la funzione di Fub che la serve`);
    } else if (fam === "escluso") {
      if (r.fase !== "—" || r.task !== "T2") errori.push(`${dove}: una riga esclusa ha fase «—» e task T2`);
      if (r.stato !== "escluso") errori.push(`${dove}: la famiglia «escluso» vuole lo stato «escluso»`);
    } else if (!FAMIGLIE[fam]) errori.push(`${dove}: «${fam}» non è una famiglia (${Object.keys(FAMIGLIE).join(", ")}, fub, escluso)`);
    else {
      const [fase, task] = FAMIGLIE[fam];
      if (r.fase !== fase) errori.push(`${dove}: la famiglia ${fam} è della fase ${fase}, non «${r.fase}»`);
      if (r.task !== task) errori.push(`${dove}: la famiglia ${fam} la porta ${task}, non «${r.task}»`);
      if (r.posto === "fub") errori.push(`${dove}: il posto «fub» è solo delle righe di Fub`);
    }
    if (!POSTO.test(r.posto)) errori.push(`${dove}: «${r.posto}» non è un posto del modello dei task di famiglia`);
    if (!PIGRO.includes(r.pigro)) errori.push(`${dove}: «${r.pigro}» non è un'unità pigra (${PIGRO.join(", ")})`);
    else if (fam && (r.pigro === "—") !== (fam === "fub" || fam === "escluso")) {
      errori.push(`${dove}: «—» in pigro è delle righe di Fub e delle escluse, e solo loro`);
    }
    if (!STATI.includes(r.stato)) errori.push(`${dove}: «${r.stato}» non è uno stato (${STATI.join(", ")})`);
    if (r.stato === "fub" && fam !== "fub") errori.push(`${dove}: lo stato «fub» è delle righe della famiglia fub`);
    if (r.stato === "escluso") {
      if (r.posto !== "escluso") errori.push(`${dove}: una riga esclusa ha posto «escluso»`);
      if (!/\b(D6|D9|D12)\b/.test(r.nota) || r.nota.replace(/\(?\b(D6|D9|D12)\b\)?/g, "").trim().length < 3) {
        errori.push(`${dove}: una riga esclusa dice nella nota il perché e la decisione (D6, D9 o D12)`);
      }
    } else if (r.posto === "escluso") errori.push(`${dove}: il posto «escluso» è solo delle righe escluse`);
    for (const m of r.nota.matchAll(/\baspetta\s+(\S+)/g)) {
      const t = m[1].replace(/[,;.)]+$/, "");
      if (r.stato !== "da fare") errori.push(`${dove}: «aspetta ${t}» sta solo su una riga «da fare»`);
      if (!ATTESE.has(t)) errori.push(`${dove}: «aspetta ${t}» non nomina un task del piano (T1–T31) né P1`);
    }
    if (r.stato === "fatto" && fam && FAMIGLIE[fam]) {
      if (!casi.has(fam)) casi.set(fam, casiDi(fam, leggiCasi));
      const c = casi.get(fam);
      if (c.errore) errori.push(`${dove} è «fatto», ma ${c.errore}`);
      else if (!c.casi.some((x) => x?.id === r.id && (x.fonte === undefined || x.fonte === r.fonte))) {
        errori.push(`${dove} è «fatto», ma crates/fub-disegno/tests/famiglie/${fam}.json non ha il suo caso`);
      }
    }
    if (finale && r.stato === "da fare") errori.push(`${dove} è ancora «da fare»`);
  }

  const perStato = {};
  const perFamiglia = {};
  for (const r of viste.values()) {
    perStato[r.stato] = (perStato[r.stato] ?? 0) + 1;
    const f = (perFamiglia[r.famiglia || "(senza)"] ??= {});
    f[r.stato] = (f[r.stato] ?? 0) + 1;
  }
  return { errori, righe: mappa.righe.length, perStato, perFamiglia };
}

function stampaConti({ righe, perStato, perFamiglia }) {
  const stati = (o) => STATI.filter((s) => o[s]).map((s) => `${o[s]} ${s}`).join(", ");
  console.log(`mappa del disegno: ${righe} righe: ${stati(perStato)}.`);
  for (const f of Object.keys(perFamiglia).sort()) console.log(`  ${f}: ${stati(perFamiglia[f])}`);
}

// --- autoprova ---------------------------------------------------------------------

function autoprova() {
  const rev = "a".repeat(40);
  const estratte = [
    { fonte: "motore", id: "path.join", etichetta: "Join", menu: "Object › Path", etichetta_it: "Unisci" },
    { fonte: "interfaccia", id: "file.place", etichetta: "Place…", menu: "", etichetta_it: "Inserisci…" },
    { fonte: "motore", id: "file.place", etichetta: "Place…", menu: "File", etichetta_it: "Inserisci…" },
    { fonte: "interfaccia", id: "help.discord", etichetta: "Discord", menu: "", etichetta_it: "Discord" },
  ];
  const buona = [
    { famiglia: "tracciati", fase: "F1", task: "T12", stato: "fatto", posto: "menu/oggetto", pigro: "famiglia", nota: "" },
    { famiglia: "fub", fase: "—", task: "T2", stato: "fub", posto: "fub", pigro: "—", nota: "Fub: inserisci dal vault" },
    { famiglia: "formati", fase: "F3", task: "T23", stato: "da fare", posto: "menu/file", pigro: "famiglia", nota: "aspetta T30" },
    { famiglia: "escluso", fase: "—", task: "T2", stato: "escluso", posto: "escluso", pigro: "—", nota: "link esterno (D6)" },
  ].map((s, i) => ({ ...estratte[i], ...s }));
  const casi = (f) => (f === "tracciati" ? JSON.stringify({ casi: [{ id: "path.join" }] }) : undefined);
  const prova = (righe, attesa, opzioni = {}) => {
    const { errori } = controlla(scriviMappa(rev, righe), estratte, rev, { leggiCasi: casi, ...opzioni });
    const ok = attesa === null ? errori.length === 0 : errori.some((e) => e.includes(attesa));
    if (!ok) throw new Error(`autoprova: atteso ${attesa === null ? "nessun errore" : `«${attesa}»`}, avuto:\n- ${errori.join("\n- ")}`);
  };
  prova(buona, null);
  prova(buona.slice(1), "manca la riga motore path.join");
  prova([...buona, { ...buona[0], id: "path.nuovo" }], "path.nuovo non c'è più nel motore");
  prova([...buona, buona[1]], "è doppia");
  prova(buona, "è ancora «da fare»", { finale: true });
  prova([{ ...buona[0], famiglia: "" }, ...buona.slice(1)], "non ha famiglia");
  prova([{ ...buona[0], task: "T13" }, ...buona.slice(1)], "la porta T12");
  prova([{ ...buona[0], posto: "menu/aiuto" }, ...buona.slice(1)], "non è un posto");
  prova([buona[0], { ...buona[1], nota: "" }, ...buona.slice(2)], "nomina nella nota la funzione");
  prova([...buona.slice(0, 3), { ...buona[3], nota: "(D6)" }], "il perché e la decisione");
  prova([...buona.slice(0, 2), { ...buona[2], nota: "aspetta T99" }, buona[3]], "aspetta T99");
  prova([{ ...buona[0], id: "path.join", etichetta: "Join Paths" }, ...buona.slice(1)], "ha etichetta");
  prova(buona, "manca crates/fub-disegno/tests/famiglie/tracciati.json", { leggiCasi: () => undefined });
  prova(buona, "non ha il suo caso", { leggiCasi: () => "[]" });
  const altra = controlla(scriviMappa("b".repeat(40), buona), estratte, rev, { leggiCasi: casi });
  if (!altra.errori.some((e) => e.includes("rigenerala"))) throw new Error("autoprova: la revisione cambiata non cade");
  const rotta = scriviMappa(rev, buona).replace("path.join\t", "path.join\t\t");
  if (!controlla(rotta, estratte, rev, { leggiCasi: casi }).errori.some((e) => e.includes("campi invece di"))) {
    throw new Error("autoprova: una riga con un campo in più non cade");
  }
  console.log("Autoprova di check-disegno-mappa riuscita.");
}

function main(args) {
  if (args.includes("--self-test")) return autoprova();
  const leggiCasi = (f) => {
    const file = path.join(CASI, `${f}.json`);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  };
  const i = args.indexOf("--vectorcraft");
  const vc = i >= 0 ? path.resolve(args[i + 1] ?? "") : VECTORCRAFT;
  let esito;
  try {
    esito = controlla(fs.readFileSync(MAPPA, "utf8"), estrai(vc), revisione(vc), { finale: args.includes("--finale"), leggiCasi });
  } catch (e) {
    if (!(e instanceof ErroreEstrazione)) throw e;
    console.error(`la mappa del disegno non si controlla: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  stampaConti(esito);
  if (esito.errori.length > 0) {
    console.error(`\ncrates/fub-disegno/mappa.tsv: ${esito.errori.length} errori:\n- ${esito.errori.join("\n- ")}`);
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
