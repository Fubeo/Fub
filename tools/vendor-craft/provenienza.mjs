#!/usr/bin/env node
// La provenienza delle copie in `vendor/`. Due specie: i motori Craft di
// `motori.mjs` (un repository a una revisione, più le patch: li verifica
// `vendor.mjs`) e i dati di `dati.mjs` (un file singolo da un URL fisso, senza
// patch: li verifica questo script).
//
//   node tools/vendor-craft/provenienza.mjs elenco [--vendor <cartella>] [--motori <file>]… [--dati <file>]…
//   node tools/vendor-craft/provenienza.mjs check [<dato>] [--radice <cartella>]
//   node tools/vendor-craft/provenienza.mjs <dato> verify-upstream [--radice <cartella>]
//   node tools/vendor-craft/provenienza.mjs self-test
//
// `elenco` controlla che ogni cartella di `vendor/` sia un motore o un dato, e
// stampa su una riga il JSON `{"motori": […], "dati": […]}` per le matrici del
// workflow `motori-provenienza.yml`. Gli elenchi sono l'unione di tutti i file
// `--motori` e `--dati` (di solito quelli della PR e della base), così togliere
// una voce dall'elenco non la toglie dalla verifica; senza file usa quelli di
// questa cartella. Un nome che è insieme motore e dato è un errore.
//
// `check` (senza rete, in CI) controlla che la cartella di ogni dato abbia
// soltanto il file e `UPSTREAM.md`, e che il file abbia lo sha256 di
// `dati.mjs`.
//
// `verify-upstream` (con rete) riscarica l'URL del dato e confronta il suo
// sha256 con quello del file nel checkout. Un errore di rete ha un secondo
// tentativo dopo 30 s. Un'impronta diversa è rossa subito: o la copia è stata
// toccata, o l'upstream è cambiato e la copia va aggiornata.
//
// `--radice` legge `vendor/` da un'altra cartella invece che dal repository
// (le prove su copie temporanee). Uscite: 0 a posto, 1 una copia o un elenco
// sbagliati, 2 l'upstream non si raggiunge.
//
// Niente dipendenze npm, e nessun dato personale nella richiesta: né
// intestazioni proprie né credenziali.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(QUI, "../..");
const MASSIMO = 32 * 1024 * 1024;
const PAUSA_MS = 30_000;

/// Una copia o un elenco sbagliati: uscita 1.
class Male extends Error {}
/// L'upstream non si raggiunge: uscita 2.
class Rete extends Error {}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/// I controlli di forma di una voce di `dati.mjs`.
export function validaDato(id, dato) {
  const male = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) male.push(`${id}: il nome dev'essere minuscolo, cifre e trattini`);
  if (!dato || typeof dato !== "object") return [`${id}: la voce non è un oggetto`];
  if (typeof dato.nome !== "string" || !dato.nome.trim()) male.push(`${id}: manca nome`);
  let url;
  try {
    url = new URL(dato.url);
  } catch {
    male.push(`${id}: url non è un URL`);
  }
  if (url && url.protocol !== "https:") male.push(`${id}: url dev'essere https`);
  if (url && (url.username || url.password)) male.push(`${id}: url non porta credenziali`);
  if (typeof dato.file !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dato.file) || dato.file === "UPSTREAM.md") {
    male.push(`${id}: file dev'essere un nome semplice, diverso da UPSTREAM.md`);
  }
  if (typeof dato.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(dato.sha256)) male.push(`${id}: sha256 dev'essere 64 cifre esadecimali minuscole`);
  if (typeof dato.licenza !== "string" || !dato.licenza.trim()) male.push(`${id}: manca licenza`);
  return male;
}

/// Le cartelle di `vendor/` contro gli elenchi. `motori` e `dati` sono liste
/// di oggetti (`MOTORI`, `DATI`), una per file letto.
export function elenco(cartelle, motori, dati) {
  const nomiMotori = new Set(motori.flatMap((m) => Object.keys(m)));
  const nomiDati = new Set(dati.flatMap((d) => Object.keys(d)));
  const male = [];
  for (const d of dati) for (const [id, voce] of Object.entries(d)) male.push(...validaDato(id, voce));
  for (const id of nomiDati) {
    if (nomiMotori.has(id)) male.push(`${id} è insieme un motore (motori.mjs) e un dato (dati.mjs): dev'essere una cosa sola`);
  }
  for (const nome of cartelle) {
    if (!nomiMotori.has(nome) && !nomiDati.has(nome)) {
      male.push(`vendor/${nome} non è in tools/vendor-craft/motori.mjs né in tools/vendor-craft/dati.mjs: la sua provenienza non si verifica`);
    }
  }
  if (male.length) throw new Male([...new Set(male)].join("\n"));
  return { motori: [...nomiMotori].sort(), dati: [...nomiDati].sort() };
}

/// La copia di un dato nel checkout: cartella con il file e `UPSTREAM.md`
/// soltanto, file con lo sha256 dichiarato.
export function controlla(radice, id, dato) {
  const male = validaDato(id, dato);
  if (male.length) throw new Male(male.join("\n"));
  const cartella = path.join(radice, "vendor", id);
  if (!fs.existsSync(cartella)) throw new Male(`vendor/${id} non c'è, ma dati.mjs lo dichiara`);
  const voci = fs.readdirSync(cartella).sort();
  const attese = [dato.file, "UPSTREAM.md"].sort();
  const estranee = voci.filter((v) => !attese.includes(v));
  const mancanti = attese.filter((v) => !voci.includes(v));
  if (estranee.length) throw new Male(`vendor/${id} ha file che dati.mjs non dichiara: ${estranee.join(", ")}`);
  if (mancanti.length) throw new Male(`vendor/${id} non ha ${mancanti.join(", ")}`);
  const trovato = sha256(fs.readFileSync(path.join(cartella, dato.file)));
  if (trovato !== dato.sha256) {
    throw new Male(
      `vendor/${id}/${dato.file} ha sha256 ${trovato}, tools/vendor-craft/dati.mjs dichiara ${dato.sha256}: ` +
        `la copia non si modifica a mano, si riscarica (passi in vendor/${id}/UPSTREAM.md)`,
    );
  }
  return trovato;
}

/// Scarica `url` con `fetch` di Node: nessuna intestazione propria, niente
/// credenziali, un tetto ai byte e al tempo.
async function scaricaDavvero(url) {
  let risposta;
  try {
    risposta = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new Rete(`${url}: ${error.cause?.message ?? error.message}`);
  }
  if (!risposta.ok) throw new Rete(`${url}: HTTP ${risposta.status}`);
  if (new URL(risposta.url).protocol !== "https:") throw new Male(`${url} rimanda fuori da https: ${risposta.url}`);
  const bytes = Buffer.from(await risposta.arrayBuffer());
  if (bytes.length > MASSIMO) throw new Male(`${url}: più di ${MASSIMO} byte`);
  return bytes;
}

/// Riscarica il dato e confronta l'impronta con il file nel checkout. `scarica`
/// e `pausa` si sostituiscono nella prova.
export async function verificaUpstream(radice, id, dato, { scarica = scaricaDavvero, pausa = PAUSA_MS, avvisa = console.warn } = {}) {
  const male = validaDato(id, dato);
  if (male.length) throw new Male(male.join("\n"));
  const file = path.join(radice, "vendor", id, dato.file);
  if (!fs.existsSync(file)) throw new Male(`vendor/${id}/${dato.file} non c'è nel checkout`);
  const copia = sha256(fs.readFileSync(file));
  let bytes;
  try {
    bytes = await scarica(dato.url);
  } catch (error) {
    if (!(error instanceof Rete)) throw error;
    avvisa(`${id}: ${error.message}; un secondo tentativo fra ${Math.round(pausa / 1000)} s`);
    await new Promise((fatto) => setTimeout(fatto, pausa));
    bytes = await scarica(dato.url);
  }
  const upstream = sha256(bytes);
  if (upstream !== copia) {
    throw new Male(
      [
        `${dato.url} ha sha256 ${upstream} (${bytes.length} byte), vendor/${id}/${dato.file} nel checkout ha ${copia}.`,
        "O la copia è stata toccata, e allora si riscarica così com'è; o l'upstream è cambiato, e allora si aggiorna:",
        `riscarica il file in vendor/${id}/, scrivi lo sha256 nuovo in tools/vendor-craft/dati.mjs, data, ETag e`,
        `dimensione in vendor/${id}/UPSTREAM.md, e segui i passi «Aggiornare» di quella pagina (rigenerare ciò che ne deriva).`,
      ].join("\n"),
    );
  }
  return upstream;
}

const cartelleVendor = (vendor) =>
  fs
    .readdirSync(vendor, { withFileTypes: true })
    .filter((voce) => voce.isDirectory())
    .map((voce) => voce.name)
    .sort();

async function importa(file, nome) {
  const modulo = await import(pathToFileURL(path.resolve(file)).href);
  if (!modulo[nome] || typeof modulo[nome] !== "object") throw new Male(`${file} non esporta ${nome}`);
  return modulo[nome];
}

function opzioni(argv, ripetibili) {
  const valori = {};
  const resto = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      resto.push(arg);
      continue;
    }
    const valore = argv[i + 1];
    if (!valore || valore.startsWith("--")) throw new Male(`${arg} vuole un valore`);
    i += 1;
    const chiave = arg.slice(2);
    if (ripetibili.includes(chiave)) (valori[chiave] ??= []).push(valore);
    else valori[chiave] = valore;
  }
  return { valori, resto };
}

async function selfTest() {
  const fallite = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fub-provenienza-"));
  const attendi = async (nome, fn, atteso) => {
    try {
      await fn();
      fallite.push(`${nome}: accettato`);
    } catch (error) {
      if (!(error instanceof atteso)) fallite.push(`${nome}: ${error.constructor.name} invece di ${atteso.name}: ${error.message}`);
    }
  };
  try {
    const contenuto = Buffer.from('{"&amp;": {"codepoints": [38], "characters": "&"}}\n');
    const dato = { nome: "Prova", url: "https://example.invalid/e.json", file: "e.json", sha256: sha256(contenuto), licenza: "CC-BY-4.0" };
    const vendor = path.join(temp, "vendor");
    fs.mkdirSync(path.join(vendor, "motore"), { recursive: true });
    fs.mkdirSync(path.join(vendor, "dato"), { recursive: true });
    fs.writeFileSync(path.join(vendor, "dato", "e.json"), contenuto);
    fs.writeFileSync(path.join(vendor, "dato", "UPSTREAM.md"), "# prova\n");

    // L'elenco: dai moduli scritti su file, come il workflow li legge dalla base.
    const fileMotori = path.join(temp, "motori.mjs");
    const fileDati = path.join(temp, "dati.mjs");
    fs.writeFileSync(fileMotori, "export const MOTORI = { motore: {}, vecchio: {} };\n");
    fs.writeFileSync(fileDati, `export const DATI = ${JSON.stringify({ dato })};\n`);
    const motori = [await importa(fileMotori, "MOTORI")];
    const dati = [await importa(fileDati, "DATI")];
    const uscita = elenco(cartelleVendor(vendor), motori, dati);
    if (JSON.stringify(uscita) !== '{"motori":["motore","vecchio"],"dati":["dato"]}') fallite.push(`elenco: ${JSON.stringify(uscita)}`);
    // Una cartella che non è in nessun elenco.
    await attendi("vendor/x non dichiarata", () => elenco([...cartelleVendor(vendor), "x"], motori, dati), Male);
    // Un nome solo nella base conta: l'unione.
    const unione = elenco(["motore", "dato", "dalla-base"], [{ motore: {} }, { "dalla-base": {} }], [{}, { dato }]);
    if (!unione.motori.includes("dalla-base")) fallite.push("unione con la base");
    await attendi("motore e dato insieme", () => elenco(["dato"], [{ dato: {} }], [{ dato }]), Male);
    await attendi("dato senza https", () => elenco([], [], [{ dato: { ...dato, url: "http://example.invalid/e.json" } }]), Male);
    await attendi("dato senza sha256", () => elenco([], [], [{ dato: { ...dato, sha256: "abc" } }]), Male);
    await attendi("dato con file in una sottocartella", () => elenco([], [], [{ dato: { ...dato, file: "../e.json" } }]), Male);

    // check: a posto, poi sha diverso, poi un file in più.
    if (controlla(temp, "dato", dato) !== dato.sha256) fallite.push("check sulla copia buona");
    await attendi("check con sha alterato", () => controlla(temp, "dato", { ...dato, sha256: "0".repeat(64) }), Male);
    fs.writeFileSync(path.join(vendor, "dato", "altro.txt"), "x");
    await attendi("check con un file in più", () => controlla(temp, "dato", dato), Male);
    fs.rmSync(path.join(vendor, "dato", "altro.txt"));

    // verify-upstream, con l'upstream finto.
    const zitto = () => {};
    const uguale = async () => contenuto;
    if ((await verificaUpstream(temp, "dato", dato, { scarica: uguale, avvisa: zitto })) !== dato.sha256) fallite.push("verify-upstream uguale");
    await attendi("verify-upstream con upstream diverso", () => verificaUpstream(temp, "dato", dato, { scarica: async () => Buffer.from("altro"), avvisa: zitto }), Male);
    let tentativi = 0;
    const unaVolta = async () => {
      tentativi += 1;
      if (tentativi === 1) throw new Rete("giù");
      return contenuto;
    };
    await verificaUpstream(temp, "dato", dato, { scarica: unaVolta, pausa: 0, avvisa: zitto });
    if (tentativi !== 2) fallite.push(`secondo tentativo: ${tentativi} tentativi`);
    await attendi("rete giù due volte", () => verificaUpstream(temp, "dato", dato, { scarica: async () => { throw new Rete("giù"); }, pausa: 0, avvisa: zitto }), Rete);
    // La copia alterata nel checkout, con l'upstream uguale al dichiarato.
    fs.writeFileSync(path.join(vendor, "dato", "e.json"), "toccato");
    await attendi("verify-upstream con copia toccata", () => verificaUpstream(temp, "dato", dato, { scarica: uguale, avvisa: zitto }), Male);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  if (fallite.length) throw new Male(`Autoprova di provenienza fallita:\n- ${fallite.join("\n- ")}`);
  console.log("Autoprova di provenienza riuscita.");
}

async function main(argv) {
  const { valori, resto } = opzioni(argv, ["motori", "dati"]);
  const radice = path.resolve(valori.radice ?? ROOT);
  const [primo, secondo] = resto;
  if (primo === "self-test") return selfTest();
  if (primo === "elenco") {
    const motori = await Promise.all((valori.motori ?? [path.join(QUI, "motori.mjs")]).map((f) => importa(f, "MOTORI")));
    const dati = await Promise.all((valori.dati ?? [path.join(QUI, "dati.mjs")]).map((f) => importa(f, "DATI")));
    const vendor = path.resolve(valori.vendor ?? path.join(radice, "vendor"));
    console.log(JSON.stringify(elenco(cartelleVendor(vendor), motori, dati)));
    return;
  }
  const { DATI } = await import("./dati.mjs");
  if (primo === "check") {
    const ids = secondo ? [secondo] : Object.keys(DATI);
    for (const id of ids) {
      if (!DATI[id]) throw new Male(`dato sconosciuto: ${id} (dati: ${Object.keys(DATI).join(", ")})`);
      console.log(`vendor/${id}/${DATI[id].file}: sha256 ${controlla(radice, id, DATI[id])}, come dati.mjs`);
    }
    return;
  }
  if (primo && secondo === "verify-upstream") {
    if (!DATI[primo]) throw new Male(`dato sconosciuto: ${primo} (dati: ${Object.keys(DATI).join(", ")})`);
    const impronta = await verificaUpstream(radice, primo, DATI[primo]);
    console.log(`${DATI[primo].url}: sha256 ${impronta}, uguale a vendor/${primo}/${DATI[primo].file}`);
    return;
  }
  throw new Male("uso: provenienza.mjs elenco | check [<dato>] | <dato> verify-upstream | self-test");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const primoComando = process.argv[2];
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof Male) && !(error instanceof Rete)) throw error;
    // Un'annotazione di GitHub è una riga sola: la prima porta l'errore, le
    // altre restano nel log. Gli errori di `elenco` sono uno per riga e
    // diventano un'annotazione ciascuno.
    const prefisso = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    const righe = error.message.split("\n");
    const annotate = primoComando === "elenco" ? righe.length : 1;
    righe.forEach((riga, i) => console.error(`${i < annotate ? prefisso : ""}${riga}`));
    process.exit(error instanceof Rete ? 2 : 1);
  }
}
