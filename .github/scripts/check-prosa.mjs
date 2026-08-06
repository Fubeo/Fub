#!/usr/bin/env node
// **La prosa che parla dei sorgenti** (§16.8): i numeri che afferma e le
// garanzie che dichiara.
//
// Il motivo per cui esiste è lo stesso di `check-doc-links.mjs`, un piano più
// in su. Là il difetto era un link a un file che non c'è più; qui è una frase
// che dice «le quattordici famiglie» quando le famiglie sono diciassette. Un
// link rotto almeno si vede cliccandoci; un numero sbagliato si legge, si
// crede, e ci si costruisce sopra — e nessuno lo ricontrolla, perché il motivo
// per cui si scrive un conteggio è smettere di doverlo contare.
//
// Che sia una famiglia e non un incidente lo dice il censimento della §16.8: un
// giro dedicato ha trovato falsi i numeri dell'`HostApi` (dichiarata di
// ventitré metodi e di trentadue **nello stesso file**, mentre il contratto ne
// ha trentaquattro), due `SCHEMA_VERSION` su disco, le capacità di un banco di
// prova, le famiglie del varco scritte tre volte, le funzioni del banco di
// conformità. Nessuno di questi ha mai rotto un test.
//
// E c'è una specie peggiore dell'invecchiamento, che il censimento ha trovato
// due volte: il numero **falso il giorno in cui è stato scritto**. Succede ogni
// volta che un conteggio si scrive a mano nello stesso commit che cambia ciò
// che conta — si misura, si scrive, e in mezzo si aggiunge una riga. Un numero
// invecchiato si aggiorna; uno che non è mai stato ricavato dalla sua sorgente
// si aggiorna e torna falso al giro dopo. È la ragione per cui questo presidio
// non tiene i valori: tiene i **comandi**.
//
// La forma. Un numero che afferma qualcosa sui sorgenti si scrive accanto a
// come lo si ricava:
//
//     le **quattordici** famiglie di capacità [conta: guard-famiglie]
//
// Il comando sta in `conteggi.mjs`, una volta sola, con la sua ragione accanto;
// la prosa lo cita per nome quante volte vuole. È la stessa forma del
// `rules_mirror.rs` → `rules-samples.json` della decisione 0020, applicata alla
// prosa invece che alle regole: **un posto in cui scriverlo, due da cui
// leggerlo**.
//
// L'annotazione è testo semplice apposta. Un `<!-- … -->` funzionerebbe nei
// `.md` e in nessun altro posto, e ne mancherebbe metà: la prima falsità che il
// censimento ha trovato stava in un commento di `guard.rs`, cioè nello **stesso
// file** del codice che descriveva. La distanza fra la frase e la cosa non è la
// ragione per cui una frase invecchia.
//
// **E il secondo controllo, che non è un conteggio.** Il censimento ha trovato
// una specie che batte tutte le altre: la *garanzia dichiarata che non è mai
// esistita* — il cappello di una seduta diceva che una certa cosa
// «violerebbe l'invariante che `dependency_invariant.rs` presidia», e quel file
// non nominava il crate in questione da nessuna parte. Le altre specie sono una
// descrizione invecchiata di qualcosa che esiste; questa no, e non c'è niente da
// aggiornare perché non c'è mai stato niente. Nessuno se ne accorge, perché **il
// motivo per cui si scrive una garanzia è smettere di doverci pensare**: un
// conteggio prima o poi qualcuno lo ricontrolla, una rete che si crede tesa non
// la guarda nessuno.
//
// Il presidio è lo stesso letto al contrario — non «rifai il conto», ma **una
// frase che dice *questo è presidiato da X* deve nominare un X che esiste** — e
// un nome di test è una cosa che si cerca meccanicamente. Qui non serve
// annotare niente: la frase dice già «presidio» e il nome è già fra backtick.
//
// Uso:
//   node .github/scripts/check-prosa.mjs [cartella]
// Exit code 1 se un numero non torna, se una voce del registro non la cita
// nessuno, se una garanzia nomina un test che non c'è, o se non c'è niente da
// controllare.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CONTEGGI } from "./conteggi.mjs";

// L'annotazione, e la coda di riga in cui si va a cercare il numero.
const RE_ANNOTAZIONE = /\[conta:\s*([a-z0-9-]+)\s*\]/g;

// ---------------------------------------------------------------------------
// I numeri scritti in italiano
// ---------------------------------------------------------------------------
//
// Perché serve: questi documenti i numeri li scrivono **in lettere**. «Le
// quattordici famiglie», «un terzo crate per otto funzioni», «trentaquattro
// oggi». Un presidio che sapesse leggere solo `14` non guarderebbe la prosa —
// guarderebbe le tabelle, che sono la parte che invecchia di meno.

const UNITÀ = [
  "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
];
const DIECI_VENTI = [
  "dieci", "undici", "dodici", "tredici", "quattordici",
  "quindici", "sedici", "diciassette", "diciotto", "diciannove",
];
const DECINE = [
  "venti", "trenta", "quaranta", "cinquanta",
  "sessanta", "settanta", "ottanta", "novanta",
];

/** Nome → valore, da zero a novecentonovantanove. */
function tabellaDeiNumeri() {
  const tabella = new Map();
  UNITÀ.forEach((n, i) => tabella.set(n, i));
  DIECI_VENTI.forEach((n, i) => tabella.set(n, 10 + i));

  DECINE.forEach((decina, d) => {
    const decine = (d + 2) * 10;
    tabella.set(decina, decine);
    for (let u = 1; u <= 9; u += 1) {
      // L'elisione: venti + uno fa ventuno, non ventiuno; e il tre prende
      // l'accento perché ha perso l'accento della parola da cui viene.
      const radice = u === 1 || u === 8 ? decina.slice(0, -1) : decina;
      tabella.set(radice + (u === 3 ? "tré" : UNITÀ[u]), decine + u);
    }
  });

  // Il **femminile** di uno. Non è una grafia alternativa di comodo: in
  // italiano il numero concorda col nome che conta, e le cose che questo repo
  // conta sono per metà femminili — «una voce aperta», «una casella residua».
  // Senza questa riga l'unico modo di scrivere il vero era «uno voce», cioè
  // scriverlo sbagliato, o metterci una cifra in mezzo a una frase: il difetto
  // per cui questo file esiste, riprodotto da lui. Vale solo per uno, e la
  // ragione è che l'italiano flette solo lui — «due voci», «ventidue voci».
  tabella.set("una", 1);

  tabella.set("cento", 100);
  // Le centinaia, e non per completezza: il registro dei verbali ha superato
  // cento, quindi da qui in avanti il numero **giusto** non era scrivibile in
  // lettere. Un presidio che non sa leggere la verità costringe a scriverla in
  // cifre in mezzo a una frase, o a lasciarla vecchia — che è precisamente il
  // difetto per cui questo file esiste.
  //
  // La composizione è quella dell'italiano: `cento` davanti al resto, con
  // l'elisione della `o` quando il resto comincia per vocale — centouno resta
  // **anche** valido perché si scrive in tutti e due i modi, mentre
  // centottanta è l'unica forma di 180.
  const finoACento = [...tabella.entries()].filter(([, v]) => v > 0 && v < 100);
  for (let c = 1; c <= 9; c += 1) {
    const centinaio = c === 1 ? "cento" : UNITÀ[c] + "cento";
    tabella.set(centinaio, c * 100);
    for (const [nome, valore] of finoACento) {
      tabella.set(centinaio + nome, c * 100 + valore);
      if (nome.startsWith("o") || nome.startsWith("u")) {
        tabella.set(centinaio.slice(0, -1) + nome, c * 100 + valore);
      }
      // L'accento del tre vale anche qui, e per la stessa ragione per cui vale
      // dopo una decina: in coda a un numero composto il tre lo prende sempre,
      // quindi 103 si scrive **centotré**. Senza questa riga il presidio sapeva
      // leggere solo la grafia sbagliata.
      if (nome === "tre") {
        tabella.set(centinaio + "tré", c * 100 + valore);
      }
    }
  }
  return tabella;
}

const NUMERI = tabellaDeiNumeri();

/**
 * L'ultimo numero scritto prima dell'annotazione, o `null` se non ce n'è uno.
 *
 * «Ultimo» e non «primo» perché la frase che porta il numero spesso ne porta
 * anche altri («3400 righe di cui 1697 di commento»), e l'annotazione si mette
 * subito dopo quello che presidia.
 */
function numeroPrimaDi(testo) {
  // Via l'enfasi e i tratti di codice: `**quattordici**` è quattordici.
  const pulito = testo.replace(/[*_`]/g, "");
  let ultimo = null;

  // Le cifre ammettono il separatore delle migliaia scritto con uno spazio
  // («18 058»), che è come li scrive questo repo.
  for (const m of pulito.matchAll(/\d[\d   ]*\d|\d/g)) {
    ultimo = { valore: Number(m[0].replace(/[^\d]/g, "")), scritto: m[0], fine: m.index + m[0].length };
  }
  for (const m of pulito.matchAll(/\p{L}+/gu)) {
    const valore = NUMERI.get(m[0].toLowerCase());
    if (valore === undefined) continue;
    const fine = m.index + m[0].length;
    if (ultimo === null || fine > ultimo.fine) ultimo = { valore, scritto: m[0], fine };
  }

  return ultimo;
}

// ---------------------------------------------------------------------------
// I file in cui si guarda
// ---------------------------------------------------------------------------

/**
 * I file che git traccia e in cui ha senso che ci sia della prosa: i documenti
 * e i sorgenti. Si passa da git e non dal disco perché ciò che non è tracciato
 * non è prosa di questo repo, e perché un albero di build non va guardato.
 */
function fileTracciati(radice) {
  const esito = spawnSync(
    "git",
    ["-C", radice, "ls-files", "-z", "--", "*.md", "*.rs", "*.ts", "*.tsx", "*.wit", "*.toml"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (esito.error || esito.status !== 0) return null;
  return esito.stdout.split("\0").filter(Boolean).map((r) => path.resolve(radice, r));
}

// ---------------------------------------------------------------------------
// Il conto
// ---------------------------------------------------------------------------

/** Esegue il comando di una voce e ne ricava il numero. */
function conta(voce, radice) {
  const esito = spawnSync("sh", ["-c", voce.comando], {
    cwd: radice,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (esito.error) return { errore: String(esito.error.message) };
  if (esito.status !== 0) {
    return { errore: `il comando è uscito con ${esito.status}: ${esito.stderr.trim()}` };
  }
  const uscita = esito.stdout.trim();
  if (!/^\d+$/.test(uscita)) {
    return { errore: `il comando non ha stampato un numero solo, ma «${uscita.slice(0, 80)}»` };
  }
  return { valore: Number(uscita) };
}

// ---------------------------------------------------------------------------
// Le garanzie che la prosa dichiara
// ---------------------------------------------------------------------------

// Le parole con cui si dichiara una garanzia. Non si guardano tutte le frasi:
// un documento nomina cento funzioni, e la metà sono quelle che *non* esistono
// ancora ed è il punto di nominarle. Ciò che dev'essere vero **adesso** è la
// riga che dice «questo è presidiato da X».
const RE_GARANZIA = /presid|verificat[ao] d|il test è|i test sono/i;

// Un nome di test: `snake_case` con almeno un underscore. È la forma che hanno
// tutti i test di questo repo, e non è la forma di un metodo del contratto
// citato di passaggio — quelli stanno in frasi che non dicono «presidio».
const RE_NOME_TEST = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** Tutti i `fn` dichiarati nei sorgenti, come insieme di nomi. */
function funzioniDeiSorgenti(file) {
  const nomi = new Set();
  for (const percorso of file) {
    if (!/\.(rs|ts|tsx)$/.test(percorso)) continue;
    let testo;
    try {
      testo = fs.readFileSync(percorso, "utf8");
    } catch {
      continue;
    }
    // Il nome di un banco di prova è tanto un `fn` quanto il **file** che lo
    // contiene: la prosa dice «il presidio è `wit_conformance`» intendendo
    // `crates/fub-abi/tests/wit_conformance.rs`, e ha ragione lei. Un file di
    // test è un nome che esiste esattamente quanto una funzione.
    nomi.add(path.basename(percorso).replace(/\.(rs|ts|tsx)$/, ""));
    for (const m of testo.matchAll(/\bfn\s+([a-z_][A-Za-z0-9_]*)/g)) nomi.add(m[1]);
    for (const m of testo.matchAll(/\b(?:function|it|test)\s*\(?\s*["'`]?([a-z_][A-Za-z0-9_]*)/g)) {
      nomi.add(m[1]);
    }
  }
  return nomi;
}

/**
 * I nomi di test che una riga di prosa dichiara presidianti e che nei sorgenti
 * non esistono.
 *
 * Il nome del file in cui il test starebbe non si controlla qui: è un link, e i
 * link li presidia `check-doc-links.mjs`. Questo guarda la sola cosa che quello
 * non può vedere — che il **nome** dentro il file sia un `fn` vero.
 */
function garanzieVuote(riga, funzioni) {
  if (!RE_GARANZIA.test(riga)) return [];
  const mancanti = [];
  for (const m of riga.matchAll(/`([^`]+)`/g)) {
    const nome = m[1];
    if (!RE_NOME_TEST.test(nome) || funzioni.has(nome)) continue;
    mancanti.push(nome);
  }
  return mancanti;
}

// ---------------------------------------------------------------------------
// Il test del presidio
// ---------------------------------------------------------------------------
//
// Esiste per la stessa ragione del test del test in `dieta_ipc.rs`: qui la
// parte fragile non è il confronto, è **il lettore di numeri**. Se
// `numeroPrimaDi` sbagliasse a leggere «ventitré», il presidio non urlerebbe —
// direbbe che non c'è nessun numero, o peggio leggerebbe il numero prima e lo
// troverebbe uguale per caso. Un presidio che si spegne in silenzio è il
// difetto che questa voce descrive, fatto al presidio stesso.
//
// Gira con `--autoprova`, e in CI prima del controllo vero.

function autoprova() {
  const casi = [
    ["le quattordici famiglie ", 14],
    ["ne conta **ventitré** ", 23],
    ["ventuno, ventotto e trentuno: l'ultimo vince ", 31],
    // Il femminile di uno: «una voce aperta» dev'essere leggibile, o il vero
    // non è scrivibile in italiano corretto.
    ["**una** voce aperta ", 1],
    ["ventuna non è una parola, quindi qui vale l'ultimo che c'è: una ", 1],
    ["**trentaquattro** oggi ", 34],
    ["il contratto è **18 058** righe ", 18058],
    ["3400 righe di cui 1697 di commento ", 1697],
    ["`SCHEMA_VERSION` a 5 ", 5],
    ["cento capacità ", 100],
    // Le centinaia: il registro dei verbali ha superato cento, e la forma con
    // l'elisione (centotto) e quella senza (centoventuno) devono valere
    // entrambe — le si trova scritte tutte e due.
    ["**centouno** verbali ", 101],
    ["centodiciassette chiuse ", 117],
    // E l'accento del tre in coda: 103 si scrive **centotré**, non «centotre».
    ["**centotré** verbali ", 103],
    ["centotto capacità ", 108],
    ["centoventuno righe ", 121],
    ["duecentocinquanta ", 250],
    ["nessun numero qui dentro ", null],
    // **Zero non è «nessun numero»**, e la distinzione è di questo lettore: chi
    // lo chiama distingue `null` (l'annotazione non presidia niente, ed è un
    // problema) da un numero che vale zero (una cosa che è stata contata e non
    // c'è, ed è il caso normale di un conteggio che deve **scendere** —
    // `diagnostica-shell` ci è arrivato). Se le due si confondessero, un
    // conteggio a zero diventerebbe rosso per la ragione sbagliata.
    ["oggi sono **zero** ", 0],
    // Le parole che *sembrano* numeri e non lo sono: «sei» verbo, che in questi
    // documenti compare quanto «sei» numero. Il presidio non sa distinguerle, e
    // va bene così — il caso è qui per ricordare che l'annotazione si mette
    // dopo il numero e non a fine frase.
    ["sei ", 6],
  ];

  let rossi = 0;
  for (const [testo, atteso] of casi) {
    const letto = numeroPrimaDi(testo);
    const valore = letto === null ? null : letto.valore;
    if (valore !== atteso) {
      console.log(`autoprova: «${testo.trim()}» → ${valore}, atteso ${atteso}`);
      rossi += 1;
    }
  }

  console.log(`autoprova: ${casi.length} casi, ${rossi} rossi`);
  process.exit(rossi > 0 ? 1 : 0);
}

function main() {
  if (process.argv.includes("--autoprova")) autoprova();
  const radice = path.resolve(process.argv[2] ?? process.cwd());
  const file = fileTracciati(radice);
  const problemi = [];

  if (file === null) {
    console.log("git non risponde qui: non si sa quali file siano prosa di questo repo.");
    process.exit(1);
  }

  // Prima i conti, una volta ciascuno: la stessa voce è citata da più parti.
  const valori = new Map();
  for (const voce of CONTEGGI) {
    const esito = conta(voce, radice);
    if (esito.errore) {
      problemi.push(`registro: la voce «${voce.nome}» non conta niente — ${esito.errore}`);
      continue;
    }
    valori.set(voce.nome, esito.valore);
  }

  // Poi la prosa.
  const citazioni = new Map(CONTEGGI.map((v) => [v.nome, 0]));
  const funzioni = funzioniDeiSorgenti(file);
  let totale = 0;
  let garanzie = 0;

  for (const percorso of file) {
    let testo;
    try {
      testo = fs.readFileSync(percorso, "utf8");
    } catch {
      continue; // binario o illeggibile: non è prosa
    }

    const relativo = path.relative(radice, percorso);
    const righe = testo.split("\n");

    // Le garanzie si guardano solo nei documenti — dentro un sorgente, un nome
    // di funzione che non esiste non passa il compilatore — e non nei verbali,
    // per la stessa ragione per cui i conteggi non li guardano: un verbale è
    // **prosa datata**, e dice cos'era vero quel giorno. Non è una scappatoia:
    // è la sola regola sotto cui un verbale può raccontare un nome che è
    // cambiato, o citarne uno per dire che non esisteva — che è esattamente ciò
    // che due di loro fanno, ed è il lavoro che questo presidio continua.
    const verbale = /docs[\\/]decisions[\\/]/.test(percorso);
    if (/\.md$/.test(percorso) && !verbale) {
      righe.forEach((riga, i) => {
        for (const nome of garanzieVuote(riga, funzioni)) {
          garanzie += 1;
          problemi.push(
            `${relativo}:${i + 1}  dice di essere presidiata da \`${nome}\`, che nei sorgenti non è nessun \`fn\``,
          );
        }
      });
    }

    // E i conteggi non si guardano nei verbali, per la stessa ragione: un
    // verbale può citare un'annotazione per mostrarne la forma, o scrivere il
    // numero di allora. Presidiarlo vorrebbe dire chiedere a un documento datato
    // di restare vero, che è l'opposto di ciò che è.
    if (verbale || !testo.includes("[conta:")) continue;

    righe.forEach((riga, i) => {
      RE_ANNOTAZIONE.lastIndex = 0;
      let m;
      while ((m = RE_ANNOTAZIONE.exec(riga)) !== null) {
        const nome = m[1];
        totale += 1;
        const dove = `${relativo}:${i + 1}`;

        if (!valori.has(nome)) {
          const registrato = citazioni.has(nome);
          problemi.push(
            `${dove}  [conta: ${nome}] — ` +
              (registrato ? "la voce c'è nel registro ma non ha contato" : "nessuna voce con questo nome nel registro"),
          );
          continue;
        }
        citazioni.set(nome, citazioni.get(nome) + 1);

        const numero = numeroPrimaDi(riga.slice(0, m.index));
        if (numero === null) {
          problemi.push(`${dove}  [conta: ${nome}] — non c'è nessun numero prima dell'annotazione`);
          continue;
        }
        if (numero.valore !== valori.get(nome)) {
          problemi.push(
            `${dove}  dice «${numero.scritto}», ma ${nome} conta ${valori.get(nome)}`,
          );
        }
      }
    });
  }

  // E la direzione che nessuno guarda: una voce che non cita più nessuno. Un
  // registro che resta lungo mentre la prosa si accorcia smette di essere una
  // fotografia e diventa un ricordo — e il comando che porta dentro continua a
  // girare in CI per niente.
  for (const [nome, quante] of citazioni) {
    if (quante === 0) {
      problemi.push(`registro: la voce «${nome}» non la cita nessuna prosa — toglierla o citarla`);
    }
  }

  for (const p of problemi) console.log(p);
  if (problemi.length > 0) console.log("");
  console.log(
    `${CONTEGGI.length} conteggi nel registro, ${totale} citazioni nella prosa, ` +
      `${garanzie} garanzie che nominano un test inesistente, ` +
      `${problemi.length} problemi in tutto`,
  );

  // Come per i link: un presidio che non ha guardato niente non è verde, è
  // spento. Qui vuol dire che l'annotazione è sparita dalla prosa, e allora il
  // registro sta contando per sé stesso.
  if (totale === 0) {
    console.log("\nnessuna annotazione trovata: qui il presidio non sta presidiando niente.");
    process.exit(1);
  }

  process.exit(problemi.length > 0 ? 1 : 0);
}

main();
