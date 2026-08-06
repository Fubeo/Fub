#!/usr/bin/env node
// Nell'albero della shell un pacchetto ha **una** copia.
//
// Il difetto che ha fatto scrivere questo conto era scritto così: *«`basicSetup`
// da `codemirror` accanto agli import da `@codemirror/*`: due copie dello stato
// a un aggiornamento di distanza»*. Misurato, e la misura ha cambiato la
// riparazione: le copie di `@codemirror/state` oggi sono **una**. `npm ls
// @codemirror/state` risponde `6.7.1` e undici volte `deduped`, e nel lock non
// c'è **nessun** `node_modules/x/node_modules/y` — npm ha appiattito tutto,
// perché la dipendenza diretta chiede `^6.5.0` e `codemirror` chiede `^6.0.0`,
// cioè due intervalli che una versione sola soddisfa.
//
// Quindi il difetto non è «ce ne sono due»: è «potrebbero diventare due, e il
// giorno che succede nessuno se ne accorge». Sono due difetti diversi e si
// riparano in modi diversi — il primo togliendo un import, il secondo con un
// presidio — e questo è il secondo.
//
// Vale la pena perché la rottura è **muta**. `@codemirror/state` porta dei
// `Facet` e degli `StateField` la cui identità è l'oggetto stesso: due copie del
// modulo sono due insiemi di identità, e un'estensione costruita con l'una non
// viene vista dalla configurazione costruita con l'altra. Non è un errore di
// tipo (le forme sono identiche) e non è un'eccezione: è un editor in cui la
// live preview o il tema semplicemente non fanno niente, e la causa è un albero
// di `node_modules`.
//
// La regola scritta qui è più larga del caso che l'ha fatta nascere — *nessun
// pacchetto, mai, in due copie* — e lo è di proposito: la stessa rottura muta ce
// l'hanno tutte le librerie che tengono uno stato o un'identità di modulo, e un
// conto che nominasse `@codemirror/state` sarebbe stato scritto per il difetto
// di ieri. Oggi l'albero è già pulito, quindi il conto non costa niente e
// diventa rosso il giorno in cui un `npm install` separa qualcosa.
//
// # La zona cieca, dichiarata
//
// Guarda il **lock**, non `node_modules/`: dice cosa verrà installato, non cosa
// c'è sul disco di chi lo esegue. È il verso giusto — è il lock che finisce nel
// commit — ma non prende un albero installato a mano che dal lock si è
// discostato. E non dice niente sulle **versioni**: due pacchetti diversi che
// portano lo stesso codice (`lodash` e `lodash-es`) sono due pacchetti, e questo
// conto li vede come tali.
//
// Cosa fare quando diventa rosso: **non** allargare l'elenco. O si allineano gli
// intervalli in `package.json` perché npm possa riappiattire, o — se le due
// versioni sono davvero incompatibili — si dichiara la seconda copia in
// `SECONDE_COPIE` con accanto la ragione per cui non rompe niente. Ogni voce lì
// è un albero in cui un modulo esiste due volte.
//
// Uso:
//   node .github/scripts/check-npm-copie.mjs [percorso del package-lock.json]
// Exit code 1 se c'è almeno un pacchetto in due copie, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";

/// I pacchetti che possono stare nell'albero in più di una copia, ognuno con la
/// ragione. Vuoto è lo stato giusto.
const SECONDE_COPIE = new Map([
  // ["nome", "perché due copie qui non rompono niente"],
]);

const lock = process.argv[2] ?? "frontend/package-lock.json";
if (!fs.existsSync(lock)) {
  console.error(`Non trovo ${lock}: passalo come argomento.`);
  process.exit(2);
}

const dati = JSON.parse(fs.readFileSync(lock, "utf8"));
if (typeof dati.packages !== "object") {
  console.error(`${lock} non ha una sezione "packages": serve un lockfile v2 o v3.`);
  process.exit(2);
}

/// Il nome di un pacchetto dal suo percorso nell'albero: l'ultimo segmento dopo
/// l'ultimo `node_modules/`. La radice (chiave vuota) non è un pacchetto
/// installato ed esce di qui.
function nomeDi(percorso) {
  const i = percorso.lastIndexOf("node_modules/");
  return i < 0 ? null : percorso.slice(i + "node_modules/".length);
}

const copie = new Map();
for (const [percorso, voce] of Object.entries(dati.packages)) {
  const nome = nomeDi(percorso);
  if (nome === null) continue;
  // Un `link` non è una copia: è un puntatore a un workspace che sta già
  // nell'albero col suo percorso vero.
  if (voce.link === true) continue;
  const dove = copie.get(nome);
  if (dove) dove.push({ percorso, versione: voce.version });
  else copie.set(nome, [{ percorso, versione: voce.version }]);
}

let problemi = 0;
for (const [nome, dove] of [...copie].sort()) {
  if (dove.length < 2) continue;
  const scusa = SECONDE_COPIE.get(nome);
  if (scusa) {
    console.log(`${nome}: ${dove.length} copie, dichiarate — ${scusa}`);
    continue;
  }
  problemi++;
  console.error(`${nome}: ${dove.length} copie nell'albero`);
  for (const d of dove) console.error(`  ${d.versione ?? "?"} in ${d.percorso}`);
}

if (problemi > 0) {
  console.error("");
  console.error(
    `${problemi} pacchetti in più di una copia. Due copie di un modulo che tiene`,
  );
  console.error(
    "uno stato o un'identità sono due mondi che non si vedono, e la rottura è muta:",
  );
  console.error(
    "si allineano gli intervalli in package.json, oppure la seconda copia si dichiara",
  );
  console.error(`in SECONDE_COPIE con la ragione per cui non rompe niente.`);
  process.exit(1);
}

console.log(`${copie.size} pacchetti in ${lock}: nessuno in due copie.`);
