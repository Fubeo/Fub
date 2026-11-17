#!/usr/bin/env node
// Le baseline del banco visivo dal runner: la logica di
// `.github/workflows/baseline.yml` (il commit delle foto sul ramo della PR) e
// del riuso in `.github/workflows/ci.yml` (la corsa dopo quel commit rifà
// soltanto il banco visivo). Qui c'è solo ciò che si può provare senza rete:
// le chiamate a `gh` e a `git` restano nei workflow.
//
//   node baseline-dal-runner.mjs solo-banco <job>
//       esce 0 se nella corsa è caduto soltanto il banco visivo, 3 se no (il
//       motivo su stdout). <job>: i job della corsa, JSON o una riga per job.
//   node baseline-dal-runner.mjs convalida <zip> <baseline del ramo> <baseline di main> <uscita>
//       legge l'artefatto `banco-visivo-*` senza estrarlo alla cieca, copia in
//       <uscita> (che non deve esistere) le foto da committare e le elenca su
//       stdout, una per riga: `NUOVA <nome>` o `CAMBIATA <nome>`. Esce 1 e non
//       scrive niente se l'artefatto non è come lo scrive `bench/photos.mjs`.
//   node baseline-dal-runner.mjs riuso --corsa <json> --job <job> --genitori <file>
//       --diff <file> --repo <owner/nome> --workflow-id <id> --ramo <ramo>
//       --predefinito <ramo>
//       dice se la corsa può riusare l'esito della corsa precedente. Scrive
//       `riuso=true|false` in $GITHUB_OUTPUT e il perché in
//       $GITHUB_STEP_SUMMARY (su stdout se mancano); esce 0 in ogni caso.
//   node baseline-dal-runner.mjs --self-test
//       i casi, senza rete.
//
// L'artefatto è scritto dal codice della PR: ogni byte è un dato non fidato.
// Per questo lo zip si legge qui, voce per voce, e si scrivono soltanto file
// piatti con un nome che passa l'espressione regolare: niente `unzip`, che
// ricrea i link simbolici e scrive dove dice la voce.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

/** Il job del banco visivo e quello dei test, come li chiama `ci.yml`. */
export const VISIVO = "banco visivo (scene uguali alle baseline)";
export const CAMBIA = "cosa cambia";
// macOS è in pausa (docs/decisions/0245-macos-e-ios-in-pausa.md): non è nella
// matrice di `ci.yml`, e quindi nemmeno qui. I test di Windows girano in
// `PARTI_WINDOWS` macchine, e ognuna è un job col suo nome: «<parte>/<parti>».
export const PARTI_WINDOWS = 3;
export const TEST = [
  "build + test (ubuntu-latest)",
  ...Array.from({ length: PARTI_WINDOWS }, (_, i) => `build + test (windows-latest, ${i + 1}/${PARTI_WINDOWS})`),
];

/** Il nome di una foto, come lo compone `photoFilename` del banco. */
export const NOME_FOTO = /^[a-z0-9][a-z0-9-]*\.png$/;
/** Il percorso di una baseline nel repository. */
export const PERCORSO_BASELINE = /^apps\/client\/bench\/baseline\/[a-z0-9][a-z0-9-]*\.png$/;

/**
 * I limiti dell'artefatto. La baseline più grande oggi pesa meno di 200 KB e
 * sono meno di 400: i limiti lasciano un margine largo e fermano soltanto un
 * artefatto che non viene dal banco.
 */
export const LIMITI = {
  zip: 256 * 1024 * 1024,
  voci: 5000,
  foto: 2000,
  png: 5 * 1024 * 1024,
  lato: 8192,
};

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ------------------------------------------------------------------ i job

/** I job di una corsa: un array, `{ jobs: [...] }` o un oggetto JSON per riga. */
export function leggiJob(testo) {
  const pulito = testo.trim();
  if (pulito === "") return [];
  try {
    const dato = JSON.parse(pulito);
    if (Array.isArray(dato)) return dato;
    if (Array.isArray(dato?.jobs)) return dato.jobs;
    return [dato];
  } catch {
    return pulito.split(/\r?\n/).filter(Boolean).map((riga) => JSON.parse(riga));
  }
}

/**
 * Le ragioni per cui la corsa non è caduta *soltanto* sul banco visivo; vuoto
 * se il banco è rosso e ogni altro job è verde o saltato.
 */
export function soloBanco(job) {
  const motivi = [];
  const visivo = job.filter((j) => j.name === VISIVO);
  if (visivo.length !== 1) motivi.push(`il job «${VISIVO}» compare ${visivo.length} volte`);
  else if (visivo[0].conclusion !== "failure") motivi.push(`il banco visivo è ${visivo[0].conclusion}, non failure`);
  for (const j of job) {
    if (j.name === VISIVO) continue;
    if (j.conclusion !== "success" && j.conclusion !== "skipped") {
      motivi.push(`il job «${j.name}» è ${j.conclusion ?? j.status}`);
    }
  }
  return motivi;
}

// ------------------------------------------------------------------ lo zip

/** Il CRC-32 dello zip (polinomio 0xEDB88320). */
const TABELLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Un percorso di voce che nessun estrattore dovrebbe seguire. */
function percorsoPericoloso(nome) {
  if (nome === "" || nome.startsWith("/") || nome.includes("\\") || /[\x00-\x1f\x7f]/.test(nome)) return true;
  if (/^[A-Za-z]:/.test(nome)) return true;
  const parti = nome.replace(/\/$/, "").split("/");
  return parti.some((p) => p === "" || p === "." || p === "..");
}

/**
 * Le voci dello zip, dalla directory centrale. Rifiuta ciò che il banco non
 * scrive mai: zip64, voci cifrate, metodi diversi da «stored» e «deflate»,
 * percorsi con `..` o assoluti, link simbolici, nomi doppi.
 */
export function vociZip(buf) {
  if (buf.length > LIMITI.zip) throw new Error(`lo zip pesa ${buf.length} byte, più di ${LIMITI.zip}`);
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fine = i;
      break;
    }
  }
  if (fine < 0) throw new Error("non è uno zip: manca la fine della directory centrale");
  const disco = buf.readUInt16LE(fine + 4);
  const discoCd = buf.readUInt16LE(fine + 6);
  const quante = buf.readUInt16LE(fine + 10);
  const totali = buf.readUInt16LE(fine + 8);
  const misura = buf.readUInt32LE(fine + 12);
  const inizio = buf.readUInt32LE(fine + 16);
  if (disco !== 0 || discoCd !== 0 || quante !== totali) throw new Error("zip su più dischi");
  if (quante === 0xffff || misura === 0xffffffff || inizio === 0xffffffff) throw new Error("zip64 non previsto");
  if (quante > LIMITI.voci) throw new Error(`lo zip ha ${quante} voci, più di ${LIMITI.voci}`);
  if (inizio + misura > fine) throw new Error("directory centrale fuori dallo zip");

  const voci = [];
  const visti = new Set();
  let p = inizio;
  for (let n = 0; n < quante; n++) {
    if (p + 46 > fine || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`voce ${n}: intestazione centrale rotta`);
    const fatto = buf.readUInt16LE(p + 4) >> 8;
    const flag = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressi = buf.readUInt32LE(p + 20);
    const byte = buf.readUInt32LE(p + 24);
    const lNome = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lCommento = buf.readUInt16LE(p + 32);
    const attributi = buf.readUInt32LE(p + 38);
    const locale = buf.readUInt32LE(p + 42);
    if (p + 46 + lNome > fine) throw new Error(`voce ${n}: nome fuori dallo zip`);
    const nome = buf.subarray(p + 46, p + 46 + lNome).toString("latin1");
    p += 46 + lNome + lExtra + lCommento;

    if (percorsoPericoloso(nome)) throw new Error(`voce con un percorso pericoloso: ${JSON.stringify(nome)}`);
    if (visti.has(nome)) throw new Error(`voce doppia: ${nome}`);
    visti.add(nome);
    const tipo = fatto === 3 ? (attributi >>> 16) & 0o170000 : 0;
    const cartella = nome.endsWith("/");
    if (tipo === 0o120000) throw new Error(`link simbolico nell'artefatto: ${nome}`);
    if (tipo !== 0 && tipo !== 0o100000 && !(cartella && tipo === 0o040000)) {
      throw new Error(`voce che non è un file: ${nome}`);
    }
    if (flag & 0x1) throw new Error(`voce cifrata: ${nome}`);
    if (compressi === 0xffffffff || byte === 0xffffffff || locale === 0xffffffff) throw new Error(`zip64 non previsto: ${nome}`);
    voci.push({ nome, cartella, metodo, crc, compressi, byte, locale });
  }
  return voci;
}

/** I byte di una voce, decompressi e controllati contro misura e CRC. */
export function datiVoce(buf, voce, massimo) {
  if (voce.metodo !== 0 && voce.metodo !== 8) throw new Error(`${voce.nome}: metodo di compressione ${voce.metodo}`);
  if (voce.byte > massimo) throw new Error(`${voce.nome}: ${voce.byte} byte, più di ${massimo}`);
  const p = voce.locale;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`${voce.nome}: intestazione locale rotta`);
  const lNome = buf.readUInt16LE(p + 26);
  const lExtra = buf.readUInt16LE(p + 28);
  if (buf.subarray(p + 30, p + 30 + lNome).toString("latin1") !== voce.nome) {
    throw new Error(`${voce.nome}: il nome locale non è quello centrale`);
  }
  const da = p + 30 + lNome + lExtra;
  if (da + voce.compressi > buf.length) throw new Error(`${voce.nome}: dati fuori dallo zip`);
  const grezzi = buf.subarray(da, da + voce.compressi);
  let dati;
  if (voce.metodo === 0) dati = Buffer.from(grezzi);
  else {
    try {
      dati = zlib.inflateRawSync(grezzi, { maxOutputLength: massimo });
    } catch (e) {
      throw new Error(`${voce.nome}: deflate non valido o troppo grande (${e.code ?? e.message})`);
    }
  }
  if (dati.length !== voce.byte) throw new Error(`${voce.nome}: ${dati.length} byte invece di ${voce.byte}`);
  if (crc32(dati) !== voce.crc) throw new Error(`${voce.nome}: CRC sbagliato`);
  return dati;
}

// ------------------------------------------------------------------ le foto

/** Larghezza e altezza di un PNG, dall'IHDR; `null` se non è un PNG. */
export function misuraPng(dati) {
  if (dati.length < 24 || !dati.subarray(0, 8).equals(FIRMA_PNG)) return null;
  if (dati.readUInt32BE(8) !== 13 || dati.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { larghezza: dati.readUInt32BE(16), altezza: dati.readUInt32BE(20) };
}

/** Il file regolare `nome` in `dir`; `null` se non c'è. Un link è un errore. */
function fileRegolare(dir, nome) {
  if (!dir) return null;
  const dove = path.join(dir, nome);
  let info;
  try {
    info = fs.lstatSync(dove);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  if (!info.isFile()) throw new Error(`${dove} non è un file regolare`);
  return dove;
}

/**
 * Le foto da committare, dall'artefatto `zip` (un Buffer). Come lo script a
 * mano: **nuova** se il ramo non ha la baseline, **cambiata** se il banco ha
 * scritto la differenza o se la misura non è più quella della baseline (il
 * banco non scrive la differenza fra due misure diverse). Una foto la cui
 * baseline c'è soltanto su `main` è di una scena arrivata da `main`, non della
 * PR: si lascia stare. Restituisce `{ nuove, cambiate, uguali, ignorate, dati }`.
 */
export function classifica(zip, baselineRamo, baselineMain) {
  const voci = vociZip(zip);
  const attuali = new Map();
  const differenze = new Set();
  const ignorate = [];
  for (const voce of voci) {
    const [cartella, ...resto] = voce.nome.split("/");
    if (cartella !== "attuale" && cartella !== "differenze") {
      ignorate.push(voce.nome);
      continue;
    }
    if (voce.cartella) {
      if (resto.filter(Boolean).length === 0) continue;
      throw new Error(`cartella inattesa nell'artefatto: ${voce.nome}`);
    }
    if (resto.length !== 1 || !NOME_FOTO.test(resto[0])) throw new Error(`nome di foto non valido: ${voce.nome}`);
    const nome = resto[0];
    const dati = datiVoce(zip, voce, LIMITI.png);
    const misura = misuraPng(dati);
    if (!misura) throw new Error(`${voce.nome} non è un PNG`);
    if (misura.larghezza === 0 || misura.altezza === 0 || misura.larghezza > LIMITI.lato || misura.altezza > LIMITI.lato) {
      throw new Error(`${voce.nome}: misura ${misura.larghezza}×${misura.altezza} fuori dai limiti`);
    }
    if (cartella === "attuale") attuali.set(nome, { dati, misura });
    else differenze.add(nome);
  }
  if (attuali.size + differenze.size > LIMITI.foto) throw new Error(`più di ${LIMITI.foto} foto nell'artefatto`);
  for (const nome of differenze) {
    if (!attuali.has(nome)) throw new Error(`differenze/${nome} senza attuale/${nome}`);
  }

  const nuove = [];
  const cambiate = [];
  const soloInMain = [];
  let uguali = 0;
  const dati = new Map();
  for (const nome of [...attuali.keys()].sort()) {
    const foto = attuali.get(nome);
    const prima = fileRegolare(baselineRamo, nome);
    if (!prima) {
      if (fileRegolare(baselineMain, nome)) soloInMain.push(nome);
      else {
        nuove.push(nome);
        dati.set(nome, foto.dati);
      }
      continue;
    }
    const intestazione = Buffer.alloc(24);
    const fd = fs.openSync(prima, "r");
    try {
      fs.readSync(fd, intestazione, 0, 24, 0);
    } finally {
      fs.closeSync(fd);
    }
    const misuraPrima = misuraPng(intestazione);
    const altraMisura =
      !misuraPrima || misuraPrima.larghezza !== foto.misura.larghezza || misuraPrima.altezza !== foto.misura.altezza;
    if (differenze.has(nome) || altraMisura) {
      cambiate.push(nome);
      dati.set(nome, foto.dati);
    } else uguali++;
  }
  return { nuove, cambiate, uguali, soloInMain, ignorate, dati };
}

/** `classifica`, poi scrive le foto in `uscita` (creata qui: non deve esistere). */
export function convalida(zipFile, baselineRamo, baselineMain, uscita) {
  const esito = classifica(fs.readFileSync(zipFile), baselineRamo, baselineMain);
  fs.mkdirSync(uscita);
  for (const [nome, dati] of esito.dati) fs.writeFileSync(path.join(uscita, nome), dati, { flag: "wx" });
  return esito;
}

// ------------------------------------------------------------------ il riuso

/**
 * Se la corsa di `ci.yml` può riusare l'esito di `corsa` per ogni job tranne
 * il banco visivo. Vale soltanto se il commit della corsa ha un solo genitore,
 * è il `head_sha` di `corsa`, e aggiunge o cambia soltanto baseline; se
 * `corsa` è una `pull_request` dello stesso repository e workflow, sullo stesso
 * ramo (mai il predefinito), con la PR pronta (i test sui tre sistemi) e ogni
 * job verde o saltato tranne il banco visivo, che è caduto.
 */
export function valutaRiuso({ corsa, job, genitori, diff, repo, workflowId, ramo, predefinito }) {
  const motivi = [];
  if (corsa?.repository?.full_name !== repo) motivi.push(`la corsa non è di ${repo}`);
  if (corsa?.head_repository?.full_name !== repo) motivi.push("la corsa viene da un fork");
  if (String(corsa?.workflow_id) !== String(workflowId)) motivi.push("la corsa è di un altro workflow");
  if (corsa?.event !== "pull_request") motivi.push(`la corsa è un evento ${corsa?.event}, non pull_request`);
  if (corsa?.status !== "completed") motivi.push(`la corsa è ${corsa?.status}, non completata`);
  if (!ramo || ramo === predefinito) motivi.push(`il ramo ${ramo || "(vuoto)"} è quello predefinito`);
  else if (corsa?.head_branch !== ramo) motivi.push(`la corsa è del ramo ${corsa?.head_branch}, non di ${ramo}`);

  const ids = genitori.trim().split(/\s+/);
  if (ids.length !== 2) motivi.push(`il commit ha ${Math.max(ids.length - 1, 0)} genitori, non uno`);
  else if (ids[1] !== corsa?.head_sha) motivi.push(`il genitore ${ids[1]} non è la testa della corsa (${corsa?.head_sha})`);

  const righe = diff.split(/\r?\n/).filter(Boolean);
  if (righe.length === 0) motivi.push("il commit non cambia niente");
  for (const riga of righe) {
    const m = riga.match(/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([AM])\t(.+)$/);
    if (!m) motivi.push(`il commit fa altro che aggiungere o cambiare un file: ${riga}`);
    else if (m[2] !== "100644") motivi.push(`${m[4]} non è un file normale (${m[2]})`);
    else if (!PERCORSO_BASELINE.test(m[4])) motivi.push(`il commit tocca ${m[4]}, che non è una baseline`);
  }

  motivi.push(...soloBanco(job));
  for (const nome of TEST) {
    const j = job.find((x) => x.name === nome);
    if (!j || j.conclusion !== "success") motivi.push(`«${nome}» non è verde nella corsa (la PR era in bozza?)`);
  }
  const riusati = job.map((j) => j.name).filter((n) => n !== VISIVO && n !== CAMBIA);
  return { riuso: motivi.length === 0, motivi, riusati };
}

// ------------------------------------------------------------------ CLI

function opzioni(args) {
  const o = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || args[i + 1] === undefined) throw new Error(`opzione non valida: ${args[i]}`);
    o[args[i].slice(2)] = args[i + 1];
  }
  return o;
}

function main(args) {
  const [comando, ...resto] = args;
  if (comando === "--self-test") return selfTest();
  if (comando === "solo-banco" && resto.length === 1) {
    const motivi = soloBanco(leggiJob(fs.readFileSync(resto[0], "utf8")));
    if (motivi.length === 0) {
      console.log("la corsa è caduta soltanto sul banco visivo");
      return 0;
    }
    for (const m of motivi) console.log(`no: ${m}`);
    return 3;
  }
  if (comando === "convalida" && resto.length === 4) {
    const [zip, ramo, principale, uscita] = resto;
    let esito;
    try {
      esito = convalida(zip, ramo, principale, uscita);
    } catch (e) {
      console.error(`artefatto rifiutato: ${e.message}`);
      return 1;
    }
    for (const n of esito.nuove) console.log(`NUOVA ${n}`);
    for (const n of esito.cambiate) console.log(`CAMBIATA ${n}`);
    console.error(
      `${esito.nuove.length} nuove, ${esito.cambiate.length} cambiate, ${esito.uguali} uguali` +
        (esito.soloInMain.length ? `, ${esito.soloInMain.length} con la baseline soltanto su main (lasciate stare)` : "") +
        `, ${esito.ignorate.length} voci fuori da attuale/ e differenze/ ignorate`,
    );
    return 0;
  }
  if (comando === "riuso") {
    const o = opzioni(resto);
    const esito = valutaRiuso({
      corsa: JSON.parse(fs.readFileSync(o.corsa, "utf8")),
      job: leggiJob(fs.readFileSync(o.job, "utf8")),
      genitori: fs.readFileSync(o.genitori, "utf8"),
      diff: fs.readFileSync(o.diff, "utf8"),
      repo: o.repo,
      workflowId: o["workflow-id"],
      ramo: o.ramo,
      predefinito: o.predefinito,
    });
    const id = JSON.parse(fs.readFileSync(o.corsa, "utf8")).id;
    const riepilogo = esito.riuso
      ? `### Riuso della corsa ${id}\n\nIl commit cambia soltanto baseline del banco visivo: questi job contano come nella corsa ${id} sul commit padre, e qui gira soltanto il banco visivo.\n\n${esito.riusati.map((n) => `- ${n}`).join("\n")}\n`
      : `### Nessun riuso della corsa ${id}\n\nGira la CI completa, perché:\n\n${esito.motivi.map((m) => `- ${m}`).join("\n")}\n`;
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, riepilogo);
    else console.log(riepilogo);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `riuso=${esito.riuso}\n`);
    console.log(`riuso=${esito.riuso}`);
    return 0;
  }
  console.error("uso: vedi l'intestazione di .github/scripts/baseline-dal-runner.mjs");
  return 2;
}

// ------------------------------------------------------------------ autoprova

/** Uno zip in memoria: `[nome, dati, { metodo, link, cartella }]`. */
function zipDi(voci) {
  const locali = [];
  const centrali = [];
  let offset = 0;
  for (const [nome, dati = Buffer.alloc(0), { metodo = 8, link = false } = {}] of voci) {
    const n = Buffer.from(nome, "latin1");
    const corpo = metodo === 8 ? zlib.deflateRawSync(dati) : dati;
    const crc = crc32(dati);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(metodo, 8);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(corpo.length, 18);
    l.writeUInt32LE(dati.length, 22);
    l.writeUInt16LE(n.length, 26);
    locali.push(l, n, corpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(corpo.length, 20);
    c.writeUInt32LE(dati.length, 24);
    c.writeUInt16LE(n.length, 28);
    const modo = link ? 0o120777 : nome.endsWith("/") ? 0o040755 : 0o100644;
    c.writeUInt32LE((modo << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    centrali.push(c, n);
    offset += 30 + n.length + corpo.length;
  }
  const cd = Buffer.concat(centrali);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(voci.length, 8);
  e.writeUInt16LE(voci.length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locali, cd, e]);
}

/** Un PNG quanto basta: firma, IHDR della misura data, qualche byte. */
function png(larghezza = 10, altezza = 10, seme = 0) {
  const b = Buffer.alloc(40, seme);
  FIRMA_PNG.copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(larghezza, 16);
  b.writeUInt32BE(altezza, 20);
  return b;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-dal-runner-"));
  const casi = [];
  const prova = (nome, fn) => {
    try {
      casi.push([nome, fn() === true]);
    } catch (e) {
      casi.push([`${nome} (eccezione: ${e.message})`, false]);
    }
  };
  const rifiuta = (voci, ramo, attesa) => {
    try {
      classifica(zipDi(voci), ramo, null);
      return false;
    } catch (e) {
      return attesa.test(e.message);
    }
  };
  try {
    const ramo = path.join(tmp, "ramo");
    const principale = path.join(tmp, "main");
    fs.mkdirSync(ramo);
    fs.mkdirSync(principale);
    fs.writeFileSync(path.join(ramo, "uguale-dark.png"), png(10, 10, 1));
    fs.writeFileSync(path.join(ramo, "cambiata-dark.png"), png(10, 10, 1));
    fs.writeFileSync(path.join(ramo, "misura-dark.png"), png(10, 10, 1));
    fs.writeFileSync(path.join(principale, "da-main-dark.png"), png());

    prova("nuova, cambiata, cambiata di misura, uguale e solo in main", () => {
      const zip = zipDi([
        ["attuale/"],
        ["attuale/nuova-light.png", png()],
        ["attuale/uguale-dark.png", png(10, 10, 2)],
        ["attuale/cambiata-dark.png", png(10, 10, 3)],
        ["differenze/cambiata-dark.png", png()],
        ["attuale/misura-dark.png", png(12, 10), { metodo: 0 }],
        ["attuale/da-main-dark.png", png()],
        ["foglio-di-contatto.html", Buffer.from("<html>")],
        ["a11y/qualcosa.json", Buffer.from("{}")],
      ]);
      const uscita = path.join(tmp, "uscita");
      const file = path.join(tmp, "a.zip");
      fs.writeFileSync(file, zip);
      const e = convalida(file, ramo, principale, uscita);
      return (
        e.nuove.join() === "nuova-light.png" &&
        e.cambiate.join() === "cambiata-dark.png,misura-dark.png" &&
        e.uguali === 1 &&
        e.soloInMain.join() === "da-main-dark.png" &&
        e.ignorate.length === 2 &&
        fs.readdirSync(uscita).sort().join() === "cambiata-dark.png,misura-dark.png,nuova-light.png" &&
        fs.readFileSync(path.join(uscita, "cambiata-dark.png")).equals(png(10, 10, 3))
      );
    });
    prova("un PNG finto si rifiuta", () => rifiuta([["attuale/x.png", Buffer.from("non sono un png, davvero")]], ramo, /non è un PNG/));
    prova("un nome con .. si rifiuta", () => rifiuta([["attuale/../../etc/x.png", png()]], ramo, /pericoloso/));
    prova("un .. fuori da attuale/ si rifiuta lo stesso", () => rifiuta([["altro/../x", png()]], ramo, /pericoloso/));
    prova("un percorso assoluto si rifiuta", () => rifiuta([["/attuale/x.png", png()]], ramo, /pericoloso/));
    prova("un link simbolico si rifiuta", () => rifiuta([["attuale/x.png", Buffer.from("/etc/passwd"), { link: true }]], ramo, /link simbolico/));
    prova("un nome che non è di una foto si rifiuta", () => rifiuta([["attuale/X Y.png", png()]], ramo, /nome di foto/));
    prova("una sottocartella di attuale/ si rifiuta", () => rifiuta([["attuale/a/x.png", png()]], ramo, /nome di foto/));
    prova("una differenza senza la foto si rifiuta", () => rifiuta([["differenze/x.png", png()]], ramo, /senza attuale/));
    prova("una voce doppia si rifiuta", () => rifiuta([["attuale/x.png", png()], ["attuale/x.png", png()]], ramo, /doppia/));
    prova("un PNG oltre il limite si rifiuta", () =>
      rifiuta([["attuale/x.png", Buffer.concat([png(), Buffer.alloc(LIMITI.png)])]], ramo, /più di/),
    );
    prova("un CRC sbagliato si rifiuta", () => {
      const zip = zipDi([["attuale/x.png", png(), { metodo: 0 }]]);
      zip[30 + "attuale/x.png".length + 30] ^= 0xff;
      try {
        classifica(zip, ramo, null);
        return false;
      } catch (e) {
        return /CRC/.test(e.message);
      }
    });
    prova("i file fuori da attuale/ e differenze/ si ignorano", () => {
      const e = classifica(zipDi([["foglio-di-contatto.html", Buffer.from("x")], ["moto/x.bin", Buffer.from("y")]]), ramo, null);
      return e.ignorate.length === 2 && e.dati.size === 0;
    });
    prova("una baseline del ramo che è un link si rifiuta", () => {
      const r = path.join(tmp, "ramo-link");
      fs.mkdirSync(r);
      fs.symlinkSync("/etc/hostname", path.join(r, "x.png"));
      return rifiuta([["attuale/x.png", png()]], r, /non è un file regolare/);
    });
    prova("l'uscita che esiste già non si riusa", () => {
      const file = path.join(tmp, "b.zip");
      fs.writeFileSync(file, zipDi([["attuale/y.png", png()]]));
      try {
        convalida(file, ramo, null, ramo);
        return false;
      } catch (e) {
        return e.code === "EEXIST";
      }
    });

    const verdi = [CAMBIA, "invarianti (abi↔WIT, additività, dipendenze)", ...TEST, "la WebView vera (WebKitGTK, S1–S3)"].map(
      (name) => ({ name, status: "completed", conclusion: "success" }),
    );
    const job = [...verdi, { name: VISIVO, status: "completed", conclusion: "failure" }];
    const padre = "a".repeat(40);
    const base = {
      corsa: {
        id: 7,
        repository: { full_name: "Fubeo/Fub" },
        head_repository: { full_name: "Fubeo/Fub" },
        workflow_id: 42,
        event: "pull_request",
        status: "completed",
        head_branch: "feat/x",
        head_sha: padre,
      },
      job,
      genitori: `${"b".repeat(40)} ${padre}\n`,
      diff: `:100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} M\tapps/client/bench/baseline/kit-dark.png\n:000000 100644 ${"0".repeat(40)} ${"3".repeat(40)} A\tapps/client/bench/baseline/nuova-light.png\n`,
      repo: "Fubeo/Fub",
      workflowId: "42",
      ramo: "feat/x",
      predefinito: "main",
    };
    const riuso = (over) => valutaRiuso({ ...base, ...over });
    prova("riuso: tutto in regola", () => {
      const e = riuso({});
      return e.riuso && e.riusati.length === verdi.length - 1 && !e.riusati.includes(VISIVO);
    });
    prova("riuso: un altro job rosso", () => !riuso({ job: job.map((j) => (j.name === TEST[1] ? { ...j, conclusion: "failure" } : j)) }).riuso);
    prova("riuso: un job annullato", () => !riuso({ job: job.map((j) => (j.name === CAMBIA ? { ...j, conclusion: "cancelled" } : j)) }).riuso);
    prova("riuso: test soltanto su Linux (bozza)", () => !riuso({ job: job.filter((j) => !j.name.includes("windows")) }).riuso);
    prova("riuso: una parte di Windows che manca", () => !riuso({ job: job.filter((j) => j.name !== TEST.at(-1)) }).riuso);
    prova("riuso: un job saltato va bene", () => riuso({ job: [...job, { name: "altro", status: "completed", conclusion: "skipped" }] }).riuso);
    prova("riuso: banco visivo verde (non c'era niente da rifare)", () => !riuso({ job: job.map((j) => (j.name === VISIVO ? { ...j, conclusion: "success" } : j)) }).riuso);
    prova("riuso: il diff tocca un file che non è una baseline", () => !riuso({ diff: `${base.diff}:100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} M\tapps/client/src/main.ts\n` }).riuso);
    prova("riuso: una baseline cancellata", () => !riuso({ diff: `:100644 000000 ${"1".repeat(40)} ${"0".repeat(40)} D\tapps/client/bench/baseline/kit-dark.png\n` }).riuso);
    prova("riuso: una baseline che è un link", () => !riuso({ diff: `:000000 120000 ${"0".repeat(40)} ${"1".repeat(40)} A\tapps/client/bench/baseline/kit-dark.png\n` }).riuso);
    prova("riuso: il diff vuoto", () => !riuso({ diff: "" }).riuso);
    prova("riuso: padre diverso", () => !riuso({ genitori: `${"b".repeat(40)} ${"c".repeat(40)}\n` }).riuso);
    prova("riuso: commit di merge", () => !riuso({ genitori: `${"b".repeat(40)} ${padre} ${"c".repeat(40)}\n` }).riuso);
    prova("riuso: corsa da un fork", () => !riuso({ corsa: { ...base.corsa, head_repository: { full_name: "altro/Fub" } } }).riuso);
    prova("riuso: corsa di un altro workflow", () => !riuso({ workflowId: "43" }).riuso);
    prova("riuso: corsa lanciata a mano", () => !riuso({ corsa: { ...base.corsa, event: "workflow_dispatch" } }).riuso);
    prova("riuso: corsa non finita", () => !riuso({ corsa: { ...base.corsa, status: "in_progress" } }).riuso);
    prova("riuso: sul ramo predefinito mai", () => !riuso({ ramo: "main", corsa: { ...base.corsa, head_branch: "main" } }).riuso);
    prova("riuso: corsa di un altro ramo", () => !riuso({ ramo: "feat/y" }).riuso);

    prova("solo-banco: soltanto il banco rosso", () => soloBanco(job).length === 0);
    prova("solo-banco: rosso anche altro", () => soloBanco(job.map((j) => (j.name === TEST[0] ? { ...j, conclusion: "failure" } : j))).length === 1);
    prova("leggiJob: una riga per job", () => leggiJob('{"name":"a"}\n{"name":"b"}\n').length === 2);
    prova("leggiJob: { jobs }", () => leggiJob('{"jobs":[{"name":"a"}]}').length === 1);

    // I nomi qui sopra devono essere quelli di `ci.yml`: un job rinominato
    // spegnerebbe il riuso, o peggio lo accenderebbe a vuoto.
    const ci = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "workflows", "ci.yml"), "utf8");
    // La matrice di `test` per una PR pronta, quella che dà i nomi di `TEST`.
    const matrice = ci.match(/\|\| '(\[\{"os":"ubuntu-latest"[^']*\])'\) \}\}/)?.[1];
    const nomeDi = ({ os, parte, parti }) => `build + test (${os}${parti > 1 ? `, ${parte}/${parti}` : ""})`;
    prova("ci.yml: i nomi dei job sono questi", () =>
      ci.includes(`name: ${VISIVO}\n`) &&
      ci.includes(`name: ${CAMBIA}\n`) &&
      ci.includes("name: build + test (${{ matrix.os }}${{ matrix.parti > 1 && format(', {0}/{1}', matrix.parte, matrix.parti) || '' }})\n") &&
      matrice !== undefined &&
      JSON.stringify(JSON.parse(matrice).map(nomeDi)) === JSON.stringify(TEST),
    );
    prova("ci.yml: il banco visivo non si salta mai col riuso", () => {
      const blocco = ci.split(/\n  visual:\n/)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/)[0] ?? "";
      return blocco.includes(VISIVO) && !blocco.includes("riuso");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const falliti = casi.filter(([, ok]) => !ok);
  for (const [nome] of falliti) console.error(`autoprova fallita: ${nome}`);
  if (falliti.length) return 1;
  console.log(`autoprova: ${casi.length} casi delle baseline dal runner`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
