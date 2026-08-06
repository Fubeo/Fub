#!/usr/bin/env node
// Ogni cargo feature del workspace dev'essere compilata da qualcuno.
//
// Una cargo feature spenta non è codice che fallisce: è codice che **non
// esiste**. Con lui spariscono i suoi `#[cfg]`, i suoi moduli e — la parte che
// morde — i suoi `#[test]`, che non diventano rossi e nemmeno `ignored`:
// scompaiono dal conto. È la classe di difetto che questo repo ha già incontrato
// più di dodici volte, *una suite che si svuota in silenzio è indistinguibile da
// una suite verde*, e qui ha la forma peggiore, perché a spegnerla basta
// togliere una parola da un elenco.
//
// **Il difetto è misurato, non temuto.** Togliendo `http-client` dal `default`
// di `fub-host`, `cargo test --workspace` passa da 1331 a 1328 test: spariscono
// le tre prove di `crates/fub-host/src/net.rs`, cioè quelle che tengono in piedi
// le due decisioni della 0097 — non seguire i redirect (un `302` da un host
// dichiarato porta fuori dall'allowlist) e fidarsi del verificatore della
// piattaforma invece delle radici imbarcate. Con la riga tolta, `ws.set_network`
// in `mount.rs` non c'è più e ogni `fetch` risponde `unserved`. E il resto della
// CI **non se ne accorge**: le righe `test result: ok` restano 119, `clippy`
// resta a zero, `check-cargo-versioni` resta verde. Nessuno dei presidi esistenti
// guarda questa domanda, perché nessuno di loro conta i test.
//
// La regola, allora, è che il `default` di un crate sia la chiusura di ciò che
// il crate dichiara: una feature raggiungibile dal `default` è una feature che
// `cargo test --workspace` compila, quindi le sue prove sono nel conto.
//
// Non dice che una feature non possa essere spenta — la CI lo verifica già
// (`cargo build -p fub-host --no-default-features …`, job `invariants`). Dice
// che non può essere spenta **per difetto**, perché quella è la sola
// configurazione che nessuno confronta con niente.
//
// Se un giorno una feature dovrà stare fuori dal `default` per una ragione
// vera — è cara, è sperimentale, esclude un'altra — la si dichiara in
// `FUORI_DAL_DEFAULT` insieme al passo di CI che la compila. Quel passo è il
// prezzo: senza, la feature non è provata da nessuno e questa riga sarebbe una
// firma su una promessa vuota.
//
// Uso:
//   node .github/scripts/check-cargo-feature-default.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

// Feature che possono restare fuori dal `default`, ognuna con il **comando di
// CI** che la compila. Vuoto è lo stato giusto: ogni voce qui è una feature che
// `cargo test --workspace` non prova, e la riga accanto è la promessa che
// qualcun altro lo faccia.
const FUORI_DAL_DEFAULT = new Map([
  // ["crates/x/Cargo.toml#feature", "chi la compila, e in quale passo di CI"],
]);

/** Il nome della tabella di una riga `[…]`, o `null` se la riga non lo è. */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/**
 * Le feature dichiarate da un `Cargo.toml`: `nome -> [cosa accende]`.
 *
 * Parsing a righe come `check-cargo-versioni.mjs`, e per la stessa ragione: un
 * lettore TOML completo sarebbe una dipendenza npm. Un elenco può stare su più
 * righe (`default` e `feature-ufficiali` di `fub-host` ci stanno), quindi le
 * quadre si richiudono qui. Ciò che non si sa leggere non si indovina: si
 * dichiara, e un dubbio è rosso come una violazione.
 */
function featureDi(file) {
  const trovate = new Map();
  const dubbi = [];
  let dentro = false;
  const righe = fs.readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < righe.length; i++) {
    const sezione = nomeSezione(righe[i].trim());
    if (sezione !== null) {
      dentro = sezione === "features";
      continue;
    }
    if (!dentro) continue;

    let testo = righe[i].trim();
    if (testo === "" || testo.startsWith("#")) continue;
    const primaRiga = i + 1;

    let aperte = (testo.match(/\[/g) ?? []).length - (testo.match(/\]/g) ?? []).length;
    while (aperte > 0 && i + 1 < righe.length) {
      i++;
      // I commenti dentro l'elenco sono prosa, non voci: `trash` ne ha sei
      // righe. Si tolgono qui, altrimenti una parola di italiano diventerebbe
      // il nome di una feature che non esiste.
      const seguito = righe[i].trim().replace(/^#.*$/, "");
      testo += ` ${seguito}`;
      aperte += (seguito.match(/\[/g) ?? []).length - (seguito.match(/\]/g) ?? []).length;
    }
    if (aperte > 0) {
      dubbi.push({ file, riga: primaRiga, testo });
      continue;
    }

    const m = testo.match(/^([A-Za-z0-9_+.-]+)\s*=\s*\[(.*)\]\s*(?:#.*)?$/);
    if (m === null) {
      dubbi.push({ file, riga: primaRiga, testo });
      continue;
    }
    const accende = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    trovate.set(m[1], { riga: primaRiga, accende });
  }

  return { trovate, dubbi };
}

/** I `Cargo.toml` dei crate membri, in ordine. */
function crateDelWorkspace(radice) {
  const dir = path.join(radice, "crates");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name, "Cargo.toml"))
    .filter((f) => fs.existsSync(f))
    .sort();
}

/**
 * Le feature di *questo* crate che il `default` accende, direttamente o no.
 *
 * `dep:qualcosa` e `altro-crate/feature` non sono feature di questo crate: la
 * prima è una dipendenza opzionale, la seconda è la feature di un altro. Si
 * saltano, altrimenti il conto direbbe che manca una feature che qui non esiste.
 */
function raggiunte(feature) {
  const viste = new Set();
  const coda = feature.has("default") ? [...feature.get("default").accende] : [];
  while (coda.length > 0) {
    const nome = coda.pop();
    if (nome.startsWith("dep:") || nome.includes("/")) continue;
    if (viste.has(nome)) continue;
    viste.add(nome);
    const f = feature.get(nome);
    if (f !== undefined) coda.push(...f.accende);
  }
  return viste;
}

function main() {
  const radice = path.resolve(process.argv[2] ?? ".");
  const file = crateDelWorkspace(radice);
  const violazioni = [];
  let dichiarate = 0;
  let conFeature = 0;

  for (const f of file) {
    const rel = path.relative(radice, f);
    const { trovate, dubbi } = featureDi(f);
    for (const d of dubbi) {
      violazioni.push(
        `${rel}:${d.riga} non l'ho saputa leggere: \`${d.testo}\`\n` +
          `  Se è una feature legittima, insegna la forma a questo script:` +
          ` tacere sarebbe spegnerlo.`,
      );
    }
    if (trovate.size === 0) continue;
    conFeature++;
    dichiarate += trovate.size;

    if (!trovate.has("default")) {
      violazioni.push(
        `${rel} dichiara ${trovate.size} feature e nessun \`default\`: nessuna di` +
          ` loro è compilata da \`cargo test --workspace\`, quindi le loro prove` +
          ` non sono nel conto.`,
      );
      continue;
    }

    const accese = raggiunte(trovate);
    for (const [nome, info] of trovate) {
      if (nome === "default" || accese.has(nome)) continue;
      if (FUORI_DAL_DEFAULT.has(`${rel}#${nome}`)) continue;
      violazioni.push(
        `\`${nome}\` (${rel}:${info.riga}) non è raggiungibile dal \`default\`:` +
          ` \`cargo test --workspace\` non la compila, quindi il suo codice non` +
          ` esiste e i suoi \`#[test]\` non sono rossi — sono spariti dal conto.\n` +
          `  O entra nel \`default\`, o si dichiara in FUORI_DAL_DEFAULT insieme` +
          ` al passo di CI che la compila.`,
      );
    }
  }

  for (const v of violazioni) console.log(`- ${v}`);
  if (violazioni.length > 0) console.log("");
  console.log(
    `${file.length} crate controllati, ${conFeature} con feature,` +
      ` ${dichiarate} feature dichiarate, ${FUORI_DAL_DEFAULT.size} fuori dal default per scelta,` +
      ` ${violazioni.length} ${violazioni.length === 1 ? "violazione" : "violazioni"}`,
  );

  // Un presidio che non ha guardato niente non è verde: è spento. Stessa
  // disciplina di `check-cargo-versioni.mjs`, e per la stessa ragione.
  if (dichiarate === 0) {
    console.log(
      "\nnessuna feature letta: qui il presidio non sta guardando niente.\n" +
        "O è la cartella sbagliata, o la sezione `[features]` non si legge più.",
    );
    process.exit(1);
  }

  process.exit(violazioni.length > 0 ? 1 : 0);
}

main();
