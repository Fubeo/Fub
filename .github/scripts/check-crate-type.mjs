#!/usr/bin/env node
// Ogni forma di libreria dichiarata dev'essere consumata da qualcuno.
//
// Un `crate-type` non è una preferenza di stile: è **un codegen e un link
// dell'intero albero in più**, uno per parola. Una libreria Rust che non
// attraversa un confine C ha una forma sola — `rlib` —, e le altre due
// (`staticlib` per iOS, `cdylib` per Android o per chi carica con `dlopen`)
// servono solo se **esiste un consumatore**: un target mobile, un altro
// linguaggio, un caricatore a runtime. Senza consumatore non sono un'opzione
// aperta per il futuro, sono lavoro che ogni compilazione rifà per nessuno.
//
// **Il difetto era misurato, ed è il 0229.** `crates/fub-app/Cargo.toml`
// portava `crate-type = ["staticlib", "cdylib", "rlib"]`, che è la riga con cui
// il template di Tauri v2 nasce perché il template prevede il mobile. Qui il
// mobile non c'è — `crates/fub-app/gen/schemas/` conosce solo
// `desktop-schema.json` e `linux-schema.json` — e i due artefatti in più non li
// apriva nessuno: il binario `fub` linka il solo `.rlib`, e così fa
// `crates/fub-app/tests/ts_mirror_app.rs`. Sul disco restavano un `.a` e un
// `.so` (in release, 175 MB e 2,6 MB; in debug, molto peggio) per 883 righe di
// sorgente. Misurato con `touch crates/fub-abi/src/lib.rs` e ricostruzione del
// workspace su quattro core: 10,7 / 11,7 / 10,9 s con le tre parole contro
// 5,9 / 6,5 / 6,7 / 7,2 s con `rlib` da solo. E la premessa sospetta — che la
// CLI di Tauri pretendesse il `cdylib` da qualche parte nel packaging — è stata
// verificata con un `tauri build --no-bundle` **vero**, non con un
// `cargo build`: passa, e produce lo stesso binario.
//
// La regola, allora: una forma di libreria diversa da `rlib` o `proc-macro` sta
// in un manifest solo se `CONSUMATORI` nomina chi la apre. Vuoto è lo stato
// giusto. Se un giorno arriva il target mobile, la parola torna **insieme al
// target che la consuma**, e la riga qui sotto è il posto dove si scrive chi è.
//
// Il presidio è un conto e non un banco `cargo test` perché ciò che sorveglia
// nasce in un manifest: il compilatore non ha niente da dire su una parola in
// più in un elenco TOML — con lei compila, senza lei compila —, e un test
// Rust che leggesse il proprio `Cargo.toml` sarebbe questo script scritto in
// un'altra lingua.
//
// Uso:
//   node .github/scripts/check-crate-type.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

import { crateDelWorkspace } from "./membri-del-workspace.mjs";

// Le forme che non costano un link in più a nessuno: `rlib` è ciò che un altro
// crate Rust linka, `proc-macro` è la forma obbligata di una macro procedurale
// (e `dylib` non è in elenco apposta — è una forma vera, che va dichiarata).
const GRATIS = new Set(["rlib", "lib", "proc-macro"]);

// Le forme dichiarate che qualcuno consuma davvero, ognuna col **consumatore**.
// Vuoto è lo stato giusto: ogni voce qui è un codegen e un link dell'intero
// albero a ogni compilazione, e la riga accanto è chi li paga volentieri.
const CONSUMATORI = new Map([
  // ["crates/x/Cargo.toml#cdylib", "chi apre l'artefatto, e come"],
]);

/** Il nome della tabella di una riga `[…]`, o `null` se la riga non lo è. */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/**
 * I `crate-type` dichiarati da un `Cargo.toml`: una voce per sezione che ne
 * porta uno.
 *
 * Parsing a righe come `check-cargo-versioni.mjs` e
 * `check-cargo-feature-default.mjs`, e per la stessa ragione: un lettore TOML
 * completo sarebbe una dipendenza npm. L'elenco può stare su più righe, quindi
 * le quadre si richiudono qui. Ciò che non si sa leggere non si indovina: si
 * dichiara, e un dubbio è rosso come una violazione.
 */
function crateTypeDi(file) {
  const trovati = [];
  const dubbi = [];
  let sezione = null;
  const righe = fs.readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < righe.length; i++) {
    const nome = nomeSezione(righe[i].trim());
    if (nome !== null) {
      sezione = nome;
      continue;
    }

    let testo = righe[i].trim();
    if (!testo.startsWith("crate-type") && !testo.startsWith("crate_type")) continue;
    const primaRiga = i + 1;

    let aperte = (testo.match(/\[/g) ?? []).length - (testo.match(/\]/g) ?? []).length;
    while (aperte > 0 && i + 1 < righe.length) {
      i++;
      // I commenti dentro l'elenco sono prosa, non voci: si tolgono qui,
      // altrimenti una parola di italiano diventerebbe una forma di libreria.
      const seguito = righe[i].trim().replace(/^#.*$/, "");
      testo += ` ${seguito}`;
      aperte += (seguito.match(/\[/g) ?? []).length - (seguito.match(/\]/g) ?? []).length;
    }
    if (aperte > 0) {
      dubbi.push({ riga: primaRiga, testo });
      continue;
    }

    const m = testo.match(/^crate[-_]type\s*=\s*\[(.*)\]\s*(?:#.*)?$/);
    if (m === null) {
      dubbi.push({ riga: primaRiga, testo });
      continue;
    }
    const forme = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    trovati.push({ sezione: sezione ?? "(fuori da ogni sezione)", riga: primaRiga, forme });
  }

  return { trovati, dubbi };
}

function main() {
  const radice = path.resolve(process.argv[2] ?? ".");
  // Stesso elenco, stessa funzione: chi sono i crate lo dice `[workspace]
  // members`. È il terzo chiamante di `membri-del-workspace.mjs`, e il verso
  // «una cartella che nessun membro dichiara» lo eredita senza scriverlo.
  const { file, violazioni: sullElenco } = crateDelWorkspace(radice);
  const violazioni = [...sullElenco];
  const visti = new Set();
  let dichiarazioni = 0;
  let forme = 0;

  for (const f of file) {
    const rel = path.relative(radice, f);
    const { trovati, dubbi } = crateTypeDi(f);
    for (const d of dubbi) {
      violazioni.push(
        `${rel}:${d.riga} non l'ho saputa leggere: \`${d.testo}\`\n` +
          `  Se è un \`crate-type\` legittimo, insegna la forma a questo script:` +
          ` tacere sarebbe spegnerlo.`,
      );
    }
    for (const t of trovati) {
      dichiarazioni++;
      forme += t.forme.length;
      for (const forma of t.forme) {
        visti.add(forma);
        if (GRATIS.has(forma)) continue;
        if (CONSUMATORI.has(`${rel}#${forma}`)) continue;
        violazioni.push(
          `\`${forma}\` (${rel}:${t.riga}, \`[${t.sezione}]\`) non ha un consumatore:` +
            ` è un codegen e un link dell'intero albero a **ogni** compilazione,` +
            ` e l'artefatto che ne esce non lo apre nessuno — il binario e i banchi` +
            ` linkano l'\`rlib\`.\n` +
            `  O sparisce, o si dichiara in CONSUMATORI insieme a chi lo apre` +
            ` (un target mobile, un altro linguaggio, un \`dlopen\`). È il 0229.`,
        );
      }
    }
  }

  for (const v of violazioni) console.log(`- ${v}`);
  if (violazioni.length > 0) console.log("");
  console.log(
    `${file.length} crate controllati, ${dichiarazioni} \`crate-type\` dichiarati,` +
      ` ${forme} forme in tutto, ${CONSUMATORI.size} con un consumatore dichiarato,` +
      ` ${violazioni.length} ${violazioni.length === 1 ? "violazione" : "violazioni"}`,
  );

  // Un presidio che non ha guardato niente non è verde: è spento. Stessa
  // disciplina di `check-cargo-versioni.mjs`, e per la stessa ragione — qui
  // però il caso «nessuno dichiara niente» è **legittimo** (un workspace di
  // sole librerie normali non scrive mai `crate-type`), quindi ciò che si
  // pretende è di aver letto dei manifest, non delle forme.
  if (file.length === 0) {
    console.log(
      "\nnessun crate letto: qui il presidio non sta guardando niente.\n" +
        "O è la cartella sbagliata, o `[workspace] members` non si legge più.",
    );
    process.exit(1);
  }

  process.exit(violazioni.length > 0 ? 1 : 0);
}

main();
