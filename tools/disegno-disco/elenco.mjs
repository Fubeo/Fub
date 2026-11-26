#!/usr/bin/env node
// L'elenco dei punti in cui il motore del disegno tocca il disco
// (`crates/fub-disegno/disco.tsv`, docs/architecture/disegno-completo.md#il-disco).
//
//   node tools/disegno-disco/elenco.mjs             riscrive l'elenco: i siti nuovi
//                                                   entrano vuoti, quelli spariti escono
//   node tools/disegno-disco/elenco.mjs --stampa    lo scrive sullo standard output
//   node tools/disegno-disco/elenco.mjs --check     la guardia (in scripts/check.sh e in CI)
//   opzioni per le prove: --vectorcraft <cartella> (un'altra copia del motore),
//   --disco <file>, --mappa <file>
//
// Legge i crate di `vendor/vectorcraft/crates/` che Fub compila (da quelli che
// `crates/fub-disegno/Cargo.toml` nomina, seguendo le dipendenze `vectorcraft-*`
// non opzionali), modulo per modulo da `src/lib.rs`, senza i moduli e gli
// elementi `#[cfg(test)]`, e trova ogni sito di una delle PRIMITIVE. Un sito è
// la chiave (file, funzione, primitiva): due chiamate della stessa primitiva
// nella stessa funzione sono un sito solo.
//
// Con `--check` cade, nominandolo, se:
// - un sito c'è nel motore e non nell'elenco, o il contrario, o è doppio;
// - un valore di `come` non è ammesso;
// - un id di `comandi` non è una riga della mappa (`crates/fub-disegno/mappa.tsv`);
// - una riga `kernel` o `byte` non ha il suo task, o una `escluso` non dice il
//   perché con D6, D9 o D12;
// - una riga `ambiente` o `nessuno` nomina un comando (vuole «—») o non dice
//   perché nella nota;
// - una riga `spento` non sta dietro una feature che Fub non accende, o un sito
//   dietro una di quelle feature non è `spento`;
// - un sito dentro una chiamata di `unconfined` (o la chiamata stessa) è
//   `rifiutato`: `AutomationRoots` non lo ferma;
// - un `cfg(feature = …)` nomina una feature che questo script non conosce.
//
// Niente dipendenze npm, come le guardie di `.github/scripts/`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VECTORCRAFT = path.join(ROOT, "vendor", "vectorcraft");
export const DISCO = path.join(ROOT, "crates", "fub-disegno", "disco.tsv");
export const MAPPA = path.join(ROOT, "crates", "fub-disegno", "mappa.tsv");
const ADATTATORE = path.join(ROOT, "crates", "fub-disegno", "Cargo.toml");

export const COLONNE = ["file", "funzione", "primitiva", "comandi", "come", "task", "nota"];
/// I valori di `come` (docs/architecture/disegno-completo.md#il-disco):
/// `byte` il motore lavora sui byte di Fub; `kernel` Fub legge o scrive con il
/// kernel e passa i byte; `fub` lo serve Fub e la guardia rifiuta il comando;
/// `rifiutato` lo fermano le radici vuote, la guardia o l'interruttore dei
/// caratteri; `escluso` il comando si rifiuta (D6, D9, D12); `spento` dietro una
/// feature spenta; `ambiente` legge l'ambiente del processo o `/proc`, non un
/// file della persona; `nessuno` nessuna strada di Fub ci arriva.
export const COME = ["byte", "kernel", "fub", "rifiutato", "escluso", "spento", "ambiente", "nessuno"];

/// Le feature dei crate del motore che Fub non accende: `vectorcraft-engine` e
/// `vectorcraft-text` entrano con `default-features = false` (il `Cargo.toml`
/// della radice), il PDF non è dichiarato (patch 0002) e gli importatori e i
/// plug-in sono spenti (patch 0001). Una feature che non è qui né in ACCESE
/// ferma la guardia: va decisa.
export const SPENTE = ["pdf", "metafile", "affinity", "plugins", "bundled-fonts", "test-fonts"];
export const ACCESE = [];

/// Le primitive, dalla più specifica: un sito ne prende una sola.
/// `chiamata` vuole la parentesi dopo il nome; `percorso` è un cammino `a::b`.
export const PRIMITIVE = [
  { nome: "confine_process", nomi: ["confine_process"], chiamata: true },
  { nome: "unconfined", nomi: ["unconfined"], chiamata: true },
  { nome: "check_read", nomi: ["check_read"], chiamata: true },
  { nome: "check_write", nomi: ["check_write"], chiamata: true },
  { nome: "File::open", percorso: ["File", "open"] },
  { nome: "File::create", percorso: ["File", "create"] },
  { nome: "OpenOptions", nomi: ["OpenOptions"] },
  { nome: "read_dir", nomi: ["read_dir"], chiamata: true },
  { nome: "canonicalize", nomi: ["canonicalize"], chiamata: true },
  { nome: "std::env::var_os", percorso: ["env", "var_os"] },
  { nome: "std::env::var", percorso: ["env", "var"] },
  { nome: "std::env::temp_dir", percorso: ["env", "temp_dir"] },
  { nome: "home_dir", nomi: ["home_dir"], chiamata: true },
  { nome: "std::fs", percorso: ["fs"] },
];

export class ErroreElenco extends Error {}

function leggi(file) {
  return fs.readFileSync(file, "utf8");
}

// --- i crate che Fub compila ------------------------------------------------------

/// Le dipendenze `vectorcraft-*` di un manifest, senza le opzionali e senza
/// quelle dei test e della build.
function dipendenzeMotore(testo) {
  const out = [];
  let sezione = "";
  for (const riga of testo.split(/\r?\n/)) {
    const s = /^\s*\[([^\]]+)\]\s*$/.exec(riga);
    if (s) {
      sezione = s[1].trim();
      continue;
    }
    const normale = sezione === "dependencies" || /^target\..*\.dependencies$/.test(sezione);
    if (!normale) continue;
    const d = /^\s*(vectorcraft-[a-z0-9-]+)\s*=\s*(.*)$/.exec(riga);
    if (d && !/optional\s*=\s*true/.test(d[2])) out.push(d[1]);
  }
  return out;
}

/// I nomi delle cartelle dei crate compilati, in ordine.
export function crateCompilati(vc = VECTORCRAFT, adattatore = ADATTATORE) {
  const cartella = (nome) => nome.replace(/^vectorcraft-/, "");
  const visti = new Set();
  const coda = dipendenzeMotore(leggi(adattatore)).map(cartella);
  while (coda.length) {
    const c = coda.shift();
    if (visti.has(c)) continue;
    const manifest = path.join(vc, "crates", c, "Cargo.toml");
    if (!fs.existsSync(manifest)) throw new ErroreElenco(`il crate vectorcraft-${c} non c'è in ${path.relative(ROOT, vc) || vc}`);
    visti.add(c);
    coda.push(...dipendenzeMotore(leggi(manifest)).map(cartella));
  }
  return [...visti].sort();
}

// --- Rust in pezzi ----------------------------------------------------------------

/// I pezzi di un sorgente Rust: identificatori, punteggiatura (`::` è un pezzo),
/// stringhe e caratteri come un pezzo opaco; i commenti spariscono.
export function pezzi(src) {
  const out = [];
  let i = 0;
  let riga = 1;
  const avanza = (fino) => {
    for (let k = i; k < fino; k++) if (src.charCodeAt(k) === 10) riga++;
    i = fino;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      avanza(i + 1);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const a = src.indexOf("\n", i);
      avanza(a < 0 ? src.length : a);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let livello = 1;
      let k = i + 2;
      while (k < src.length && livello > 0) {
        if (src[k] === "/" && src[k + 1] === "*") (livello++, (k += 2));
        else if (src[k] === "*" && src[k + 1] === "/") (livello--, (k += 2));
        else k++;
      }
      avanza(k);
      continue;
    }
    const grezza = /^(?:b|c)?r(#*)"/.exec(src.slice(i, i + 300));
    if (grezza && !/\w/.test(src[i - 1] ?? "")) {
      const chiude = '"' + grezza[1];
      const a = src.indexOf(chiude, i + grezza[0].length);
      out.push({ t: "s", v: "", riga });
      avanza(a < 0 ? src.length : a + chiude.length);
      continue;
    }
    if (c === '"' || ((c === "b" || c === "c") && src[i + 1] === '"' && !/\w/.test(src[i - 1] ?? ""))) {
      let k = i + (c === '"' ? 1 : 2);
      while (k < src.length && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
      out.push({ t: "s", v: "", riga });
      avanza(k + 1);
      continue;
    }
    if (c === "'" || (c === "b" && src[i + 1] === "'")) {
      const da = c === "b" ? i + 1 : i;
      const car = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(src.slice(da, da + 14));
      if (car) {
        out.push({ t: "s", v: "", riga });
        avanza(da + car[0].length);
        continue;
      }
      // Un lifetime: `'a`.
      const vita = /^'[A-Za-z_]\w*/.exec(src.slice(i, i + 80));
      out.push({ t: "p", v: "'", riga });
      avanza(i + (vita ? vita[0].length : 1));
      continue;
    }
    const id = /^(?:r#)?[A-Za-z_]\w*/.exec(src.slice(i, i + 200));
    if (id) {
      out.push({ t: "i", v: id[0].replace(/^r#/, ""), riga });
      avanza(i + id[0].length);
      continue;
    }
    const num = /^[0-9][\w.]*/.exec(src.slice(i, i + 80));
    if (num) {
      out.push({ t: "n", v: num[0], riga });
      avanza(i + num[0].length);
      continue;
    }
    if (c === ":" && src[i + 1] === ":") {
      out.push({ t: "p", v: "::", riga });
      avanza(i + 2);
      continue;
    }
    out.push({ t: "p", v: c, riga });
    avanza(i + 1);
  }
  return out;
}

/// La fine (esclusa) dell'attributo che comincia con `#` in `p[i]`.
function fineAttributo(p, i) {
  let k = i + 1;
  if (p[k]?.v === "!") k++;
  if (p[k]?.v !== "[") return i + 1;
  let livello = 0;
  for (; k < p.length; k++) {
    if (p[k].v === "[") livello++;
    else if (p[k].v === "]" && --livello === 0) return k + 1;
  }
  return p.length;
}

/// Che cosa dice un attributo: `test` (`cfg(test)` o `cfg(all(test, …))`),
/// le feature di un `cfg` positivo, o il `path` di un modulo.
function leggiAttributo(p, da, a) {
  const corpo = p.slice(da, a).filter((x) => x.v !== "#" && x.v !== "!");
  const nomi = corpo.map((x) => x.v);
  const out = { test: false, feature: [], percorso: null, nonFeature: [] };
  if (nomi[1] === "cfg") {
    const negato = nomi.includes("not");
    if (!negato && nomi.includes("test") && !nomi.includes("any")) out.test = true;
    for (let k = 0; k < corpo.length; k++) {
      if (corpo[k].v === "feature" && corpo[k + 1]?.v === "=") {
        const f = corpo[k + 2]?.testo;
        if (f !== undefined) (negato ? out.nonFeature : out.feature).push(f);
      }
    }
  }
  if (nomi[1] === "path" && nomi[2] === "=") out.percorso = corpo[3]?.testo ?? null;
  return out;
}

/// I pezzi con il testo delle stringhe semplici (per `feature = "…"` e
/// `#[path = "…"]`).
function pezziConTesto(src) {
  const p = pezzi(src);
  // Rilegge le stringhe semplici negli attributi: poche, e solo lì serve il testo.
  const rx = /"((?:[^"\\]|\\.)*)"/g;
  const righe = src.split("\n");
  for (let k = 0; k < p.length; k++) {
    if (p[k].t !== "s") continue;
    if (p[k - 1]?.v !== "=") continue;
    const nome = p[k - 2]?.v;
    if (nome !== "feature" && nome !== "path") continue;
    const testo = righe[p[k].riga - 1] ?? "";
    const dopo = testo.slice(testo.indexOf(nome));
    rx.lastIndex = 0;
    const m = rx.exec(dopo);
    if (m) p[k].testo = m[1];
  }
  return p;
}

/// Il tipo di un blocco `impl`: dopo l'ultimo `for`, o dopo i generici.
function tipoImpl(p, da, a) {
  let k = da + 1;
  const testa = p.slice(k, a);
  const per = testa.map((x) => x.v).lastIndexOf("for");
  let seq = per >= 0 ? testa.slice(per + 1) : testa;
  if (per < 0 && seq[0]?.v === "<") {
    let livello = 0;
    let j = 0;
    for (; j < seq.length; j++) {
      if (seq[j].v === "<") livello++;
      else if (seq[j].v === ">" && --livello === 0) break;
    }
    seq = seq.slice(j + 1);
  }
  let nome = null;
  for (const x of seq) {
    if (x.v === "<" || x.v === "where") break;
    if (x.t === "i" && x.v !== "dyn" && x.v !== "mut") nome = x.v;
  }
  return nome;
}

/// I siti di un file e i moduli che dichiara in altri file. `contesto` è il
/// cammino dei moduli in linea (per la cartella dei sottomoduli).
export function siti(src) {
  const p = pezziConTesto(src);
  const trovati = [];
  const moduli = [];
  const feature = new Set();
  // La pila dei blocchi `{`: per ognuno che cosa l'ha aperto.
  const pila = [];
  let attesa = null; // { tipo: "fn" | "impl" | "mod" | "altro", nome, salta, feature }
  let attributi = { test: false, feature: [], percorso: null };
  // Le chiamate di `unconfined` aperte: la profondità delle parentesi.
  const libere = [];
  let parentesi = 0;
  const saltando = () => pila.some((b) => b.salta);
  const funzione = () => {
    for (let k = pila.length - 1; k >= 0; k--) {
      if (pila[k].tipo === "fn") {
        const impl = pila.slice(0, k).reverse().find((b) => b.tipo === "impl");
        return impl?.nome ? `${impl.nome}::${pila[k].nome}` : pila[k].nome;
      }
    }
    return "-";
  };
  const featureAttive = () => [...pila.flatMap((b) => b.feature), ...(attesa?.feature ?? []), ...attributi.feature];
  const cammino = () => pila.filter((b) => b.tipo === "mod").map((b) => b.nome);
  const azzera = () => {
    attributi = { test: false, feature: [], percorso: null };
  };

  for (let i = 0; i < p.length; i++) {
    const x = p[i];
    if (x.v === "#" && (p[i + 1]?.v === "[" || (p[i + 1]?.v === "!" && p[i + 2]?.v === "["))) {
      const fine = fineAttributo(p, i);
      const a = leggiAttributo(p, i, fine);
      for (const f of [...a.feature, ...a.nonFeature]) feature.add(f);
      // `#![…]` vale per il modulo intero: lo tiene il file.
      if (p[i + 1]?.v === "!") {
        if (a.test) return { siti: [], moduli: [], feature: [...feature], tuttoTest: true };
        if (a.feature.length) pila.push({ tipo: "file", feature: a.feature, salta: false, finto: true });
      } else {
        attributi.test ||= a.test;
        attributi.feature.push(...a.feature);
        attributi.percorso ??= a.percorso;
      }
      i = fine - 1;
      continue;
    }
    // `impl` e `trait` aprono un elemento solo all'inizio di un elemento: `impl
    // Fn(…)` in una firma, o `dyn Trait`, no.
    const inizio = [undefined, "}", ";", "{", "]", "unsafe", "pub", "default", ")"].includes(p[i - 1]?.v);
    if (
      x.t === "i" &&
      ((x.v === "fn" || x.v === "mod") || ((x.v === "impl" || x.v === "trait") && inizio && parentesi === 0)) &&
      p[i - 1]?.v !== "::"
    ) {
      if (x.v === "fn" && p[i + 1]?.t === "i") attesa = { tipo: "fn", nome: p[i + 1].v };
      else if (x.v === "impl") attesa = { tipo: "impl", da: i };
      else if (x.v === "trait" && p[i + 1]?.t === "i") attesa = { tipo: "impl", nome: p[i + 1].v };
      else if (x.v === "mod" && p[i + 1]?.t === "i") {
        if (p[i + 2]?.v === ";") {
          if (!attributi.test && !saltando()) {
            moduli.push({ nome: p[i + 1].v, percorso: attributi.percorso, dentro: cammino(), feature: featureAttive() });
          }
          azzera();
          i += 2;
          continue;
        }
        attesa = { tipo: "mod", nome: p[i + 1].v, percorso: attributi.percorso };
      }
      if (attesa) {
        attesa.salta = attributi.test;
        attesa.feature = attributi.feature;
        azzera();
      }
      continue;
    }
    if (x.v === "{") {
      if (attesa) {
        if (attesa.tipo === "impl" && attesa.nome === undefined) attesa.nome = tipoImpl(p, attesa.da, i);
        pila.push(attesa);
      } else {
        pila.push({ tipo: "blocco", salta: attributi.test, feature: attributi.feature });
      }
      attesa = null;
      azzera();
      continue;
    }
    if (x.v === "}") {
      pila.pop();
      azzera();
      continue;
    }
    if (x.v === ";") {
      // Un `fn` senza corpo (in un trait), un `use`, un'istruzione.
      attesa = null;
      azzera();
      continue;
    }
    if (x.v === "(") {
      parentesi++;
      continue;
    }
    if (x.v === ")") {
      if (libere.at(-1) === parentesi) libere.pop();
      parentesi--;
      continue;
    }
    if (x.t !== "i" || saltando()) continue;
    // Le dichiarazioni `use` non toccano il disco.
    if (inUse(p, i)) continue;
    const prim = primitiva(p, i);
    if (!prim) continue;
    if (prim === "unconfined" && p[i + 1]?.v === "(") libere.push(parentesi + 1);
    trovati.push({
      funzione: funzione(),
      primitiva: prim,
      riga: x.riga,
      feature: featureAttive(),
      libero: prim === "unconfined" || libere.length > 0,
    });
    if (attributi.test) {
      // Un'istruzione `#[cfg(test)]`: il sito non conta.
      trovati.pop();
    }
  }
  return { siti: trovati, moduli, feature: [...feature], tuttoTest: false };
}

/// Il pezzo `i` sta in una dichiarazione `use … ;`?
function inUse(p, i) {
  for (let k = i - 1; k >= 0 && k > i - 400; k--) {
    const v = p[k].v;
    if (v === "use" && p[k].t === "i") return true;
    if (v === ";") return false;
    // `use a::{b, c}`: la graffa di un gruppo segue `::`.
    if (v === "{" && p[k - 1]?.v !== "::") return false;
    // Un gruppo annidato chiuso (`{b::{c}, d}`) è seguito da una virgola.
    if (v === "}" && p[k + 1]?.v !== ",") return false;
  }
  return false;
}

/// La primitiva che comincia in `p[i]`, o `null`.
function primitiva(p, i) {
  const x = p[i];
  for (const pr of PRIMITIVE) {
    if (pr.nomi && pr.nomi.includes(x.v)) {
      if (pr.chiamata && p[i + 1]?.v !== "(" && !(p[i + 1]?.v === "::" && p[i + 2]?.v === "<")) continue;
      // `fn check_read(` è la definizione, non una chiamata.
      if (p[i - 1]?.v === "fn") continue;
      return pr.nome;
    }
    if (pr.percorso) {
      const [a, ...resto] = pr.percorso;
      if (x.v !== a) continue;
      // `a::b`: il primo pezzo non è la coda di un altro cammino (`std::fs`
      // conta, `foo::fs` no; `std::env::var` conta come `env::var`,
      // `std::fs::File::open` come `File::open`).
      const prima = p[i - 2]?.v;
      if (p[i - 1]?.v === "::" && prima !== "std" && !(prima === "fs" && a === "File")) continue;
      let k = i + 1;
      let ok = true;
      for (const r of resto) {
        if (p[k]?.v !== "::" || p[k + 1]?.v !== r) {
          ok = false;
          break;
        }
        k += 2;
      }
      if (!ok) continue;
      if (resto.length === 0) {
        // `fs` da solo: la chiamata di una funzione (`fs::read(…)`); un tipo
        // (`fs::Metadata`, `fs::File`) non tocca il disco.
        if (p[k]?.v !== "::") continue;
        const dopo = p[k + 1]?.v ?? "";
        if (!/^[a-z_]/.test(dopo) || !(p[k + 2]?.v === "(" || p[k + 2]?.v === "::")) continue;
        // `fs::read_dir` e `fs::canonicalize` hanno la loro primitiva.
        if (dopo === "read_dir" || dopo === "canonicalize") continue;
      }
      return pr.nome;
    }
  }
  return null;
}

// --- i file di un crate -----------------------------------------------------------

/// La cartella dei sottomoduli di un file: la sua per `lib.rs` e `mod.rs`,
/// `foo/` per `foo.rs`.
function cartellaModuli(file) {
  const base = path.basename(file);
  if (base === "lib.rs" || base === "main.rs" || base === "mod.rs") return path.dirname(file);
  return path.join(path.dirname(file), base.slice(0, -3));
}

/// Tutti i siti di un crate, seguendo i moduli da `src/lib.rs`.
function sitiDelCrate(vc, crate, featureViste) {
  const radice = path.join(vc, "crates", crate, "src", "lib.rs");
  const out = [];
  const coda = [{ file: radice, feature: [] }];
  const visti = new Set();
  while (coda.length) {
    const { file, feature } = coda.shift();
    if (visti.has(file)) continue;
    visti.add(file);
    const r = siti(leggi(file));
    r.feature.forEach((f) => featureViste.add(f));
    if (r.tuttoTest) continue;
    const rel = path.relative(vc, file).split(path.sep).join("/");
    for (const s of r.siti) out.push({ ...s, file: rel, feature: [...feature, ...s.feature] });
    for (const m of r.moduli) {
      const base = path.join(cartellaModuli(file), ...m.dentro);
      let figlio;
      if (m.percorso) {
        figlio = path.join(m.dentro.length ? base : path.dirname(file), m.percorso);
      } else {
        const a = path.join(base, `${m.nome}.rs`);
        const b = path.join(base, m.nome, "mod.rs");
        figlio = fs.existsSync(a) ? a : b;
      }
      if (!fs.existsSync(figlio)) throw new ErroreElenco(`${rel}: il modulo ${m.nome} non ha il suo file`);
      coda.push({ file: figlio, feature: [...feature, ...m.feature] });
    }
  }
  return out;
}

export function chiave(r) {
  return `${r.file}\t${r.funzione}\t${r.primitiva}`;
}

/// I siti del motore, uno per chiave, in ordine di chiave; per ognuno le righe,
/// le feature che lo spengono e se sta dentro `unconfined`.
export function estrai(vc = VECTORCRAFT, adattatore = ADATTATORE) {
  const featureViste = new Set();
  const perChiave = new Map();
  for (const crate of crateCompilati(vc, adattatore)) {
    for (const s of sitiDelCrate(vc, crate, featureViste)) {
      const k = chiave(s);
      const spento = s.feature.some((f) => SPENTE.includes(f));
      const v = perChiave.get(k);
      if (!v) perChiave.set(k, { file: s.file, funzione: s.funzione, primitiva: s.primitiva, righe: [s.riga], spento, libero: s.libero });
      else {
        v.righe.push(s.riga);
        // La chiave è spenta solo se lo sono tutti i suoi siti.
        v.spento &&= spento;
        v.libero ||= s.libero;
      }
    }
  }
  const sconosciute = [...featureViste].filter((f) => !SPENTE.includes(f) && !ACCESE.includes(f));
  const siti = [...perChiave.values()].sort((a, b) => (chiave(a) < chiave(b) ? -1 : chiave(a) > chiave(b) ? 1 : 0));
  return { siti, sconosciute };
}

// --- il file dell'elenco ----------------------------------------------------------

export function revisione(vc = VECTORCRAFT) {
  const rev = /^rev = "([0-9a-f]{40})"/m.exec(leggi(path.join(vc, "upstream.lock")))?.[1];
  if (!rev) throw new ErroreElenco("upstream.lock non dice la revisione");
  return rev;
}

export function intestazione(rev) {
  return (
    `# Dove il motore del disegno (VectorCraft ${rev}) tocca il disco. Le colonne file, funzione e ` +
    "primitiva vengono da `node tools/disegno-disco/elenco.mjs`; comandi, come, task e nota si scrivono " +
    "a mano dopo aver letto il codice (docs/architecture/disegno-completo.md#il-disco)."
  );
}

export function leggiElenco(testo) {
  const righe = testo.split(/\r?\n/);
  if (righe.at(-1) === "") righe.pop();
  const errori = [];
  const rev = /^# Dove il motore del disegno \(VectorCraft ([0-9a-f]{40})\) /.exec(righe[0] ?? "")?.[1];
  if (!rev) errori.push("la prima riga non è l'intestazione con la revisione di VectorCraft");
  if ((righe[1] ?? "") !== COLONNE.join("\t")) errori.push(`le colonne non sono «${COLONNE.join(" ")}»`);
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

export function scriviElenco(rev, righe) {
  return [intestazione(rev), COLONNE.join("\t"), ...righe.map((r) => COLONNE.map((c) => campo(r[c])).join("\t"))].join("\n") + "\n";
}

/// I comandi di una riga: `—` (nessun comando ci arriva) o id separati da
/// virgole; un id può nominare l'argomento della sua forma (`id:argomento`).
export function comandiDi(valore) {
  const v = valore.trim();
  if (v === "—") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, argomento] = s.split(":");
      return { id, argomento: argomento ?? null };
    });
}

/// Gli id della mappa (ogni fonte).
export function idDellaMappa(testo) {
  const ids = new Set();
  for (const riga of testo.split(/\r?\n/).slice(2)) {
    const id = riga.split("\t")[1];
    if (id) ids.add(id);
  }
  return ids;
}

/// I problemi dell'elenco rispetto ai siti estratti e alla mappa.
export function controlla(estratti, elenco, ids) {
  const problemi = [...elenco.errori];
  if (estratti.sconosciute.length) {
    problemi.push(`feature del motore che l'elenco non conosce (vanno in SPENTE o ACCESE): ${estratti.sconosciute.join(", ")}`);
  }
  const siti = new Map(estratti.siti.map((s) => [chiave(s), s]));
  const viste = new Set();
  for (const r of elenco.righe) {
    const k = chiave(r);
    const nome = `riga ${r.riga} (${r.file} · ${r.funzione} · ${r.primitiva})`;
    if (viste.has(k)) problemi.push(`${nome}: doppia`);
    viste.add(k);
    const s = siti.get(k);
    if (!s) problemi.push(`${nome}: il sito non c'è più nel motore`);
    if (!COME.includes(r.come)) {
      problemi.push(`${nome}: come «${r.come}» non è fra ${COME.join(", ")}`);
      continue;
    }
    if (!r.comandi.trim()) problemi.push(`${nome}: comandi vuoto (gli id della mappa, o «—» se nessun comando ci arriva)`);
    for (const c of comandiDi(r.comandi)) {
      if (!ids.has(c.id)) problemi.push(`${nome}: «${c.id}» non è una riga della mappa`);
      if (c.argomento !== null && r.come !== "kernel" && r.come !== "byte") {
        problemi.push(`${nome}: «${c.id}:${c.argomento}» nomina una forma, che vale solo per kernel e byte`);
      }
    }
    if ((r.come === "kernel" || r.come === "byte") && !/^T\d+$/.test(r.task)) problemi.push(`${nome}: una riga ${r.come} vuole il suo task`);
    if (r.task && !/^T\d+$/.test(r.task)) problemi.push(`${nome}: task «${r.task}» non è T<n>`);
    if (r.come === "escluso" && !/\bD(6|9|12)\b/.test(r.nota)) problemi.push(`${nome}: una riga esclusa dice il perché con D6, D9 o D12`);
    if ((r.come === "ambiente" || r.come === "nessuno") && comandiDi(r.comandi).length > 0) {
      problemi.push(`${nome}: una riga ${r.come} non nomina comandi (vuole «—»)`);
    }
    if ((r.come === "ambiente" || r.come === "nessuno") && !r.nota.trim()) problemi.push(`${nome}: una riga ${r.come} dice perché nella nota`);
    if (comandiDi(r.comandi).length === 0 && r.come !== "spento" && !r.nota.trim()) {
      problemi.push(`${nome}: nessun comando ci arriva: la nota dice perché`);
    }
    if (s) {
      if (s.spento && r.come !== "spento") problemi.push(`${nome}: sta dietro una feature spenta, è «spento»`);
      if (!s.spento && r.come === "spento") problemi.push(`${nome}: «spento», ma non sta dietro una feature spenta`);
      if (s.libero && r.come === "rifiutato") problemi.push(`${nome}: sta dentro unconfined, le radici non lo fermano: non è «rifiutato»`);
    }
  }
  for (const [k, s] of siti) {
    if (!viste.has(k)) problemi.push(`sito nuovo, senza riga: ${s.file} · ${s.funzione} · ${s.primitiva} (righe ${s.righe.join(", ")})`);
  }
  return problemi;
}

/// Le righe estratte con le colonne scritte a mano delle righe che c'erano.
export function rigenera(vecchie, estratti) {
  const prima = new Map(vecchie.map((r) => [chiave(r), r]));
  const nuove = [];
  const righe = estratti.map((s) => {
    const v = prima.get(chiave(s));
    if (!v) nuove.push(chiave(s));
    return {
      file: s.file,
      funzione: s.funzione,
      primitiva: s.primitiva,
      comandi: v?.comandi ?? "",
      come: v?.come ?? (s.spento ? "spento" : ""),
      task: v?.task ?? "",
      nota: v?.nota ?? "",
    };
  });
  const adesso = new Set(estratti.map(chiave));
  const sparite = vecchie.map(chiave).filter((k) => !adesso.has(k));
  return { righe, nuove, sparite };
}

function opzione(args, nome, predefinita) {
  const i = args.indexOf(nome);
  return i >= 0 ? path.resolve(args[i + 1]) : predefinita;
}

function main(args) {
  const vc = opzione(args, "--vectorcraft", VECTORCRAFT);
  const disco = opzione(args, "--disco", DISCO);
  const mappa = opzione(args, "--mappa", MAPPA);
  const estratti = estrai(vc);
  if (args.includes("--check")) {
    const elenco = leggiElenco(fs.existsSync(disco) ? leggi(disco) : "");
    const problemi = controlla(estratti, elenco, idDellaMappa(leggi(mappa)));
    if (elenco.rev && elenco.rev !== revisione(vc)) problemi.push(`l'elenco è di ${elenco.rev}, il motore di ${revisione(vc)}`);
    if (problemi.length) {
      console.error(`disegno-disco: ${problemi.length} problemi in ${path.relative(ROOT, disco) || disco}:\n- ${problemi.join("\n- ")}`);
      return 1;
    }
    console.log(`disegno-disco: ${estratti.siti.length} siti del motore, ognuno con la sua riga.`);
    return 0;
  }
  const vecchie = fs.existsSync(disco) ? leggiElenco(leggi(disco)).righe : [];
  const { righe, nuove, sparite } = rigenera(vecchie, estratti.siti);
  const testo = scriviElenco(revisione(vc), righe);
  if (args.includes("--stampa")) process.stdout.write(testo);
  else fs.writeFileSync(disco, testo);
  for (const k of nuove) console.error(`nuovo: ${k.replaceAll("\t", " · ")}`);
  for (const k of sparite) console.error(`sparito: ${k.replaceAll("\t", " · ")}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ErroreElenco)) throw e;
    console.error(`disegno-disco: ${e.message}`);
    process.exitCode = 1;
  }
}
