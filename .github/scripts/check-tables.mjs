#!/usr/bin/env node
// **Una tabella scritta resta una tabella, e con tutte le sue colonne.**
//
// Il difetto che ha fatto scrivere questo conto stava in due file e si leggeva
// solo guardando la pagina resa, mai il sorgente: in `docs/decisions/README.md`
// una riga vuota si era infilata fra la voce 0076 e la voce 0077, e in
// `docs/architecture/wit-congelato.md` fra la 0049 e la 0051. In GFM una riga
// vuota **chiude** la tabella, e le righe che seguono — che al sorgente sono
// identiche a quelle sopra — non sono più righe: diventano un paragrafo solo,
// con i `|` stampati come testo. Nel README erano cinquantotto righe e 214.447
// byte, in `wit-congelato.md` otto righe e 11.174 byte.
//
// Perché nessuno se n'era accorto. Il sorgente è indistinguibile da quello
// giusto: nessun link si rompe, nessun numero cambia, `check-doc-links` continua
// a trovare tutti i bersagli perché i link nel paragrafo restano link. La cosa
// che si perde è **la sola ragione per cui quel testo era una tabella**, cioè le
// colonne, e a vederla bisogna aprire la pagina. È la specie di rottura muta che
// questa cartella esiste per prendere.
//
// Le tre forme in cui una tabella smette di dire ciò che il sorgente sembra
// dire. Le prime due stanno qui insieme perché il sintomo è lo stesso — un
// paragrafo di `|`; la terza tiene in piedi la tabella e falsifica una riga:
//
//   1. **una riga vuota in mezzo al corpo.** La tabella finisce lì.
//   2. **il delimitatore che non ha le colonne dell'intestazione.** Se
//      `|---|---|` non ha lo stesso numero di celle della riga sopra, GFM non
//      apre nessuna tabella: l'intero blocco è un paragrafo dalla prima riga.
//      Quante tabelle ci sono lo stampa questo script in coda, a ogni corsa:
//      è lì che un numero del genere si ricontrolla, non in un commento che
//      nessuno ricalcola — e nessuna è così; il conto non costa niente e
//      diventa rosso il giorno che succede.
//   3. **una riga di corpo che non ha le celle dell'intestazione.** Qui la
//      tabella resta una tabella, e proprio per questo la pagina resa non
//      denuncia niente: GFM **pareggia in silenzio**, e nei due versi (spec
//      GFM 0.29, esempio 204). Se le celle sono **meno**, «empty cells are
//      inserted»: le righe dei verbali 0135 e 0100 sono vissute così, con tre
//      celle su quattro, e in pagina la loro *Data* era una cella vuota — che è
//      indistinguibile da una data che non c'è ancora. Se sono **di più**,
//      «the excess is ignored»: il testo oltre l'ultima colonna **sparisce**
//      dalla pagina, e nessuno lo va a cercare perché al sorgente c'è.
//
// **Due tabelle attaccate sono legittime**, e la riga vuota che le separa non è
// un difetto: si riconoscono perché dopo la riga vuota viene un'intestazione col
// suo delimitatore. Il conto le lascia passare, e l'autoprova tiene fermo che le
// lasci passare — senza quel caso questa sarebbe la regola che «ripara» una cosa
// voluta.
//
// **Una cella vuota ma presente (`| |`) è a posto**, e il conto la conta come
// una cella: il guasto della terza forma non è la cella senza testo, è la cella
// **mancante**, cioè un numero di pipe diverso.
//
// **Perché il conto guarda le pipe scappate, e perché un code span non salva.**
// Una pipe che fa parte del testo di una cella si scrive `\|` — e la spec lo
// chiede a lettere **anche dentro gli altri span inline** (GFM 0.29, esempio
// 200: *«include a pipe in a cell's content by escaping it, including inside
// other inline spans»*, con `` b `\|` az `` come esempio). I backtick **non**
// proteggono: per GFM il taglio in celle viene prima, e un `` `a | b` `` dentro
// una cella sono due celle. Questo conto è nato trovandone due scritte così,
// vive da mesi e invisibili: `` `string | null` `` nel registro delle decisioni
// e `` `map_err(|e| e.to_string())` `` in `docs/roadmap/strozzature.md`, dove le
// due pipe della chiusura Rust facevano cinque celle su tre e mangiavano in
// pagina metà dell'ultima colonna. **Chi vedrà questo conto rosso su una riga
// del genere non stia a cercare un bug qui**: la riga è davvero rotta, e la
// riparazione è scrivere `\|`. Per la stessa ragione esentare i code span dal
// taglio sarebbe la cosa sbagliata — verrebbe un conto che resta verde su una
// riga che in pagina è rotta, cioè un presidio che mente.
//
// # Le zone cieche, dichiarate
//
// Il corpo di una tabella lo si segue finché le righe cominciano per `|`.
// Chiudere una tabella si può anche in altri modi — una riga di testo senza
// pipe, un `#`, una lista — e quelli qui non si vedono: sono forme in cui il
// sorgente *si legge* rotto, mentre quella che ha fatto nascere il conto si
// legge intatta. E un blocco recintato (` ``` `) lo si salta per intero, perché
// una tabella scritta come esempio dentro il codice non è una tabella di
// nessuno; il prezzo è che un esempio rotto non lo prende nessuno.
//
// Uso:
//   node .github/scripts/check-tabelle.mjs [cartella]
//   node .github/scripts/check-tabelle.mjs --autoprova
// Exit code 1 se una tabella è interrotta o se una riga non ha le sue colonne,
// o se non c'è niente da controllare.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/// Il delimitatore GFM: `|---|:--:|`, con al più tre spazi davanti e le barre
/// esterne facoltative.
const RE_DELIMITATORE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/// Una riga di tabella: comincia per `|` con al più tre spazi davanti. Il
/// quarto spazio è un blocco di codice indentato, e lì dentro non c'è nessuna
/// tabella.
const RE_RIGA = /^ {0,3}\|/;

/// Il recinto di un blocco di codice, che sia di backtick o di tilde.
const RE_RECINTO = /^ {0,3}(`{3,}|~{3,})/;

/** Quante celle ha una riga, tolte le barre esterne. Un `\|` non divide. */
function celle(riga) {
  let s = riga.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).length;
}

/** `1 cella` / `2 celle`: un messaggio che dice «le 1 celle» si legge scritto da una macchina. */
function quante(n) {
  return n === 1 ? "1 cella" : `${n} celle`;
}

/** Vero se a `i` comincia una tabella: una riga con le pipe e il delimitatore sotto. */
function apreUnaTabella(righe, i) {
  return (
    i + 1 < righe.length &&
    RE_RIGA.test(righe[i]) &&
    RE_DELIMITATORE.test(righe[i + 1]) &&
    righe[i + 1].includes("-")
  );
}

/**
 * I guasti di un file, come `{ riga, cosa }`. Sta fuori dall'I/O apposta:
 * è la funzione che l'autoprova mette alla prova.
 */
export function guastiDi(testo) {
  const righe = testo.split("\n");
  const guasti = [];
  let recinto = null;

  for (let i = 0; i < righe.length; i++) {
    const m = RE_RECINTO.exec(righe[i]);
    if (recinto !== null) {
      if (m && righe[i].trimStart().startsWith(recinto)) recinto = null;
      continue;
    }
    if (m) {
      recinto = m[1][0].repeat(3);
      continue;
    }

    // Un'intestazione con un delimitatore che non ha le sue colonne: qui non
    // nasce nessuna tabella, e il blocco intero è un paragrafo.
    if (
      RE_RIGA.test(righe[i]) &&
      i + 1 < righe.length &&
      RE_DELIMITATORE.test(righe[i + 1]) &&
      righe[i + 1].includes("-") &&
      celle(righe[i + 1]) !== celle(righe[i])
    ) {
      guasti.push({
        riga: i + 2,
        cosa:
          `il delimitatore ha ${celle(righe[i + 1])} colonne e l'intestazione ne ha ` +
          `${celle(righe[i])}: GFM non apre nessuna tabella, è tutto un paragrafo`,
      });
    }

    if (!apreUnaTabella(righe, i)) continue;

    // Il corpo, che si segue finché le righe cominciano per `|`. Ogni riga di
    // corpo deve avere le celle dell'intestazione: GFM pareggia da sé, e in
    // silenzio, quindi la pagina resa non lo dice a nessuno.
    const attese = celle(righe[i]);
    let j = i + 2;
    while (j < righe.length && RE_RIGA.test(righe[j])) {
      const trovate = celle(righe[j]);
      if (trovate !== attese) {
        guasti.push({
          riga: j + 1,
          cosa:
            `la riga di corpo ha ${trovate} celle e l'intestazione (riga ${i + 1}) ne ` +
            `dichiara ${attese}: ` +
            (trovate < attese
              ? `${attese - trovate === 1 ? "manca" : "mancano"} ${quante(attese - trovate)}` +
                `, e GFM pareggia inserendo il vuoto — una colonna vuota si legge come un ` +
                `dato che non c'è ancora`
              : `${trovate - attese === 1 ? "c'è" : "ci sono"} ${quante(trovate - attese)} ` +
                `di troppo, e GFM pareggia ignorando l'eccesso — quel testo sparisce dalla ` +
                `pagina; una pipe che fa parte del testo si scrive \`\\|\`, anche dentro i ` +
                `backtick`),
        });
      }
      j++;
    }

    if (j < righe.length && righe[j].trim() === "") {
      // Due tabelle attaccate: dopo la vuota viene un'intestazione con il suo
      // delimitatore, e allora la riga vuota è quella che le separa.
      const nuova = apreUnaTabella(righe, j + 1);
      if (!nuova && j + 1 < righe.length && RE_RIGA.test(righe[j + 1])) {
        let k = j + 1;
        let byte = 0;
        while (k < righe.length && RE_RIGA.test(righe[k])) {
          byte += Buffer.byteLength(righe[k], "utf8") + 1;
          k++;
        }
        guasti.push({
          riga: j + 1,
          cosa:
            `una riga vuota chiude la tabella aperta alla riga ${i + 1}, e le ` +
            `${k - j - 1} righe che seguono (${byte - 1} byte) diventano un paragrafo solo`,
        });
        i = k - 1;
        continue;
      }
    }
    i = j - 1;
  }

  return guasti;
}

// ---------------------------------------------------------------------------
// Il test del presidio
// ---------------------------------------------------------------------------
//
// Serve per la ragione della trappola numero tre: **un conto che non è mai stato
// rosso non ha dimostrato niente**. I casi che contano sono quelli che devono
// essere rossi (la riga vuota in mezzo, e la riga di corpo scompagnata **nei due
// versi**: una cella in meno e una in più) e quelli che devono restare verdi (le
// due tabelle attaccate, la cella vuota ma presente, il `\|` scappato): senza i
// secondi questo sarebbe un conto che chiama difetto una cosa voluta.

function autoprova() {
  const casi = [
    ["la riga vuota in mezzo al corpo", "| a | b |\n|---|---|\n| 1 | 2 |\n\n| 3 | 4 |\n", 1],
    ["la tabella intatta", "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n", 0],
    [
      "due tabelle attaccate, separate dalla vuota",
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |\n",
      0,
    ],
    ["la tabella che finisce e poi prosa", "| a | b |\n|---|---|\n| 1 | 2 |\n\nuna frase.\n", 0],
    ["il delimitatore con una colonna di meno", "| a | b |\n|---|\n| 1 | 2 |\n", 1],
    [
      "l'esempio dentro il recinto non è una tabella di nessuno",
      "```md\n| a | b |\n|---|---|\n| 1 | 2 |\n\n| 3 | 4 |\n```\n",
      0,
    ],
    ["il `\\|` dentro una cella non divide", "| a\\|b | c |\n|---|---|\n| 1 | 2 |\n", 0],
    ["la riga di corpo con una cella in meno", "| a | b | c |\n|---|---|---|\n| 1 | 2 |\n", 1],
    ["la riga di corpo con una cella in più", "| a | b |\n|---|---|\n| 1 | 2 | 3 |\n", 1],
    ["la cella vuota ma presente è a posto", "| a | b |\n|---|---|\n| 1 | |\n|  |  |\n", 0],
    [
      "la pipe scappata dentro un code span non divide",
      "| a | b |\n|---|---|\n| `map_err(\\|e\\| e.into())` | 2 |\n",
      0,
    ],
    [
      "la pipe NON scappata dentro un code span divide, e la cella di coda sparisce",
      "| a | b |\n|---|---|\n| `string | null` | 2026-08-04 |\n",
      1,
    ],
    [
      "il corpo scompagnato dopo la vuota è del paragrafo, non della tabella",
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n| 3 |\n",
      1,
    ],
  ];

  let rossi = 0;
  for (const [nome, testo, atteso] of casi) {
    const quanti = guastiDi(testo).length;
    if (quanti !== atteso) {
      console.log(`autoprova: ${nome} → ${quanti} guasti, atteso ${atteso}`);
      rossi += 1;
    }
  }
  console.log(`autoprova: ${casi.length} casi, ${rossi} rossi`);
  process.exit(rossi > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes("--autoprova")) autoprova();

  const radice = path.resolve(process.argv[2] ?? process.cwd());
  const esito = spawnSync("git", ["-C", radice, "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (esito.error || esito.status !== 0) {
    console.log("git non risponde qui: non si sa quali file siano prosa di questo repo.");
    process.exit(1);
  }
  const file = esito.stdout.split("\0").filter(Boolean);

  let tabelle = 0;
  let guardati = 0;
  const problemi = [];
  for (const relativo of file) {
    const assoluto = path.resolve(radice, relativo);
    if (!fs.existsSync(assoluto)) continue;
    const testo = fs.readFileSync(assoluto, "utf8");
    guardati += 1;
    const righe = testo.split("\n");
    for (let i = 1; i < righe.length; i++) {
      if (RE_DELIMITATORE.test(righe[i]) && righe[i].includes("-") && RE_RIGA.test(righe[i - 1])) {
        tabelle += 1;
      }
    }
    for (const g of guastiDi(testo)) problemi.push(`${relativo}:${g.riga}  ${g.cosa}`);
  }

  for (const p of problemi) console.log(p);
  if (problemi.length > 0) console.log("");
  const guasti = problemi.length;
  console.log(
    `${tabelle} tabelle in ${guardati} file di prosa, ${guasti} guast${guasti === 1 ? "o" : "i"} ` +
      `(tabella interrotta, o riga senza le sue colonne)`,
  );

  // Come per i link e per la prosa: un presidio che non ha guardato niente non è
  // verde, è spento.
  if (tabelle === 0) {
    console.log("\nnessuna tabella trovata: qui il presidio non sta presidiando niente.");
    process.exit(1);
  }

  process.exit(problemi.length > 0 ? 1 : 0);
}

main();
