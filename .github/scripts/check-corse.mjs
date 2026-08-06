#!/usr/bin/env node
// Dentro un giro non si aspetta di nascosto.
//
// Il difetto era misurato, ed era la stessa frase scritta in molti posti: *la
// mia risposta è scaduta e non me ne accorgo*. La riparazione è
// `frontend/src/ui/corsa.ts`: `atteso` è l'unico modo in cui il corpo di un giro
// ottiene il risultato di un'attesa, e se nel frattempo ne è cominciato uno più
// nuovo il corpo finisce lì invece di arrivare a scrivere.
//
// Quella metà la prende il compilatore: per avere `atteso` bisogna già essere
// dentro un `ultimo(...)`, e non c'è modo di fabbricarlo altrove. Questo conto
// prende l'altra metà — *nessuno scavalca la porta stando dentro* — e sono due
// modi, tutt'e due visti scrivendo la decisione 0134:
//
//  1. **Un `await` nudo.** Aspettare senza passare da `atteso` è la riga che
//     l'intera forma esiste per non avere: da lì in poi il corpo prosegue con un
//     risultato che nessuno ha datato.
//  2. **Un `} catch` dentro il corpo.** È il modo *involontario*, ed è quello
//     che conta: un `catch` scritto per gli errori veri ingoia anche il segnale
//     di scadenza, e da lì il corpo riprende e scrive. Non è teorico — tutte e
//     quattro le implementazioni a mano che la 0134 ha sostituito avevano un
//     `try` attorno alla chiamata, perché tutte e quattro dovevano dire
//     qualcosa quando la chiamata falliva. L'idioma giusto è l'errore che
//     diventa un valore **prima** del cancello: `await atteso(p.catch(…))`.
//
// # Le zone cieche, dichiarate
//
// Un conto è cieco a ciò che non gli si è detto di guardare, e questi sono i
// modi noti di aggirarlo. Il primo è il grande, e va scritto per intero perché
// è più grave di tutti gli altri messi insieme:
//
//  1. **Chi non apre nessun giro.** Questo conto guarda *dentro* gli `ultimo`,
//     quindi non ha niente da dire su una funzione che aspetta e poi scrive
//     senza aver mai nominato una corsa — che è esattamente il difetto
//     originale. Dirlo vorrebbe dire sapere quali `await` sono seguiti da una
//     scrittura, cioè leggere i tipi, e qui si legge del testo. Il censimento
//     della 0134 ne ha contati **trentanove** in `frontend/src/`, di cui questa
//     tornata ne chiude una parte: l'elenco sta nel verbale, e finché non è
//     vuoto è la lista di ciò che questo conto non vede.
//  2. **`.then(…)` al posto di `await`.** Un seguito attaccato con `.then` non è
//     un `await` e non viene guardato: è il solo modo di aspettare dentro un
//     giro senza che questo conto se ne accorga, ed è stato provato costruendolo
//     apposta. Resta scoperto perché coprirlo vorrebbe dire seguire il valore, e
//     qui si legge del testo.
//  3. **I banchi.** `*.test.ts` è escluso: `corsa.test.ts` deve poter costruire
//     apposta i casi che qui sono violazioni.
//
// E due cose che **non** sono zone cieche, scritte perché la prima stesura di
// questo commento diceva che lo fossero, e provarle l'ha smentita:
//
//  - **L'alias** (`const a = atteso; await a(p)`) non sfugge: il criterio non è
//    «esiste un alias» ma «il nome compare nell'espressione attesa», quindi un
//    alias diventa una **violazione**, non un buco. È più severo di così com'era
//    descritto, ed è giusto che lo sia: `atteso` non ha nessuna ragione di
//    cambiare nome.
//  - **La parola dentro un commento** dentro un corpo di giro conta come
//    un'attesa e fa diventare rosso il conto. È un falso positivo, sbaglia verso
//    il rosso, e si toglie riscrivendo il commento — che costa meno di insegnare
//    a questo file dove finiscono i commenti.
//
// Ciò che questo conto **non** dice, e non deve dire: che ogni `await` di
// `frontend/src/` stia dentro un giro. Non è vero e non deve diventarlo — la
// maggior parte delle attese non ha niente da datare, e obbligarle tutte
// renderebbe la porta un rumore da aggirare invece di una regola.
//
// Uso:
//   node .github/scripts/check-corse.mjs [radice]
// Exit code 1 se c'è almeno una violazione, 0 altrimenti.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

/// L'unico file che può scrivere `await` senza `atteso` dentro un `ultimo`: è
/// la porta stessa. Path relativo alla radice del repo.
const LA_PORTA = "frontend/src/ui/corsa.ts";

const radice = process.argv[2] ?? process.cwd();

/// Tutti i `.ts` di `frontend/src/` che non siano banchi.
function sorgenti(dir, out = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      if (voce.name !== "node_modules") sorgenti(p, out);
    } else if (voce.name.endsWith(".ts") && !voce.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

/// Da `apertura` (l'indice della `{` che apre il corpo) all'indice della `}` che
/// lo chiude. Conta le graffe e basta: una `{` dentro una stringa o un commento
/// la sbaglierebbe, ed è una quinta zona cieca che in pratica non si incontra
/// perché i corpi dei giri sono corti.
function fineDelCorpo(testo, apertura) {
  let livello = 0;
  for (let i = apertura; i < testo.length; i++) {
    if (testo[i] === "{") livello++;
    else if (testo[i] === "}") {
      livello--;
      if (livello === 0) return i;
    }
  }
  return testo.length;
}

/// L'espressione che un `await` aspetta: da dopo la parola fino alla chiusura
/// del suo primo gruppo di parentesi, o a fine riga se non ne apre nessuno.
function espressioneAttesa(corpo, dopoAwait) {
  const resto = corpo.slice(dopoAwait + "await".length);
  const apre = resto.indexOf("(");
  const fineRiga = resto.indexOf("\n");
  if (apre === -1 || (fineRiga !== -1 && fineRiga < apre)) {
    return resto.slice(0, fineRiga === -1 ? resto.length : fineRiga);
  }
  let livello = 0;
  for (let i = apre; i < resto.length; i++) {
    if (resto[i] === "(") livello++;
    else if (resto[i] === ")") {
      livello--;
      if (livello === 0) return resto.slice(0, i + 1);
    }
  }
  return resto;
}

const violazioni = [];

for (const file of sorgenti(path.join(radice, "frontend", "src"))) {
  const relativo = path.relative(radice, file).split(path.sep).join("/");
  if (relativo === LA_PORTA) continue;
  const testo = fs.readFileSync(file, "utf8");

  // `.ultimo(async (NOME) => {` — il nome del parametro si legge, così un corpo
  // che lo chiami diversamente resta coperto.
  const apre = /\.ultimo\(\s*async\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g;
  let m;
  while ((m = apre.exec(testo)) !== null) {
    const nome = m[1];
    const inizio = m.index + m[0].length - 1;
    const fine = fineDelCorpo(testo, inizio);
    const corpo = testo.slice(inizio, fine);
    const rigaDi = (offset) => testo.slice(0, inizio + offset).split("\n").length;

    for (const a of corpo.matchAll(/\bawait\b/g)) {
      // L'attesa va bene in due modi, e il secondo è quello che rende la forma
      // ereditabile: o passa da `atteso`, o **consegna `atteso`** a chi aspetta
      // per suo conto (è ciò che `updatePreview` fa con l'idratazione degli
      // embed, dove sta il grosso delle attese di un'anteprima). Il criterio è
      // lo stesso per tutt'e due: il nome compare dentro l'espressione attesa.
      if (new RegExp(`\\b${nome}\\b`).test(espressioneAttesa(corpo, a.index))) continue;
      violazioni.push(
        `${relativo}:${rigaDi(a.index)}: un \`await\` che non nomina \`${nome}\` ` +
          `dentro un giro: il risultato non è datato da nessuno.`,
      );
    }
    for (const c of corpo.matchAll(/\}\s*catch\b/g)) {
      violazioni.push(
        `${relativo}:${rigaDi(c.index)}: un \`catch\` dentro un giro ingoia anche ` +
          `la scadenza. L'errore diventa un valore prima del cancello: ` +
          `\`await ${nome}(promessa.catch(…))\`.`,
      );
    }
  }
}

for (const v of violazioni) console.error(v);
console.log(
  violazioni.length === 0
    ? "check-corse: nessuno scavalca la porta."
    : `check-corse: ${violazioni.length} violazioni.`,
);
process.exit(violazioni.length === 0 ? 0 : 1);
