// solo simulatore: l'elenco unico degli stati del simulatore v2.
// Mette insieme gli stati del primo giro (stati-sim.mjs), le catture del
// secondo (stati-giro-sim.mjs), le pagine dei piani composte nella cornice
// (stati-composte-sim.mjs) e i pezzi nuovi da approvare (stati-nuove-sim.mjs).
// Per ogni stato risolve la catena delle basi (cattura radice + strati + toppe),
// sceglie la cattura a 700 px e al telefono, controlla che ogni riferimento
// esista e dà il numero S, che non cambia più (numeri-sim.json cresce soltanto).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATI, PIANI } from "./stati-sim.mjs";
import { GIRO, TEL_ESATTI } from "./stati-giro-sim.mjs";
import { COMPOSTE } from "./stati-composte-sim.mjs";
import { NUOVE, CARTELLE_NUOVE } from "./stati-nuove-sim.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export { PIANI };

// La prima cartella che ha l'id vince (controllato: nessun id dei giri nuovi
// è anche nelle cartelle del primo giro).
export const CARTELLE = [...CARTELLE_NUOVE, "giro3", "giro2", "tel", "piani", "nuove6", "nuove5", "nuove2", "nuove4", "nuove3", "nuove", "s2", "avvio"];

export const GRUPPI = [
  ["Nota", "La nota"],
  ["Riquadri", "I riquadri"],
  ["File", "I file, i salvataggi, i conflitti"],
  ["Foglio", "Il foglio"],
  ["Documento", "Il documento"],
  ["Disegno", "Il disegno"],
  ["Lavagna", "La lavagna"],
  ["Pdf", "PDF e foto"],
  ["Componenti", "Componenti e ricette"],
  ["Cornice", "La cornice"],
  ["Impostazioni", "Le impostazioni"],
  ["Casi", "Casi ai margini"],
  ["Riscontri", "I riscontri"],
  ["Telefono", "Il telefono (Android di prova)"],
  ["Temi", "I temi e la skin facile"],
];

// Il primo giro aveva cinque gruppi: qui ogni stato va dove lo si cerca.
const RIMAPPA = {
  documento: "Documento", "documento-oggetti": "Documento", "sola-lettura": "Documento",
  foglio: "Foglio", "foglio-modifica": "Foglio", "foglio-comandi": "Foglio", "foglio-comandi-cerca": "Foglio",
  caricamento: "Foglio", errore: "Foglio", molti: "Foglio",
  disegno: "Disegno", "disegno-selezione": "Disegno", craft: "Disegno", "craft-prepara": "Disegno", "craft-rotto": "Disegno",
  pdf: "Pdf", foto: "Pdf",
  lavagna: "Lavagna",
  componenti: "Componenti", "nuovo-vault": "Componenti", "craft-spente": "Componenti",
  impostazioni: "Impostazioni", aspetto: "Impostazioni", "impostazioni-vault": "Impostazioni",
  conflitto: "File",
};

// Gli stati del primo giro il cui `tel` è la cattura esatta (non la più vicina).
export const TEL_PROPRI = new Set(["nota-riposo", "documento", "foglio", "palette-file", "vuoto", "avvio-attesa"]);
// I menu che si aprono sopra uno stato vengono da catture loro.
export const PEZZI_CATTURE = ["pz-menu-testo", "pz-menu-link", "pz-menu-albero", "pz-menu-cartella", "pz-menu-scheda"];
// Da qui la ricomposta al telefono prende il CSS del guscio mobile.
export const TEL_CSS = "t-cestino";

export function indiceCatture() {
  const dove = new Map();
  for (const c of CARTELLE) {
    for (const f of readdirSync(join(root, "catture", c))) {
      const m = f.match(/^(.*)-(light|dark)\.json$/);
      if (m && !dove.has(`${m[1]}-${m[2]}`)) dove.set(`${m[1]}-${m[2]}`, join(root, "catture", c, f));
    }
  }
  return dove;
}

function tutti() {
  const v1 = STATI.map((s) => ({ ...s, g: RIMAPPA[s.id] ?? s.g, prov: "cattura", primo: true }));
  const giro = GIRO.map((s) => ({ ...s, prov: "cattura", giro: true }));
  const lista = [...v1, ...giro, ...COMPOSTE, ...NUOVE];
  const ordine = new Map(GRUPPI.map(([g], i) => [g, i]));
  for (const s of lista) if (!ordine.has(s.g)) throw new Error(`gruppo sconosciuto ${s.g} (${s.id})`);
  return lista.map((s, i) => [s, i]).sort((a, b) => ordine.get(a[0].g) - ordine.get(b[0].g) || a[1] - b[1]).map(([s]) => s);
}

// «indice» si passa quando le catture non ci sono (nel repository): allora
// vengono dai dati già impacchettati, e l'indice dice solo quali ci sono.
export function costruisciElenco({ templates = null, scriviNumeri = true, indice: dato = null } = {}) {
  const lista = tutti();
  const per = new Map();
  for (const s of lista) {
    if (per.has(s.id)) throw new Error(`stato doppio: ${s.id}`);
    per.set(s.id, s);
  }
  const indice = dato ?? indiceCatture();
  const c = (id) => indice.has(`${id}-light`) && indice.has(`${id}-dark`);
  const errori = [];
  const deve = (ok, msg) => ok || errori.push(msg);
  // «piano» è l id della pagina in PIANI; il primo giro scriveva la sigla del
  // piano (N6, K5, A1…): la sigla porta alla sua unica pagina.
  const pianoId = (p) => {
    if (!p) return null;
    if (PIANI.some((x) => x.id === p)) return p;
    const m = PIANI.filter((x) => x.piano === p);
    if (m.length !== 1) return void errori.push(`piano sconosciuto o ambiguo: ${p}`);
    return m[0].id;
  };

  const telEsatto = (s) => TEL_ESATTI[s.id] ?? (s.giro && s.tel) ?? (s.primo && TEL_PROPRI.has(s.id) && s.tel) ?? null;
  function radice(s, visti = new Set()) {
    if (!s.base) return s;
    if (visti.has(s.id)) throw new Error(`basi in cerchio: ${[...visti].join(" → ")}`);
    visti.add(s.id);
    const b = per.get(s.base);
    if (!b) throw new Error(`base sconosciuta ${s.base} (${s.id})`);
    return radice(b, visti);
  }
  function risolvi(s) {
    if (!s.base) return { cap: s.id, strati: s.strati ?? [], toppe: s.toppe ?? [] };
    const r = risolvi(per.get(s.base));
    return { cap: r.cap, strati: [...r.strati, ...(s.strati ?? [])], toppe: [...r.toppe, ...(s.toppe ?? [])] };
  }

  // I numeri S: chi c'è tiene il suo, chi arriva prende il prossimo.
  const fileNumeri = join(root, "script", "numeri-sim.json");
  const numeri = existsSync(fileNumeri) ? JSON.parse(readFileSync(fileNumeri, "utf8")) : { next: 1, ids: {} };
  let nuovi = 0;
  for (const s of lista) {
    if (!numeri.ids[s.id]) {
      numeri.ids[s.id] = numeri.next++;
      nuovi += 1;
    }
  }
  if (nuovi && scriviNumeri) writeFileSync(fileNumeri, JSON.stringify(numeri, null, 1) + "\n");

  const catture = new Set([...PEZZI_CATTURE, TEL_CSS]);
  const elenco = lista.map((s) => {
    const r = radice(s);
    const res = risolvi(s);
    const tel = s.g === "Telefono";
    const w700 = tel ? null : s.w700 ? { cap: s.w700, toppe: false } : r !== s && r.w700 ? { cap: r.w700, toppe: true } : null;
    const te = tel ? null : telEsatto(s) ? { cap: telEsatto(s), toppe: false } : r !== s && telEsatto(r) ? { cap: telEsatto(r), toppe: true } : null;
    const vicino = !tel && !te && s.primo && s.tel && per.has(s.tel) ? s.tel : null;
    deve(c(res.cap), `${s.id}: manca la cattura ${res.cap}`);
    catture.add(res.cap);
    for (const w of [w700, te]) if (w) deve(c(w.cap), `${s.id}: manca la cattura ${w.cap}`), catture.add(w.cap);
    for (const st of res.strati) deve(c(st.cattura), `${s.id}: manca lo strato ${st.cattura}`), catture.add(st.cattura);
    for (const t of res.toppe) {
      if (t.da) deve(c(t.da), `${s.id}: manca la cattura del pezzo ${t.da}`), catture.add(t.da);
      if (t.html && templates) deve(templates.has(t.html), `${s.id}: manca la toppa ${t.html}`);
      deve(t.dove, `${s.id}: una toppa senza «dove»`);
    }
    for (const g of Array.isArray(s.gemelli) ? s.gemelli : []) deve(per.has(g), `${s.id}: gemello sconosciuto ${g}`);
    deve(Array.isArray(s.task) && s.task.length, `${s.id}: senza task`);
    deve(s.dice, `${s.id}: senza «dice»`);
    return {
      n: numeri.ids[s.id],
      id: s.id,
      g: s.g,
      nome: s.nome,
      dice: s.dice,
      task: s.task,
      prov: s.prov ?? "cattura",
      fuoco: s.fuoco ?? "body",
      ...(s.perche ? { perche: s.perche } : {}),
      ...(s.piano ? { piano: pianoId(s.piano) } : {}),
      ...(s.tema ? { tema: s.tema } : {}),
      ...(s.gemelli ? { gemelli: s.gemelli } : {}),
      ...(s.base ? { base: s.base } : {}),
      telefono: tel,
      cap: res.cap,
      strati: res.strati,
      toppe: res.toppe,
      w700,
      tel: te,
      vicino,
    };
  });
  // La provenienza dice il vero: chi ha DOM scritto a mano è «nuova».
  for (const s of elenco) {
    const aMano = s.toppe.some((t) => t.html);
    if (aMano && s.prov !== "nuova") errori.push(`${s.id}: ha DOM scritto a mano ma prov «${s.prov}»`);
    if (!aMano && s.prov === "cattura" && (s.strati.length || s.toppe.length)) errori.push(`${s.id}: è composto ma prov «cattura»`);
  }
  for (const [k, v] of Object.entries(TEL_ESATTI)) {
    deve(per.has(k), `TEL_ESATTI: stato sconosciuto ${k}`);
    deve(c(v), `TEL_ESATTI: manca la cattura ${v}`);
  }
  if (errori.length) throw new Error(`elenco: ${errori.length} errori\n  ${errori.join("\n  ")}`);
  return { elenco, catture, indice };
}
