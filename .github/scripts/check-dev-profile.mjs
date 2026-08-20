#!/usr/bin/env node
// Il profilo `dev` è una decisione, e ogni sua chiave ha una ragione scritta.
//
// **Perché un presidio su tre righe di TOML.** Il costo che questo profilo
// governa non fallisce mai: chi toglie una di queste chiavi non rompe niente —
// compila, i test passano, la CI è verde — e paga solo chi lavora al repo, in
// secondi, per sempre. È la stessa classe del `crate-type` senza consumatore
// (`check-crate-type.mjs`, il 0229) e della cargo feature che nessuno compila
// (`check-cargo-feature-default.mjs`, la 0129): una parola in un manifest che
// nessun attore del repo guardava.
//
// **La riga che questo presidio esiste per tenere** è
// `split-debuginfo = "unpacked"`, ed è la decisione 0145. I centotrentasette
// eseguibili che escono da `tests/` non sono un problema di *numero* — un file
// di prova per soggetto è la divisione della 0054 e della 0055, e un processo
// per file è ciò che rende gratis l'isolamento di cui cinque banchi hanno
// bisogno davvero (uno chiama `set_current_dir`, quattro installano un
// `panic::set_hook`, e tutti e cinque sono globali al processo). Erano un
// problema di *peso*: con l'informazione di debug copiata dentro ognuno, la
// mediana di un eseguibile di prova era 62,4 MB e i centotrentasette insieme
// 13,8 GB; con `unpacked` sono 25,6 MB e 4,9 GB, cioè il linker scrive nove
// gigabyte in meno a ogni passata, senza che si perda un byte di informazione
// di debug — resta nei `.o`, accanto ai binari, e un backtrace continua a
// stampare file e riga (verificato).
//
// La regola, allora: `[profile.dev]` del manifest di workspace dichiara
// **esattamente** le chiavi di `ATTESE`, con quei valori. Una chiave in meno è
// una decisione disfatta in silenzio; una chiave in più è una decisione presa
// senza che nessuno l'abbia scritta, e la riparazione è la stessa — o sparisce,
// o entra qui insieme alla sua ragione.
//
// Il presidio è un conto e non un banco `cargo test` per il motivo di
// `check-crate-type.mjs`: ciò che sorveglia nasce in un manifest, il
// compilatore non ha niente da dire su una riga TOML in meno, e un test Rust
// che leggesse il proprio `Cargo.toml` sarebbe questo script in un'altra lingua.
//
// Uso:
//   node .github/scripts/check-profilo-dev.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

// Le chiavi del profilo, e accanto a ognuna chi paga se sparisce.
const ATTESE = new Map([
  [
    "opt-level",
    {
      valore: "0",
      ragione:
        "senza, `dev` ottimizza e chi lavora aspetta il codegen a ogni giro",
    },
  ],
  [
    "split-debuginfo",
    {
      valore: '"unpacked"',
      ragione:
        "senza, il linker ricopia l'informazione di debug dentro ognuno dei" +
        " centotrentasette eseguibili di prova: 62,4 MB di mediana invece di" +
        " 25,6, e 13,8 GB invece di 4,9 (decisione 0145)",
    },
  ],
]);

/** Il nome della tabella di una riga `[…]`, o `null` se la riga non lo è. */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/**
 * Le coppie chiave/valore dichiarate da `[profile.dev]`, e i dubbi.
 *
 * Parsing a righe come `check-cargo-versioni.mjs`, `check-cargo-feature-default.mjs`
 * e `check-crate-type.mjs`, per la stessa ragione: un lettore TOML completo
 * sarebbe una dipendenza npm. Ciò che non si sa leggere non si indovina — si
 * dichiara, e un dubbio è rosso come una violazione.
 */
function profiloDev(file) {
  const trovate = new Map();
  const dubbi = [];
  let dentro = false;
  const righe = fs.readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < righe.length; i++) {
    const testo = righe[i].trim();
    const sezione = nomeSezione(testo);
    if (sezione !== null) {
      dentro = sezione === "profile.dev";
      continue;
    }
    if (!dentro) continue;
    if (testo === "" || testo.startsWith("#")) continue;

    const m = testo.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (m === null) {
      dubbi.push({ riga: i + 1, testo });
      continue;
    }
    trovate.set(m[1], { valore: m[2], riga: i + 1 });
  }

  return { trovate, dubbi, presente: righe.some((r) => nomeSezione(r.trim()) === "profile.dev") };
}

function main() {
  const radice = path.resolve(process.argv[2] ?? ".");
  const file = path.join(radice, "Cargo.toml");
  const rel = path.relative(radice, file) || "Cargo.toml";
  const violazioni = [];

  if (!fs.existsSync(file)) {
    console.log(
      `- ${rel} non esiste: qui il presidio non sta guardando niente.\n` +
        "  O è la cartella sbagliata, o il manifest di workspace si è spostato.",
    );
    process.exit(1);
  }

  const { trovate, dubbi, presente } = profiloDev(file);

  if (!presente) {
    violazioni.push(
      `\`[profile.dev]\` non c'è più in ${rel}: le decisioni che ci stavano` +
        " dentro sono tornate ai default di cargo senza che nessuno le disfacesse." +
        " Vedi la decisione 0145.",
    );
  }

  for (const d of dubbi) {
    violazioni.push(
      `${rel}:${d.riga} non l'ho saputa leggere: \`${d.testo}\`\n` +
        "  Se è una chiave legittima di `[profile.dev]`, insegna la forma a questo" +
        " script: tacere sarebbe spegnerlo.",
    );
  }

  for (const [chiave, attesa] of ATTESE) {
    const t = trovate.get(chiave);
    if (t === undefined) {
      violazioni.push(
        `\`${chiave}\` manca da \`[profile.dev]\` (${rel}): ${attesa.ragione}.\n` +
          `  Il valore deciso è \`${attesa.valore}\`. Se la decisione è cambiata,` +
          " si cambia qui insieme al verbale che la supera.",
      );
      continue;
    }
    if (t.valore !== attesa.valore) {
      violazioni.push(
        `\`${chiave}\` vale \`${t.valore}\` e non \`${attesa.valore}\`` +
          ` (${rel}:${t.riga}): ${attesa.ragione}.`,
      );
    }
  }

  for (const [chiave, t] of trovate) {
    if (ATTESE.has(chiave)) continue;
    violazioni.push(
      `\`${chiave}\` (${rel}:${t.riga}) è una chiave di profilo che nessuno ha` +
        " dichiarato: un profilo è una decisione sul lavoro di tutti, e questa non" +
        " ha una ragione scritta accanto.\n" +
        "  O sparisce, o entra in ATTESE di questo script con chi paga se sparisse.",
    );
  }

  for (const v of violazioni) console.log(`- ${v}`);
  if (violazioni.length > 0) console.log("");
  console.log(
    `${rel}: \`[profile.dev]\` con ${trovate.size}` +
      ` ${trovate.size === 1 ? "chiave" : "chiavi"}, ${ATTESE.size} attese,` +
      ` ${violazioni.length} ${violazioni.length === 1 ? "violazione" : "violazioni"}`,
  );

  process.exit(violazioni.length > 0 ? 1 : 0);
}

main();
