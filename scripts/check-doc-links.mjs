#!/usr/bin/env node
// Controllo dei link interni fra i documenti del repo.
//
// Il motivo per cui esiste: una promessa senza presidio meccanico decade. I
// documenti di FubMD si rimandano l'un l'altro di continuo — il PIANO manda
// alle milestone, le milestone alle decisioni, i README ai test che le
// verificano — e quel reticolo è la parte del repo che fra sei mesi non si
// ricostruisce dal diff. Ma è anche l'unica parte che nessuno compila: un file
// rinominato o cancellato non rompe niente *finché qualcuno non ci clicca*, e a
// quel punto la riga che lo linkava è vecchia di venti commit.
//
// Il sintomo che ha fatto scrivere questo script è esattamente quello:
// `docs/PIANO.md` ha continuato a linkare `ORGANIZZAZIONE_VAULT.md` per tutto
// il tempo in cui quel file non esisteva più (cancellato col commit `0a4ee40`,
// mai scollegato). Nessun test è diventato rosso, nessuna build si è fermata.
// Da qui in poi sì.
//
// Uso:
//   node scripts/check-doc-links.mjs [cartella]
// senza argomenti parte dalla cartella corrente (in CI: la radice del repo).
// Exit code 1 se c'è almeno un link rotto, 0 altrimenti.
//
// Niente dipendenze npm: solo `node:fs`, `node:path` e — per una domanda sola,
// con una risposta di ripiego se manca — `git`. Un presidio che per girare ha
// bisogno di un `npm install` è un presidio che prima o poi si disattiva
// "temporaneamente".
//
// Ciò che questo script non deve poter fare è **smettere di guardare in
// silenzio**: ogni albero saltato è una riga in uscita, e zero file controllati
// è rosso. È la §16.7 della roadmap, e il difetto era reale: aprire `docs/`
// come vault — cioè fare il dogfooding che il progetto chiede — faceva passare
// il controllo da ~1000 link a 21, stampando «0 rotti» in entrambi i casi.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Cartelle che non sono documentazione del repo: artefatti di build, sorgenti
// di terze parti, e la cartella di git.
const SALTA_CARTELLE = new Set(["node_modules", "target", "dist", ".git"]);

// I link che puntano fuori dal repo non sono affare di questo controllo: qui si
// verifica solo ciò che sta su disco accanto ai documenti. Un check dei link
// esterni è un'altra cosa (rete, rate limit, falsi rossi) e non deve stare
// sulla strada di ogni push.
const SCHEMI_ESTERNI = ["http:", "https:", "mailto:"];

// ---------------------------------------------------------------------------
// Raccolta dei file
// ---------------------------------------------------------------------------

/**
 * Le cartelle che contengono documentazione **del repo**: quelle in cui git
 * traccia almeno un `.md`, e tutte le loro antenate fino alla radice.
 *
 * Serve a una cosa sola, ed è la distinzione che il solo marcatore non sa fare:
 * `docs/` e un vault dell'utente hanno entrambi un `.fubmd-data/` dentro, ma il
 * primo è testo che questo repo mantiene e il secondo sono note di qualcuno.
 * Git lo sa già — `docs/` è tracciata, `VaultProva/` è ignorata — e non c'è
 * ragione di indovinarlo con un'euristica peggiore.
 *
 * Restituisce `null` se git non c'è o se la radice non è un checkout: chi
 * chiama, in quel caso, torna alla regola del solo marcatore e **lo dice**.
 */
function documentazioneTracciata(radice) {
  const esito = spawnSync("git", ["-C", radice, "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
  });
  if (esito.error || esito.status !== 0) return null;

  const cartelle = new Set();
  for (const relativo of esito.stdout.split("\0")) {
    if (!relativo) continue;
    let cartella = path.dirname(path.resolve(radice, relativo));
    while (cartella.startsWith(radice)) {
      cartelle.add(cartella);
      if (cartella === radice) break;
      cartella = path.dirname(cartella);
    }
  }
  return cartelle;
}

/**
 * Cammina ricorsivamente `radice` e restituisce i percorsi assoluti dei `.md`.
 *
 * `saltate` viene riempito con gli alberi che la regola del vault ha escluso:
 * chi chiama li stampa, perché un albero che sparisce dal totale senza dirlo è
 * il modo in cui questo presidio si è già spento una volta.
 */
function raccogliMarkdown(radice, tracciate, saltate) {
  const trovati = [];

  const visita = (cartella) => {
    let voci;
    try {
      voci = fs.readdirSync(cartella, { withFileTypes: true });
    } catch {
      return; // cartella illeggibile (permessi, link rotto): non è un errore di link
    }

    // Un vault non è documentazione del repo: sono note dell'utente, e i loro
    // link vanno risolti dalle regole del vault (wikilink, alias, cestino), non
    // da questo script. Il marcatore è la cartella dati che il core ci scrive
    // dentro — ma una cartella può essere tutte e due le cose, ed è il caso di
    // `docs/` dal giorno in cui il progetto ha cominciato a mangiare il proprio
    // cibo. Se git ci tiene dei `.md`, è documentazione: il marcatore non basta
    // a mandarla via.
    if (voci.some((v) => v.isDirectory() && v.name === ".fubmd-data")) {
      if (tracciate === null || !tracciate.has(path.resolve(cartella))) {
        saltate.push(cartella);
        return;
      }
    }

    for (const voce of voci) {
      const percorso = path.join(cartella, voce.name);
      if (voce.isDirectory()) {
        // Le cartelle nascoste (`.git`, `.vite`, `.trash`, `.fubmd-data`…)
        // contengono stato, non testo da mantenere.
        if (SALTA_CARTELLE.has(voce.name) || voce.name.startsWith(".")) continue;
        visita(percorso);
      } else if (voce.isFile() && voce.name.toLowerCase().endsWith(".md")) {
        trovati.push(percorso);
      }
    }
  };

  visita(radice);
  trovati.sort();
  return trovati;
}

// ---------------------------------------------------------------------------
// Lettura del Markdown
// ---------------------------------------------------------------------------

/**
 * Sostituisce con spazi i tratti di codice in linea (`` `…` ``) di una riga.
 *
 * Un percorso fra backtick è una *citazione*, non un link: `[t](nota uno.md)`
 * scritto in mezzo a una frase parla della sintassi, non punta a un file. Il
 * renderer di GitHub la pensa allo stesso modo — dentro un code span non
 * costruisce link — e questi documenti ne sono pieni: la sola sezione sul grafo
 * cita sei esempi di link markdown che non esistono e non devono esistere.
 */
function mascheraCodiceInLinea(riga) {
  let risultato = "";
  let i = 0;

  while (i < riga.length) {
    if (riga[i] !== "`") {
      risultato += riga[i];
      i += 1;
      continue;
    }
    // Apertura: una sequenza di N backtick si chiude con una di esattamente N.
    let n = 0;
    while (riga[i + n] === "`") n += 1;
    const chiusura = riga.indexOf("`".repeat(n), i + n);
    const dopo = chiusura === -1 ? -1 : chiusura + n;
    if (chiusura === -1 || riga[dopo] === "`") {
      // Nessuna chiusura esatta: i backtick sono testo, non delimitatori.
      risultato += riga.slice(i, i + n);
      i += n;
      continue;
    }
    risultato += " ".repeat(dopo - i);
    i = dopo;
  }

  return risultato;
}

/**
 * Restituisce il testo con le righe dentro blocchi recintati (``` o ~~~) e i
 * tratti di codice in linea sostituiti da spazi, conservando lunghezze e a capo.
 *
 * Serve davvero, e non è una raffinatezza: questi documenti sono pieni di
 * alberi di cartelle, frammenti di codice e blocchi di esempio in cui compaiono
 * percorsi che *non* sono link e file che non esistono ancora. Senza questa
 * maschera il controllo urlerebbe a ogni blocco e verrebbe spento entro una
 * settimana. Azzerare le righe invece di toglierle tiene validi gli offset,
 * così i numeri di riga segnalati restano quelli veri.
 */
function mascheraBlocchiDiCodice(testo, { inLinea = true } = {}) {
  const righe = testo.split("\n");
  let recinto = null; // il delimitatore aperto, es. "```" o "~~~~"

  const risultato = righe.map((riga) => {
    const apertura = riga.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (recinto === null) {
      if (apertura) {
        recinto = apertura[1][0].repeat(apertura[1].length);
        return " ".repeat(riga.length);
      }
      return inLinea ? mascheraCodiceInLinea(riga) : riga;
    }
    // Dentro un blocco: si chiude solo con un delimitatore dello stesso tipo e
    // lungo almeno quanto quello che ha aperto.
    if (apertura && apertura[1][0] === recinto[0] && apertura[1].length >= recinto.length) {
      recinto = null;
    }
    return " ".repeat(riga.length);
  });

  return risultato.join("\n");
}

/** Numero di riga (1-based) dell'offset dato. */
function rigaDiOffset(testo, offset) {
  let riga = 1;
  for (let i = 0; i < offset; i += 1) if (testo[i] === "\n") riga += 1;
  return riga;
}

// Link in linea: `[testo](destinazione)`, con titolo facoltativo e con la forma
// `<destinazione>` per i percorsi che contengono spazi.
const RE_LINK_INLINE = /\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
// Link di riferimento: `[etichetta]: destinazione`, a inizio riga.
const RE_LINK_RIFERIMENTO = /^[ \t]{0,3}\[[^\]^]+\]:[ \t]*(<[^>]*>|\S+)/gm;

/**
 * Estrae i link (destinazione + riga) da un documento, saltando i blocchi di
 * codice recintati.
 */
function estraiLink(testo) {
  const mascherato = mascheraBlocchiDiCodice(testo);
  const link = [];

  for (const re of [RE_LINK_INLINE, RE_LINK_RIFERIMENTO]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(mascherato)) !== null) {
      let destinazione = m[1];
      if (destinazione.startsWith("<") && destinazione.endsWith(">")) {
        destinazione = destinazione.slice(1, -1);
      }
      link.push({ destinazione, riga: rigaDiOffset(mascherato, m.index) });
    }
  }

  link.sort((a, b) => a.riga - b.riga);
  return link;
}

// ---------------------------------------------------------------------------
// Ancore
// ---------------------------------------------------------------------------

/**
 * Slug di un'intestazione secondo la regola di GitHub: minuscolo, via la
 * punteggiatura tranne `-` e `_`, spazi in `-`.
 */
function slug(intestazione) {
  return intestazione
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Insieme degli slug delle intestazioni di un documento, con i suffissi `-1`,
 * `-2`… sui duplicati — come li genera GitHub.
 */
function ancoreDi(testo) {
  // Qui i tratti di codice in linea NON si mascherano: GitHub costruisce
  // l'ancora dal testo *reso*, quindi `main.ts` diventa `maints` e non sparisce.
  // Mascherarli come si fa per i link darebbe ancore diverse da quelle vere —
  // cioè falsi negativi proprio sui titoli che nominano un tipo o un file.
  const mascherato = mascheraBlocchiDiCodice(testo, { inLinea: false });
  const visti = new Map();
  const ancore = new Set();

  for (const riga of mascherato.split("\n")) {
    const m = riga.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (!m) continue;

    // Il testo dell'intestazione com'è dopo il rendering: via i `#` di coda e
    // via la sintassi dei link, di cui resta solo l'etichetta.
    const titolo = m[2].replace(/\s+#+\s*$/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

    const base = slug(titolo);
    if (!base) continue;
    const quante = visti.get(base) ?? 0;
    visti.set(base, quante + 1);
    ancore.add(quante === 0 ? base : `${base}-${quante}`);
  }

  return ancore;
}

// ---------------------------------------------------------------------------
// Controllo
// ---------------------------------------------------------------------------

function esterno(destinazione) {
  const d = destinazione.toLowerCase();
  return SCHEMI_ESTERNI.some((s) => d.startsWith(s)) || d.startsWith("//");
}

function main() {
  const radice = path.resolve(process.argv[2] ?? process.cwd());
  const tracciate = documentazioneTracciata(radice);
  const saltate = [];
  const file = raccogliMarkdown(radice, tracciate, saltate);

  for (const cartella of saltate) {
    const dove = path.relative(radice, cartella) || ".";
    console.log(`saltato l'albero ${dove}/ — è un vault (.fubmd-data)`);
  }
  if (tracciate === null && saltate.length > 0) {
    console.log(
      "  (git non risponde qui: non si è potuto distinguere un vault dell'utente\n" +
        "   dalla documentazione del repo che è anche un vault, e si è saltato)",
    );
  }

  // Le ancore del bersaglio si calcolano una volta sola: gli stessi documenti
  // vengono linkati da mezzo repo.
  const cacheAncore = new Map();
  const ancoreDiFile = (percorso) => {
    if (!cacheAncore.has(percorso)) {
      try {
        cacheAncore.set(percorso, ancoreDi(fs.readFileSync(percorso, "utf8")));
      } catch {
        cacheAncore.set(percorso, null);
      }
    }
    return cacheAncore.get(percorso);
  };

  let totaleLink = 0;
  const problemi = [];

  for (const percorso of file) {
    const testo = fs.readFileSync(percorso, "utf8");
    const cartella = path.dirname(percorso);

    for (const { destinazione, riga } of estraiLink(testo)) {
      if (!destinazione || esterno(destinazione) || destinazione.startsWith("#")) continue;
      totaleLink += 1;

      const taglio = destinazione.indexOf("#");
      const parteFile = taglio === -1 ? destinazione : destinazione.slice(0, taglio);
      const frammento = taglio === -1 ? "" : destinazione.slice(taglio + 1);
      if (!parteFile) continue; // ancora pura scritta come `#…` dopo un percorso vuoto

      // I percorsi nei documenti sono scritti a mano, ma possono essere
      // percent-encoded (gli spazi soprattutto): si prova a decodificare, e se
      // la stringa non è valida si usa com'è.
      let relativo = parteFile;
      try {
        relativo = decodeURIComponent(parteFile);
      } catch {
        /* percorso non codificato: va bene così */
      }

      const bersaglio = path.resolve(cartella, relativo);
      const segnala = (motivo) =>
        problemi.push({
          file: path.relative(radice, percorso),
          riga,
          destinazione,
          motivo,
        });

      if (!fs.existsSync(bersaglio)) {
        segnala("il file non esiste");
        continue;
      }

      if (!frammento) continue;
      if (!fs.statSync(bersaglio).isFile() || !bersaglio.toLowerCase().endsWith(".md")) continue;

      const ancore = ancoreDiFile(bersaglio);
      if (ancore && !ancore.has(decodeURIComponent(frammento).toLowerCase())) {
        segnala(`il file c'è, ma non ha l'ancora #${frammento}`);
      }
    }
  }

  for (const p of problemi) {
    console.log(`${p.file}:${p.riga}  link rotto -> ${p.destinazione}  (${p.motivo})`);
  }
  if (problemi.length > 0) console.log("");
  console.log(`${file.length} file controllati, ${totaleLink} link, ${problemi.length} rotti`);

  // Un presidio che non ha guardato niente non è verde: è spento. È il modo in
  // cui questo si era già spento una volta, e «0 rotti» lo diceva verde.
  if (file.length === 0) {
    console.log(
      "\nnessun documento controllato: qui il presidio non sta guardando niente.\n" +
        "Se è la cartella sbagliata è un errore di invocazione; se è un albero saltato\n" +
        "qui sopra, quello è il difetto.",
    );
    process.exit(1);
  }

  process.exit(problemi.length > 0 ? 1 : 0);
}

main();
