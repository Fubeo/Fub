#!/usr/bin/env node
// Un ascoltatore su `document` o su `window` ha un padrone, e il padrone è una
// `Vita`.
//
// Il difetto era misurato, ed era **sei volte la stessa riga**: il menu
// contestuale che mette un `click` su `document` da dentro un `setTimeout` e si
// chiude con Escape prima che scatti; il selettore di icona che si rimuove il
// nodo da sotto lasciando appesi l'ascoltatore e la trappola del fuoco; la
// trappola del fuoco stessa; e i tre ascolti globali del tema, del locale e
// della tastiera. Nessuno di loro era sbagliato per distrazione: erano sei posti
// in cui *ricordarsi* il `removeEventListener` gemello era l'unica difesa, e una
// difesa che va ricordata sei volte è una difesa che al settimo posto non c'è.
//
// La riparazione è `frontend/src/ui/vita.ts`: `ascolta` è un metodo di `Vita`,
// quindi non lo si chiama senza avere in mano l'oggetto che sa anche smettere.
// Quella metà la prende il compilatore. Questo conto prende l'altra — *nessuno
// scavalca la porta* — perché `document.addEventListener` è una funzione del DOM
// e il compilatore non ha nessun motivo per rifiutarla.
//
// È la forma della decisione 0125 (la `Porta`) applicata al terzo lato: là ciò
// che circolava nel riconciliatore non era un handler ma una porta, qui ciò che
// si passa a chi ascolta non è un `EventTarget` ma una vita.
//
// # Le zone cieche, dichiarate
//
// Un conto è cieco a ciò che non gli si è detto di guardare, e questi sono i
// modi noti di aggirarlo:
//
//  1. **L'alias.** `const d = document; d.addEventListener(…)` non viene visto:
//     qui si legge del testo, non dei tipi. Costa una riga scritta apposta per
//     nascondersi, ed è il prezzo che si accetta per non avere un analizzatore.
//  2. **`EventTarget` per via generica.** Un `bersaglio: EventTarget` passato da
//     fuori e poi `bersaglio.addEventListener(…)` non si distingue da un
//     elemento. Stessa ragione.
//  3. **Gli elementi.** Un `addEventListener` su un nodo — `$("#new-note")`, una
//     riga dell'esplora, un `input` — non è guardato, ed è voluto: quel
//     ascoltatore muore col nodo, e il nodo muore quando chi lo ha creato lo
//     butta. È la specie che la decisione 0079 ha già chiuso dall'altro lato.
//     L'eccezione dentro l'eccezione — un elemento che vive quanto la pagina,
//     come `document.body` — è coperta, perché lì il nodo non muore mai.
//  4. **I banchi.** `*.test.ts` è escluso: un banco si costruisce e si butta il
//     suo DOM, e obbligarlo alla porta vorrebbe dire far dipendere la prova da
//     ciò che prova.
//
// Ciò che questo conto **non** dice, e non deve dire: che ogni
// `addEventListener` abbia un `removeEventListener` gemello. Quella è la
// promessa ripetuta, cioè esattamente la cosa da cui si sta scappando: contarne
// le occorrenze farebbe passare per verde chi ne scrive due e ne chiama uno.
//
// Uso:
//   node .github/scripts/check-ascoltatori.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

/// L'unico file che può toccare `addEventListener` sui bersagli globali: è la
/// porta. Path relativo alla radice del repo.
const LA_PORTA = "frontend/src/ui/vita.ts";

/// La cartella scandita.
const SORGENTI = "frontend/src";

/// I bersagli che vivono quanto la pagina: chi ci mette sopra un ascoltatore
/// senza dire fino a quando lo mette per sempre.
const BERSAGLI = [
  "document",
  "window",
  "globalThis",
  "self",
  "document.body",
  "document.documentElement",
];

/// Le righe che registrano su un bersaglio globale.
///
/// `matchMedia` è a parte perché il bersaglio è il valore di ritorno di una
/// chiamata e non un nome: `window.matchMedia(q).addEventListener("change", …)`
/// è un ascolto che dura quanto la pagina esattamente come gli altri.
function violazioni(testo) {
  const nomi = BERSAGLI.map((b) => b.replace(".", "\\s*\\.\\s*")).join("|");
  const globale = new RegExp(String.raw`(?<![.\w])(${nomi})\s*\.\s*addEventListener\b`);
  const media = /matchMedia[\s\S]*?\.\s*addEventListener\b/;
  const fuori = [];
  const righe = testo.split("\n");
  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    if (globale.test(riga) || media.test(riga)) fuori.push({ n: i + 1, riga: riga.trim() });
  }
  return fuori;
}

/** Tutti i `.ts` sotto una cartella, esclusi i banchi. */
function sorgenti(dir, dentro = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) sorgenti(p, dentro);
    else if (voce.name.endsWith(".ts") && !voce.name.endsWith(".test.ts")) dentro.push(p);
  }
  return dentro;
}

const radice = process.argv[2] ?? ".";
const base = path.join(radice, SORGENTI);
if (!fs.existsSync(base)) {
  console.error(`Non trovo ${base}: passa la radice del repo come argomento.`);
  process.exit(2);
}

let problemi = 0;
let visti = 0;
for (const file of sorgenti(base).sort()) {
  const rel = path.relative(radice, file).split(path.sep).join("/");
  if (rel === LA_PORTA) continue;
  visti++;
  for (const v of violazioni(fs.readFileSync(file, "utf8"))) {
    problemi++;
    console.error(`${rel}:${v.n}: ascoltatore globale senza una Vita`);
    console.error(`  ${v.riga}`);
  }
}

if (problemi > 0) {
  console.error("");
  console.error(
    `${problemi} ascoltatori globali registrati fuori da ${LA_PORTA}. Chi ascolta`,
  );
  console.error(
    "su `document` o `window` deve dire fino a quando: `vita.ascolta(document, …)`,",
  );
  console.error("con una `Vita` che qualcuno possiede e chiude.");
  process.exit(1);
}

console.log(`${visti} sorgenti: ogni ascoltatore globale passa da una Vita.`);
