#!/usr/bin/env node
// Un solo punto di verità per la versione di una dipendenza esterna.
//
// La radice ha una sezione `[workspace.dependencies]` che esiste apposta: le
// versioni si scrivono lì una volta, e i crate le ereditano con
// `{ workspace = true }`. Ma nessuno impedisce a un `cargo add` di scriverne
// una a mano dentro `crates/<qualcosa>/Cargo.toml`, e la prima volta non fa
// male: è un crate solo, il numero è giusto, la build è verde.
//
// Fa male la seconda. Il difetto misurato che ha fatto scrivere questo file era
// `tempfile = "3.27.0"` dichiarato **cinque** volte identico — kernel, testkit,
// features, format-markdown, host — con il risultato che un `cargo update` di
// quella dipendenza è cinque righe da cambiare, e la prima dimenticata non
// diventa un errore: diventa una *seconda* versione di `tempfile` nell'albero,
// scelta da nessuno, che compila benissimo. Un duplicato non si vede finché non
// diverge, e quando diverge non si vede lo stesso.
//
// Due reti, con maglie diverse:
//
//   1. **Il doppione** — nessuna dipendenza può comparire con una versione
//      scritta a mano in due o più crate del workspace. Una sola volta è
//      lecito: `comrak` sta in un crate solo, e promuoverlo alla radice
//      significherebbe promettere che un giorno lo userà anche qualcun altro.
//   2. **L'ombra** — se la radice dichiara già una versione, nessun crate può
//      scriverne una propria accanto, nemmeno da solo. Questa maglia prende il
//      caso che la prima non vede: la riga rimasta indietro dopo che le altre
//      quattro sono state promosse, che è esattamente la forma in cui il
//      difetto sarebbe *tornato*.
//
// Le eccezioni si dichiarano in `ECCEZIONI`, con la ragione accanto: una
// versione scritta due volte di proposito è una decisione, e va presa qui.
//
// Uso:
//   node .github/scripts/check-cargo-versioni.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella: un
// controllo che per girare vuole un `npm install` è un controllo che prima o
// poi si spegne "temporaneamente".

import fs from "node:fs";
import path from "node:path";

import { crateDelWorkspace } from "./membri-del-workspace.mjs";

// Dipendenze che possono ripetersi con la versione scritta a mano, ognuna con
// la ragione per cui non sale nella radice. Vuoto è lo stato giusto: ogni voce
// aggiunta qui è un punto di verità in meno.
const ECCEZIONI = new Map([
  // ["nome-crate", "perché questa dipendenza è dichiarata dove è dichiarata"],
]);

// Le sezioni di un `Cargo.toml` in cui una riga è una dipendenza. Sono
// riconosciute per *suffisso*, così `[target.'cfg(windows)'.dependencies]` e
// `[target.…​.dev-dependencies]` entrano senza doverli elencare.
const SUFFISSI_DIPENDENZE = ["dependencies", "dev-dependencies", "build-dependencies"];

/**
 * Il nome della tabella di una riga `[…]`, o `null` se la riga non lo è.
 *
 * Anche `[[example]]` è una riga di tabella: non è una sezione di dipendenze,
 * ma **chiude** quella di prima, e trattarla come una riga qualsiasi farebbe
 * leggere gli esempi come dipendenze.
 */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/** Vero se la tabella `nome` è una tabella di dipendenze di questo crate. */
function eSezioneDipendenze(nome) {
  if (nome.startsWith("workspace.")) return false;
  return SUFFISSI_DIPENDENZE.some((s) => nome === s || nome.endsWith(`.${s}`));
}

/**
 * Le dipendenze dichiarate in un `Cargo.toml`, e come.
 *
 * Ritorna una mappa `nome -> { riga, versione }`, dove `versione` è la stringa
 * scritta a mano oppure `null` se il crate eredita dalla radice. Il parsing è
 * a righe di proposito: un `Cargo.toml` è scritto a mano da noi, e un lettore
 * TOML completo qui sarebbe una dipendenza npm — cioè la cosa che questo file
 * dice di non volere. Ciò che il lettore a righe non capisce non lo indovina:
 * lo **dichiara** (vedi `dubbi`), e un dubbio è rosso come una violazione.
 */
function dipendenzeDi(file) {
  const trovate = new Map();
  const dubbi = [];
  let dentro = false;
  const righe = fs.readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    const sezione = nomeSezione(riga.trim());
    if (sezione !== null) {
      dentro = eSezioneDipendenze(sezione);
      continue;
    }
    if (!dentro) continue;

    let testo = riga.trim();
    if (testo === "" || testo.startsWith("#")) continue;
    const primaRiga = i + 1;

    // Una tabella inline può stare su più righe quando la lista delle feature è
    // lunga (`jiff`, `ureq`, `windows-sys`). Si richiudono le graffe qui,
    // altrimenti ogni feature sembrerebbe una dipendenza col nome sbagliato.
    let aperte = (testo.match(/\{/g) ?? []).length - (testo.match(/\}/g) ?? []).length;
    while (aperte > 0 && i + 1 < righe.length) {
      i++;
      const seguito = righe[i].trim();
      testo += ` ${seguito}`;
      aperte += (seguito.match(/\{/g) ?? []).length - (seguito.match(/\}/g) ?? []).length;
    }
    if (aperte > 0) {
      dubbi.push({ file, riga: primaRiga, testo });
      continue;
    }

    // `nome = …` oppure `nome.workspace = true` / `nome.version = "…"`.
    const m = testo.match(/^([A-Za-z0-9_-]+)\s*(?:\.\s*([A-Za-z0-9_-]+)\s*)?=\s*(.*)$/);
    if (m === null) {
      dubbi.push({ file, riga: primaRiga, testo });
      continue;
    }
    const [, nome, chiave, valore] = m;

    let versione = null;
    if (chiave === "version") {
      const v = valore.match(/^"([^"]*)"/);
      versione = v === null ? valore : v[1];
    } else if (chiave === undefined) {
      if (/^"([^"]*)"\s*(#.*)?$/.test(valore)) {
        versione = valore.match(/^"([^"]*)"/)[1];
      } else if (valore.startsWith("{")) {
        // Eredita se lo dice, altrimenti conta la `version =` che si è scritta.
        if (!/\bworkspace\s*=\s*true\b/.test(valore)) {
          const v = valore.match(/\bversion\s*=\s*"([^"]*)"/);
          if (v !== null) versione = v[1];
        }
      }
    }
    // `nome.workspace = true` e ogni altra chiave puntata (`features`, `path`,
    // `optional`) non dicono una versione: non aggiungono niente al conto.

    const gia = trovate.get(nome);
    if (gia === undefined || (gia.versione === null && versione !== null)) {
      trovate.set(nome, { riga: primaRiga, versione });
    }
  }

  return { trovate, dubbi };
}

function main() {
  const radice = path.resolve(process.argv[2] ?? ".");
  const manifestRadice = path.join(radice, "Cargo.toml");
  if (!fs.existsSync(manifestRadice)) {
    console.log(`nessun Cargo.toml in ${radice}: qui il presidio non sta guardando niente.`);
    process.exit(1);
  }

  // Le versioni che la radice dichiara per tutti.
  const condivise = new Set();
  {
    let dentro = false;
    for (const riga of fs.readFileSync(manifestRadice, "utf8").split("\n")) {
      const sezione = nomeSezione(riga.trim());
      if (sezione !== null) {
        dentro = sezione === "workspace.dependencies";
        continue;
      }
      if (!dentro) continue;
      const m = riga.trim().match(/^([A-Za-z0-9_-]+)\s*[.=]/);
      if (m !== null) condivise.add(m[1]);
    }
  }

  // Chi sono i crate lo dice `[workspace] members`, non la cartella `crates/`:
  // la ragione sta in `membri-del-workspace.mjs`, e le divergenze fra l'elenco
  // e il disco arrivano di là già scritte.
  const { file, violazioni: sullElenco } = crateDelWorkspace(radice);
  const letterali = new Map(); // nome -> [{ crate, riga, versione }]
  const dubbi = [];
  let dichiarazioni = 0;

  for (const f of file) {
    const { trovate, dubbi: d } = dipendenzeDi(f);
    dubbi.push(...d);
    for (const [nome, info] of trovate) {
      dichiarazioni++;
      if (info.versione === null) continue;
      if (!letterali.has(nome)) letterali.set(nome, []);
      letterali.get(nome).push({ crate: path.relative(radice, f), ...info });
    }
  }

  const violazioni = [...sullElenco];
  for (const [nome, posti] of [...letterali].sort()) {
    if (ECCEZIONI.has(nome)) continue;
    if (posti.length > 1) {
      violazioni.push(
        `\`${nome}\` è dichiarata con una versione scritta a mano in ${posti.length} crate:\n` +
          posti.map((p) => `    ${p.crate}:${p.riga}  ${nome} = "${p.versione}"`).join("\n") +
          `\n  Va in [workspace.dependencies] della radice, e nei crate diventa` +
          ` \`${nome} = { workspace = true }\`.`,
      );
    } else if (condivise.has(nome)) {
      const p = posti[0];
      violazioni.push(
        `\`${nome}\` è già in [workspace.dependencies], ma ${p.crate}:${p.riga} ne scrive` +
          ` una propria ("${p.versione}"): sono due punti di verità, e il secondo vince in` +
          ` silenzio.\n  Qui la riga va sostituita con \`${nome} = { workspace = true }\`.`,
      );
    }
  }

  for (const d of dubbi) {
    violazioni.push(
      `${path.relative(radice, d.file)}:${d.riga} non l'ho saputa leggere: \`${d.testo}\`\n` +
        `  Se è una dipendenza legittima, insegna la forma a questo script: tacere` +
        ` sarebbe spegnerlo.`,
    );
  }

  for (const v of violazioni) console.log(`- ${v}`);
  if (violazioni.length > 0) console.log("");
  console.log(
    `${file.length} crate controllati, ${dichiarazioni} dipendenze dichiarate,` +
      ` ${condivise.size} versioni condivise nella radice,` +
      ` ${violazioni.length} ${violazioni.length === 1 ? "violazione" : "violazioni"}`,
  );

  // Un presidio che non ha guardato niente non è verde: è spento. Stessa
  // disciplina di `check-doc-links.mjs`, e per la stessa ragione.
  if (file.length === 0 || dichiarazioni === 0) {
    console.log(
      "\nnessuna dipendenza letta: qui il presidio non sta guardando niente.\n" +
        "O è la cartella sbagliata, o le sezioni riconosciute non sono più quelle giuste.",
    );
    process.exit(1);
  }

  process.exit(violazioni.length > 0 ? 1 : 0);
}

main();
