#!/usr/bin/env node
// La mappa del disegno: ogni funzione di VectorCraft, letta dal sorgente
// copiato in `vendor/vectorcraft/` senza compilarlo, con il posto che ha in
// Fub (tools/disegno-mappa/README.md).
//
//   node tools/disegno-mappa/estrai.mjs            rigenera crates/fub-disegno/mappa.tsv
//   node tools/disegno-mappa/estrai.mjs --stampa   scrive la mappa rigenerata su stdout
//
// Le fonti sono cinque:
// - `motore`: le invocazioni di `cmd!` in `crates/engine/src/`, salvo quelle
//   dei moduli di test (`#[cfg(test)]`);
// - `interfaccia`: `UI_COMMANDS` di `crates/ui-egui/src/menus/ui_commands.rs`;
// - `strumento`: `TOOL_GROUPS` di `crates/tools/src/catalog.rs` e gli
//   strumenti aggiunti di `crates/tools/src/addons.rs`;
// - `effetto`: il catalogo di `crates/effects/src/`;
// - `pannello`: i moduli dichiarati in `crates/ui-egui/src/panels.rs`.
//
// La chiave di una riga è la coppia (`fonte`, `id`). Le colonne `etichetta`,
// `menu` ed `etichetta_it` vengono dal sorgente (l'etichetta italiana da
// `crates/ui-egui/src/i18n/it.tsv`, e quella inglese dove la traduzione
// manca); le altre le scrive chi porta la funzione, e la rigenerazione le
// tiene. Una riga nuova nasce «da fare» senza famiglia:
// `.github/scripts/check-disegno-mappa.mjs` la mostra.
//
// È la stessa estrazione degli script Python con cui il piano K6 ha scritto
// la prima mappa, in Node e senza dipendenze, con due differenze: gli
// strumenti aggiunti hanno il loro `ID` (non il nome del modulo), e le
// costanti di `UI_COMMANDS` si leggono soltanto dal modulo che nominano.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VECTORCRAFT = path.join(ROOT, "vendor", "vectorcraft");
export const MAPPA = path.join(ROOT, "crates", "fub-disegno", "mappa.tsv");

export const COLONNE = [
  "fonte",
  "id",
  "etichetta",
  "menu",
  "famiglia",
  "fase",
  "task",
  "stato",
  "posto",
  "pigro",
  "nota",
  "etichetta_it",
];
/// Le colonne che vengono dal sorgente: le altre sono scritte a mano.
export const ESTRATTE = ["fonte", "id", "etichetta", "menu", "etichetta_it"];
export const FONTI = ["motore", "interfaccia", "strumento", "effetto", "pannello"];

export class ErroreEstrazione extends Error {}

function leggi(file) {
  return fs.readFileSync(file, "utf8");
}

/// I file `.rs` sotto `dir`, cartella per cartella in ordine di percorso e,
/// in ogni cartella, in ordine di nome (come `sorted(os.walk(dir))`).
function fileRust(dir) {
  const cartelle = [];
  const visita = (d) => {
    cartelle.push(d);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) visita(path.join(d, e.name));
  };
  visita(dir);
  cartelle.sort(confronta);
  const out = [];
  for (const d of cartelle) {
    const nomi = fs
      .readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".rs"))
      .map((e) => e.name)
      .sort(confronta);
    for (const n of nomi) out.push(path.join(d, n));
  }
  return out;
}

function confronta(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Rust senza compilarlo -------------------------------------------------------

/// Il valore di un letterale stringa di Rust scritto fra virgolette, senza le
/// virgolette.
export function stringaRust(corpo) {
  return corpo.replace(/\\(u\{([0-9a-fA-F]+)\}|x([0-9a-fA-F]{2})|\r?\n\s*|.)/g, (_, esc, u, x) => {
    if (u) return String.fromCodePoint(parseInt(u, 16));
    if (x) return String.fromCharCode(parseInt(x, 16));
    if (esc.startsWith("\n") || esc.startsWith("\r")) return "";
    return { n: "\n", t: "\t", r: "\r", 0: "\0" }[esc] ?? esc;
  });
}

/// Dove finisce il blocco `{ … }` che si apre in `src[apre]`: salta stringhe,
/// stringhe grezze, caratteri e commenti.
function fineBlocco(src, apre) {
  let profondita = 0;
  let i = apre;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const a = src.indexOf("\n", i);
      i = a < 0 ? src.length : a + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let livello = 1;
      i += 2;
      while (i < src.length && livello > 0) {
        if (src[i] === "/" && src[i + 1] === "*") (livello++, (i += 2));
        else if (src[i] === "*" && src[i + 1] === "/") (livello--, (i += 2));
        else i++;
      }
      continue;
    }
    const grezza = /^b?r(#*)"/.exec(src.slice(i, i + 260));
    if (grezza && !/[\w]/.test(src[i - 1] ?? "")) {
      const chiude = '"' + grezza[1];
      const a = src.indexOf(chiude, i + grezza[0].length);
      i = a < 0 ? src.length : a + chiude.length;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "'") {
      // Un carattere ('a', '\n', '\u{…}'), non un lifetime ('a).
      const car = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/.exec(src.slice(i, i + 12));
      i += car ? car[0].length : 1;
      continue;
    }
    if (c === "{") profondita++;
    else if (c === "}") {
      profondita--;
      if (profondita === 0) return i + 1;
    }
    i++;
  }
  return src.length;
}

const CFG_TEST = /#\[cfg\((?:all\()?test\b[^\]]*\]/g;

/// Il sorgente senza gli elementi `#[cfg(test)]` scritti in linea (un
/// `mod tests { … }`, una funzione), e i nomi dei moduli di test che stanno
/// in un altro file (`#[cfg(test)] mod tests;`), con il loro `#[path]`.
export function senzaTest(src) {
  const moduli = [];
  let out = "";
  let da = 0;
  CFG_TEST.lastIndex = 0;
  for (let m; (m = CFG_TEST.exec(src)); ) {
    if (m.index < da) continue;
    // Gli altri attributi dell'elemento, poi l'elemento.
    const resto = src.slice(m.index + m[0].length);
    const attr = /^(?:\s*#\[[^\]]*\])*\s*/.exec(resto)[0];
    const percorso = /#\[path\s*=\s*"([^"]+)"\]/.exec(attr)?.[1];
    const dopo = m.index + m[0].length + attr.length;
    const fuori = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/.exec(src.slice(dopo));
    if (fuori) {
      moduli.push({ nome: fuori[1], percorso });
      out += src.slice(da, m.index);
      da = dopo + fuori[0].length;
      CFG_TEST.lastIndex = da;
      continue;
    }
    // Un elemento con un corpo: fino alla graffa che lo chiude, o fino al `;`
    // se finisce prima (un `use`, una costante).
    const graffa = src.indexOf("{", dopo);
    const punto = src.indexOf(";", dopo);
    let fine;
    if (graffa >= 0 && (punto < 0 || graffa < punto)) fine = fineBlocco(src, graffa);
    else fine = punto < 0 ? src.length : punto + 1;
    out += src.slice(da, m.index);
    da = fine;
    CFG_TEST.lastIndex = fine;
  }
  return { sorgente: out + src.slice(da), moduli };
}

/// La cartella dei sottomoduli di un file: la sua per `lib.rs`, `main.rs` e
/// `mod.rs`, `foo/` per `foo.rs`.
function cartellaModuli(file) {
  const base = path.basename(file);
  if (["lib.rs", "main.rs", "mod.rs"].includes(base)) return path.dirname(file);
  return path.join(path.dirname(file), base.slice(0, -3));
}

/// I file e le cartelle dei moduli di test che stanno in un file loro.
function moduliDiTest(files, sorgenti) {
  const fuori = [];
  for (const file of files) {
    for (const { nome, percorso } of senzaTest(sorgenti.get(file)).moduli) {
      if (percorso) {
        const f = path.join(path.dirname(file), percorso);
        fuori.push(f, cartellaModuli(f));
      } else {
        const d = cartellaModuli(file);
        fuori.push(path.join(d, `${nome}.rs`), path.join(d, nome));
      }
    }
  }
  return (file) => fuori.some((f) => file === f || file.startsWith(f + path.sep));
}

// --- le fonti --------------------------------------------------------------------

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

/// Le invocazioni di `cmd!` del motore, la prima di ogni id.
export function comandiMotore(vc) {
  const base = path.join(vc, "crates", "engine", "src");
  const files = fileRust(base);
  const sorgenti = new Map(files.map((f) => [f, leggi(f)]));
  const diTest = moduliDiTest(files, sorgenti);
  const rx = new RegExp(
    String.raw`cmd!\(\s*(query\s+)?` +
      STR +
      String.raw`\s*,\s*` +
      STR +
      String.raw`\s*,\s*\[([^\]]*)\]\s*,\s*(None|Some\(\s*` +
      STR +
      String.raw`\s*\))\s*,\s*` +
      STR,
    "g",
  );
  const visti = new Set();
  const out = [];
  for (const file of files) {
    if (diTest(file)) continue;
    let src = senzaTest(sorgenti.get(file)).sorgente;
    if (src.includes("macro_rules! cmd")) src = src.split("pub(crate) use cmd;").slice(1).join("pub(crate) use cmd;");
    for (const m of src.matchAll(rx)) {
      const id = stringaRust(m[2]);
      if (visti.has(id)) continue;
      visti.add(id);
      const menu = [...m[4].matchAll(new RegExp(STR, "g"))].map((x) => stringaRust(x[1]));
      out.push({ fonte: "motore", id, etichetta: stringaRust(m[3]), menu });
    }
  }
  return out;
}

/// Il valore di `crate::a::b::NOME`, letto da `src/a/b.rs` o `src/a/b/mod.rs`.
function costanteUi(src, riferimento) {
  const parti = riferimento.split("::");
  if (parti[0] === "crate") parti.shift();
  const nome = parti.pop();
  for (const f of [path.join(src, ...parti) + ".rs", path.join(src, ...parti, "mod.rs")]) {
    if (!fs.existsSync(f)) continue;
    const m = new RegExp(String.raw`pub(?:\([^)]*\))?\s+const\s+${nome}\s*:\s*&(?:'static\s+)?str\s*=\s*` + STR).exec(leggi(f));
    if (m) return stringaRust(m[1]);
  }
  throw new ErroreEstrazione(
    `UI_COMMANDS nomina ${riferimento}, che non trovo in crates/ui-egui/src/${parti.join("/")}.rs: ` +
      "aggiungi il file ai percorsi gestiti di vectorcraft in tools/vendor-craft/motori.mjs",
  );
}

/// `UI_COMMANDS`: tuple di quattro elementi (id, etichetta, tasto, parametri);
/// l'id è una stringa o una costante.
export function comandiInterfaccia(vc) {
  const src = path.join(vc, "crates", "ui-egui", "src");
  const testo = leggi(path.join(src, "menus", "ui_commands.rs"));
  const inizio = testo.indexOf("pub const UI_COMMANDS");
  if (inizio < 0) throw new ErroreEstrazione("ui_commands.rs non dichiara UI_COMMANDS");
  let corpo = testo.slice(inizio);
  corpo = corpo.slice(corpo.indexOf("[", corpo.indexOf("=")) + 1, corpo.indexOf("\n];"));
  corpo = senzaCommenti(corpo);
  const elemento = new RegExp(String.raw`\s*(?:` + STR + String.raw`|([A-Za-z_][A-Za-z0-9_:]*))\s*`, "y");
  const out = [];
  let i = 0;
  for (;;) {
    const apre = corpo.indexOf("(", i);
    if (apre < 0) break;
    const valori = [];
    let j = apre + 1;
    while (valori.length < 4) {
      elemento.lastIndex = j;
      const m = elemento.exec(corpo);
      if (!m) throw new ErroreEstrazione(`UI_COMMANDS: non leggo la tupla vicino a «${corpo.slice(apre, apre + 60)}»`);
      valori.push(m[1] !== undefined ? stringaRust(m[1]) : costanteUi(src, m[2]));
      j = elemento.lastIndex;
      if (corpo[j] === ",") j++;
    }
    out.push({ fonte: "interfaccia", id: valori[0], etichetta: valori[1], menu: [] });
    i = corpo.indexOf(")", j) + 1;
  }
  return out;
}

/// Il testo senza i commenti `//` e `/* */` fuori dalle stringhe.
function senzaCommenti(src) {
  return src.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ""));
}

/// `TOOL_GROUPS`, poi gli strumenti aggiunti di `addons.rs` con il loro `ID`.
export function strumenti(vc) {
  const dir = path.join(vc, "crates", "tools", "src");
  const catalogo = leggi(path.join(dir, "catalog.rs"));
  const parti = catalogo.split("pub const TOOL_GROUPS");
  if (parti.length < 2) throw new ErroreEstrazione("catalog.rs non dichiara TOOL_GROUPS");
  const gruppi = parti[1].slice(parti[1].indexOf("= &[") + 4).split("\n];")[0];
  const out = [];
  for (const m of gruppi.matchAll(/\bt\(\s*"([A-Za-z_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.push({ fonte: "strumento", id: m[1], etichetta: stringaRust(m[2]), menu: [] });
  }
  const aggiunte = leggi(path.join(dir, "addons.rs"));
  for (const m of aggiunte.matchAll(/ToolInfo\s*\{\s*id:\s*(\w+)::ID\s*,\s*label:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const file = path.join(dir, "addons", `${m[1]}.rs`);
    const id = fs.existsSync(file) ? /pub const ID: &str = "([^"]+)"/.exec(leggi(file))?.[1] : undefined;
    if (!id) throw new ErroreEstrazione(`addons.rs nomina ${m[1]}::ID, che non trovo in crates/tools/src/addons/${m[1]}.rs`);
    out.push({ fonte: "strumento", id, etichetta: stringaRust(m[2]), menu: [] });
  }
  return out;
}

/// Il catalogo degli effetti: le chiamate `g(…)`, `r(…)`, `e(…)` ed
/// `entry(…)`, gli `EffectInfo { … }` scritti per intero, gli stili di
/// `WARP_STYLES` e le operazioni dell'elaborazione tracciati.
export function effetti(vc) {
  const dir = path.join(vc, "crates", "effects", "src");
  const testi = new Map(fileRust(dir).map((f) => [f, leggi(f)]));
  const tutto = [...testi.values()].join("\n");
  const stringhe = new Map();
  for (const m of tutto.matchAll(/(?:pub(?:\([a-z]+\))? )?const ([A-Z0-9_]+): &str = "([^"]*)"/g)) stringhe.set(m[1], m[2]);
  const elenchi = new Map();
  const elenco = /const ([A-Z0-9_]+): &\[&str\] = &\[([^\]]*)\]/g;
  const voci = (corpo) => [...corpo.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  for (const m of tutto.matchAll(elenco)) if (!elenchi.has(m[1])) elenchi.set(m[1], voci(m[2]));
  const id = (tok) => {
    tok = tok.trim();
    if (tok.startsWith('"')) return tok.replace(/^"+|"+$/g, "");
    return stringhe.get(tok.split("::").at(-1)) ?? tok;
  };
  const menu = (tok, locali) => {
    tok = tok.trim();
    if (tok.startsWith("&[")) return voci(tok);
    return locali.get(tok) ?? elenchi.get(tok) ?? [tok];
  };
  const tutti = [];
  const chiamata = /\b([gre]|entry)\(\s*([A-Za-z0-9_:]+|"[^"]*"),\s*"((?:[^"\\]|\\.)*)",\s*(&\[[^\]]*\]|[A-Z][A-Z0-9_]*)?/g;
  for (const t of testi.values()) {
    const locali = new Map([...t.matchAll(elenco)].map((m) => [m[1], voci(m[2])]));
    for (const m of t.matchAll(chiamata)) {
      const [, tipo, tok, etichetta, voce] = m;
      if (tok === "id") continue;
      const m2 = tipo === "e" || tipo === "entry" ? (locali.get("MENU") ?? ["?"]) : voce ? menu(voce, locali) : ["?"];
      tutti.push({ id: id(tok), etichetta: stringaRust(etichetta), menu: m2 });
    }
  }
  for (const t of testi.values()) {
    for (const m of t.matchAll(/EffectInfo \{\s*id: ([A-Za-z0-9_:]+|"[^"]*"),\s*label: "([^"]*)",\s*menu: (&\[[^\]]*\])/g)) {
      tutti.push({ id: id(m[1]), etichetta: m[2], menu: voci(m[3]) });
    }
  }
  const catalogo = testi.get(path.join(dir, "catalog.rs")) ?? "";
  const stili = catalogo.split("WARP_STYLES")[1]?.split("];")[0] ?? "";
  for (const m of stili.matchAll(/\("([a-zA-Z]+)", "([^"]+…)"\)/g)) {
    tutti.push({ id: "warp." + m[1], etichetta: m[2], menu: ["Effect", "Warp"] });
  }
  for (const m of tutto.matchAll(/\("(pathfinder\.[a-zA-Z]+)", "([^"]+)", PathfinderOp/g)) {
    tutti.push({ id: m[1], etichetta: m[2], menu: ["Effect", "Pathfinder"] });
  }
  const visti = new Set();
  const out = [];
  for (const e of tutti) {
    if (visti.has(e.id) || !/^[a-zA-Z][\w.]*$/.test(e.id)) continue;
    visti.add(e.id);
    out.push({ fonte: "effetto", ...e });
  }
  return out;
}

/// I pannelli: i moduli che `panels.rs` dichiara fuori dai test, con il loro
/// file in `panels/`. I file di test e di aiuto non sono pannelli.
export function pannelli(vc) {
  const src = path.join(vc, "crates", "ui-egui", "src");
  const dichiarati = senzaTest(senzaCommenti(leggi(path.join(src, "panels.rs")))).sorgente;
  const out = [];
  for (const m of dichiarati.matchAll(/^\s*pub(?:\([^)]*\))?\s+mod\s+(\w+)\s*;/gm)) {
    const nome = m[1];
    if (![`${nome}.rs`, `${nome}/mod.rs`].some((f) => fs.existsSync(path.join(src, "panels", f)))) continue;
    out.push({ fonte: "pannello", id: nome, etichetta: titolo(nome), menu: ["Window"] });
  }
  return out.sort((a, b) => confronta(a.id, b.id));
}

/// `color_guide` → «Color Guide», come `str.title()`.
function titolo(nome) {
  return nome.replace(/_/g, " ").replace(/[A-Za-z]+/g, (p) => p[0].toUpperCase() + p.slice(1).toLowerCase());
}

/// Le traduzioni italiane delle stringhe semplici (contesto vuoto) di
/// `it.tsv`: sorgente → traduzione. Le righe vuote, i commenti, i CRLF e le
/// traduzioni vuote non contano.
export function traduzioni(testo) {
  const out = new Map();
  for (const riga of testo.split(/\r?\n/)) {
    if (riga === "" || riga.startsWith("#")) continue;
    const campi = riga.split("\t");
    if (campi.length < 3 || campi[0] !== "") continue;
    const tradotta = campi[2].trim();
    if (tradotta && !out.has(campi[1])) out.set(campi[1], tradotta);
  }
  return out;
}

/// Tutte le righe estratte, nell'ordine delle fonti, con l'etichetta
/// italiana.
export function estrai(vc = VECTORCRAFT) {
  const it = traduzioni(leggi(path.join(vc, "crates", "ui-egui", "src", "i18n", "it.tsv")));
  const righe = [...comandiMotore(vc), ...comandiInterfaccia(vc), ...strumenti(vc), ...effetti(vc), ...pannelli(vc)];
  return righe.map((r) => ({
    fonte: r.fonte,
    id: r.id,
    etichetta: r.etichetta,
    menu: r.menu.join(" › "),
    etichetta_it: it.get(r.etichetta) ?? r.etichetta,
  }));
}

/// La revisione dell'upstream in `vendor/vectorcraft/upstream.lock`.
export function revisione(vc = VECTORCRAFT) {
  const rev = /^rev = "([0-9a-f]{40})"/m.exec(leggi(path.join(vc, "upstream.lock")))?.[1];
  if (!rev) throw new ErroreEstrazione("vendor/vectorcraft/upstream.lock non dice la revisione");
  return rev;
}

// --- il file della mappa ---------------------------------------------------------

export function intestazione(rev) {
  return (
    `# Mappa di VectorCraft ${rev} in Fub. Le righe e le colonne fonte, id, etichetta, menu ed ` +
    "etichetta_it si rigenerano con `node tools/disegno-mappa/estrai.mjs`; le altre si scrivono a mano " +
    "(tools/disegno-mappa/README.md)."
  );
}

export function chiave(r) {
  return `${r.fonte}\t${r.id}`;
}

/// Legge la mappa: la revisione della prima riga, le colonne e le righe.
/// Una riga con un numero di campi sbagliato è un errore.
export function leggiMappa(testo) {
  const righe = testo.split(/\r?\n/);
  if (righe.at(-1) === "") righe.pop();
  const rev = /^# Mappa di VectorCraft ([0-9a-f]{40}) /.exec(righe[0] ?? "")?.[1];
  const errori = [];
  if (!rev) errori.push("la prima riga non è l'intestazione con la revisione di VectorCraft");
  const colonne = (righe[1] ?? "").split("\t");
  if (colonne.join("\t") !== COLONNE.join("\t")) errori.push(`le colonne sono «${colonne.join(" ")}», non «${COLONNE.join(" ")}»`);
  const out = [];
  righe.slice(2).forEach((riga, n) => {
    const campi = riga.split("\t");
    if (campi.length !== COLONNE.length) {
      errori.push(`riga ${n + 3}: ${campi.length} campi invece di ${COLONNE.length}`);
      return;
    }
    out.push({ ...Object.fromEntries(COLONNE.map((c, i) => [c, campi[i]])), riga: n + 3 });
  });
  return { rev, righe: out, errori };
}

function campo(v) {
  return String(v ?? "").replace(/[\t\r\n]+/g, " ");
}

export function scriviMappa(rev, righe) {
  return [intestazione(rev), COLONNE.join("\t"), ...righe.map((r) => COLONNE.map((c) => campo(r[c])).join("\t"))].join("\n") + "\n";
}

/// Le righe estratte con le colonne scritte a mano delle righe che c'erano.
/// Rende anche le chiavi nuove e quelle sparite.
export function rigenera(vecchie, estratte) {
  const prima = new Map(vecchie.map((r) => [chiave(r), r]));
  const nuove = [];
  const righe = estratte.map((e) => {
    const v = prima.get(chiave(e));
    if (!v) nuove.push(chiave(e));
    const scritte = Object.fromEntries(COLONNE.filter((c) => !ESTRATTE.includes(c)).map((c) => [c, v ? v[c] : ""]));
    if (!v) scritte.stato = "da fare";
    return { ...scritte, ...e };
  });
  const adesso = new Set(estratte.map(chiave));
  const sparite = vecchie.map(chiave).filter((k) => !adesso.has(k));
  return { righe, nuove, sparite };
}

function main(args) {
  const estratte = estrai();
  const rev = revisione();
  const vecchie = fs.existsSync(MAPPA) ? leggiMappa(leggi(MAPPA)) : { righe: [], errori: [] };
  if (vecchie.errori.length > 0) {
    console.error(`crates/fub-disegno/mappa.tsv non si legge:\n- ${vecchie.errori.join("\n- ")}`);
    process.exit(1);
  }
  const { righe, nuove, sparite } = rigenera(vecchie.righe, estratte);
  const testo = scriviMappa(rev, righe);
  if (args.includes("--stampa")) {
    process.stdout.write(testo);
    return;
  }
  fs.writeFileSync(MAPPA, testo);
  console.log(`crates/fub-disegno/mappa.tsv: ${righe.length} righe da VectorCraft ${rev.slice(0, 12)}.`);
  for (const k of nuove) console.log(`nuova, da fare e senza famiglia: ${k.replace("\t", " ")}`);
  for (const k of sparite) console.log(`sparita dal motore, tolta: ${k.replace("\t", " ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ErroreEstrazione)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
