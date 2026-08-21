#!/usr/bin/env node
// Controllo dei link interni fra i documenti del repo.
//
// Il motivo per cui esiste: una promessa senza presidio meccanico decade. I
// documenti di Fub si rimandano l'un l'altro di continuo — il PIANO manda
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
//   node .github/scripts/check-doc-links.mjs [cartella]
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

// Cartelle che non sono documentazione attiva del repo: artefatti di build, sorgenti
// di terze parti, cartella di git, e registri storici di sedute/decisioni.
const SALTA_CARTELLE = new Set(["node_modules", "target", "dist", ".git", "decisions", "roadmap", "milestones"]);
const SALTA_FILE = new Set(["todo.md"]);

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
 * `docs/` e un vault dell'utente hanno entrambi un `.fub/` dentro, ma il
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
  const file = new Set();
  for (const relativo of esito.stdout.split("\0")) {
    if (!relativo) continue;
    const absFile = path.resolve(radice, relativo);
    file.add(absFile);
    let cartella = path.dirname(absFile);
    while (cartella.startsWith(radice)) {
      cartelle.add(cartella);
      if (cartella === radice) break;
      cartella = path.dirname(cartella);
    }
  }
  return { cartelle, file };
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
    // da questo script. Il marcatore è la **radice unica** che il core ci scrive
    // dentro (decisione 0048) — ma una cartella può essere tutte e due le cose,
    // ed è il caso di `docs/` dal giorno in cui il progetto ha cominciato a
    // mangiare il proprio cibo. Se git ci tiene dei `.md`, è documentazione: il
    // marcatore non basta a mandarla via.
    //
    // Il marcatore è `.fub/` e non la cartella dei *derivati*: quella compare
    // alla prima indicizzazione, mentre `.fub/` compare alla prima cosa che
    // Fub scrive su quel vault, che è prima.
    if (voci.some((v) => v.isDirectory() && v.name === ".fub")) {
      if (tracciate === null || !tracciate.cartelle.has(path.resolve(cartella))) {
        saltate.push(cartella);
        return;
      }
    }

    for (const voce of voci) {
      const percorso = path.join(cartella, voce.name);
      if (voce.isDirectory()) {
        // Le cartelle nascoste (`.git`, `.vite`, `.trash`, `.fub`…)
        // contengono stato, non testo da mantenere.
        if (SALTA_CARTELLE.has(voce.name) || voce.name.startsWith(".")) continue;
        visita(percorso);
      } else if (voce.isFile() && voce.name.toLowerCase().endsWith(".md")) {
        if (SALTA_FILE.has(voce.name)) continue;
        if (tracciate !== null && !tracciate.file.has(path.resolve(percorso))) continue;
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
      // L'etichetta e il resto della riga si leggono dal testo **originale**,
      // non da quello mascherato: la maschera conserva gli offset apposta, e
      // qui servono i backtick — è dentro i tratti di codice in linea che
      // stanno sia il `file.rs:N` sia il nome della cosa che la riga descrive.
      const inizioRiga = testo.lastIndexOf("\n", m.index) + 1;
      const fineRiga = testo.indexOf("\n", m.index);
      const testoRiga = testo.slice(inizioRiga, fineRiga === -1 ? testo.length : fineRiga);
      const etichetta = testo.slice(m.index + 1, testo.indexOf("]", m.index));

      link.push({
        destinazione,
        etichetta,
        testoRiga,
        riga: rigaDiOffset(mascherato, m.index),
      });
    }
  }

  link.sort((a, b) => a.riga - b.riga);
  return link;
}

// ---------------------------------------------------------------------------
// Numeri di riga
// ---------------------------------------------------------------------------
//
// Un link `[`abi/model.rs:600`](../crates/fub-abi/src/model.rs)` promette due
// cose e questo controllo, fino alla §16.8, ne verificava una: che il file ci
// sia. Il `:600` invecchia da solo — a ogni commit che aggiunge qualcosa più in
// alto in quel file, cioè **senza che nessuno tocchi né la voce né la cosa che
// nomina**. È la specie peggiore da presidiare a mano e la più facile a
// macchina, perché il link il file lo apre già: manca solo di leggere due
// caratteri in più.
//
// Cosa si verifica: che a quella riga ci sia ancora **la cosa che la voce
// nomina**. Il nome non va dichiarato — è già scritto lì accanto, nei tratti di
// codice in linea della stessa riga (`Anchor`, `LinkTarget::Wiki`,
// `HostQuery::query_index`). Se nessuno di quei nomi compare alla riga N, il
// link è stantio; e siccome il nome c'è, il controllo sa anche **dove è
// finito** e lo dice, così ripararlo è copiare un numero invece di cercarlo.

/**
 * Le estensioni che fanno di un tratto `qualcosa:N` l'**ancoraggio a un file**
 * invece di una citazione qualunque con due punti dentro.
 *
 * Sta in una costante sola perché la leggono due parti che devono restare
 * d'accordo: `nomiPromessi`, che rifiuta di cercare un percorso dentro un
 * sorgente, e il conto degli ancoraggi di prosa in fondo. Se le due divergono,
 * un ancoraggio esce da un conto senza entrare nell'altro, e sparisce da tutti
 * e due i totali.
 */
const ESTENSIONI_DI_FILE = /\.(json|md|mjs|js|rs|ts|tsx|toml|wit)$/;

/** Le parole che in un tratto di codice non sono un nome da cercare. */
const PAROLE_NON_NOMI = new Set([
  "pub", "fn", "let", "mut", "self", "crate", "super", "use", "mod", "impl",
  "for", "the", "and", "not", "una", "uno", "che", "del", "della", "con",
]);

/**
 * I nomi che una riga di documento promette di trovare in fondo al link: i
 * tratti di codice in linea della riga, meno quello che è il link stesso,
 * spezzati sui separatori (`::`, `/`, `.`, `<`, `>`) e tenuti se lunghi almeno
 * tre caratteri.
 */
function nomiPromessi(testoRiga, etichetta) {
  const nomi = new Set();
  for (const m of testoRiga.matchAll(/`([^`]+)`/g)) {
    const tratto = m[1];
    if (tratto === etichetta.replace(/`/g, "")) continue;
    // Un percorso non è un simbolo: `.fub/workspace.json` non si cerca dentro
    // `organization.rs`, e cercarlo lo stesso troverebbe un `workspace`
    // qualsiasi a riga 1 e chiamerebbe verde un link stantio.
    if (tratto.includes("/") || ESTENSIONI_DI_FILE.test(tratto)) continue;
    for (const pezzo of tratto.split(/[^A-Za-z0-9_]+/)) {
      if (pezzo.length >= 3 && !PAROLE_NON_NOMI.has(pezzo.toLowerCase())) nomi.add(pezzo);
    }
  }
  return [...nomi];
}

/**
 * Dove è finita la cosa che il link nomina: la riga (1-based) che la
 * **definisce**, se c'è, altrimenti la prima che la nomina, altrimenti `null`.
 *
 * L'ordine conta più di quanto sembri. Un nome come `Block` compare cinquanta
 * volte in `model.rs` — quasi tutte in un commento — e suggerire la prima
 * occorrenza vorrebbe dire riparare un numero stantio con un altro numero
 * stantio, che è il difetto di questa voce fatto a macchina.
 */
function dovEFinito(righe, nomi) {
  const definizione = nomi.map((n) => new RegExp(`\\b(struct|enum|trait|fn|const|type)\\s+${n}\\b`));
  const menzione = nomi.map((n) => new RegExp(`\\b${n}\\b`));

  for (const re of [definizione, menzione]) {
    for (let i = 0; i < righe.length; i += 1) {
      if (re.some((r) => r.test(righe[i]))) return i + 1;
    }
  }
  return null;
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
    console.log(`saltato l'albero ${dove}/ — è un vault (.fub/)`);
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
  let totaleRighe = 0;
  let righeSenzaNome = 0;
  // Gli ancoraggi di **prosa**: un tratto `file.rs:N` che nessun link della sua
  // riga risolve per nome di file. Non si verificano — la ragione sta accanto
  // al conto, in fondo — ma si contano, perché una zona cieca senza un numero
  // è indistinguibile da una che cresce.
  let ancoraggiDiProsa = 0;
  // Le ancore già viste, per etichetta o accanto a un link: una riga con due
  // link allo stesso file le farebbe contare due volte, e un'ancora che è stata
  // verificata non è prosa.
  const ancoreViste = new Set();
  const problemi = [];

  for (const percorso of file) {
    const testo = fs.readFileSync(percorso, "utf8");
    const cartella = path.dirname(percorso);

    for (const { destinazione, etichetta, testoRiga, riga } of estraiLink(testo)) {
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

      // Un link dentro `node_modules/` è la sola specie che passa qui e fallisce
      // in CI: sulla macchina di chi scrive le dipendenze sono installate, nel
      // job `docs` no (non esegue `npm ci`, perché non gli serve altro). Il
      // verde locale diceva il falso, e il rosso arrivava da un'altra parte —
      // per questo si rifiuta **prima** di guardare se il file c'è, invece di
      // lasciarlo dipendere da com'è fatta la macchina.
      if (relativo.split(path.sep).includes("node_modules")) {
        segnala("punta dentro node_modules/ — non è nel repo e in CI non esiste");
        continue;
      }

      if (!fs.existsSync(bersaglio)) {
        segnala("il file non esiste");
        continue;
      }

      // Verifica un `:N` contro il file linkato. `ancora` è il tratto di codice
      // che porta il numero — l'etichetta del link, o quello che gli sta
      // accanto — e serve a due cose: leggerne il numero, ed escluderlo dai
      // nomi da cercare (sé stesso non è la cosa che promette).
      const verificaAncora = (ancora, numero) => {
        totaleRighe += 1;
        const nomi = nomiPromessi(testoRiga, ancora);
        const righeBersaglio = fs.readFileSync(bersaglio, "utf8").split("\n");

        // **Il limite si controlla per primo, e non ha bisogno di nessun nome.**
        //
        // Sono due domande diverse e fino a qui stavano in una catena sola: *a
        // quella riga c'è la cosa che il documento nomina* vuole un nome da
        // cercare, ma *quella riga esiste* vuole solo il file. Chiedendole
        // insieme, i `:N` la cui riga non offre un simbolo cercabile uscivano
        // dal ramo prima di arrivare qui, e con loro se ne andava anche la metà
        // che si poteva rispondere: un `dispatcher.rs:589` su un file che ne ha
        // 400 è rotto e basta, e per dirlo non serve sapere altro.
        //
        // È il verso in cui questo presidio invecchia: un file si **accorcia** —
        // una funzione tolta, un modulo spostato — e ogni ancora oltre la nuova
        // fine punta al vuoto. Misurato al 2026-08-09: dei 36 ancoraggi senza
        // nome nessuno sfora oggi, quindi questo ramo nasce vuoto. Sta qui
        // perché il caso nuovo entri in rumore invece che in silenzio, che è la
        // sola ragione per cui un presidio si scrive prima del difetto.
        if (numero > righeBersaglio.length) {
          segnala(`il file ha ${righeBersaglio.length} righe, il link ne cita ${numero}`);
          return;
        }

        if (nomi.length === 0) {
          // Non si inventa un nome: la riga non promette niente di cercabile, e
          // il conto in fondo lo dice invece di far finta di aver controllato.
          // Ciò che resta scoperto qui è **solo** «a quella riga c'è la cosa
          // giusta»; che la riga esista l'ha già chiesto il ramo qui sopra.
          righeSenzaNome += 1;
        } else if (!nomi.some((n) => new RegExp(`\\b${n}\\b`).test(righeBersaglio[numero - 1]))) {
          const dove = dovEFinito(righeBersaglio, nomi);
          segnala(
            `alla riga ${numero} non c'è ${nomi.map((n) => `\`${n}\``).join(" né ")}` +
              (dove === null ? " (e non c'è da nessuna parte)" : `: è a ${dove}`),
          );
        }
      };

      // Un numero di riga si verifica solo contro un sorgente: un `.md` linkato
      // si àncora col `#`, non con un numero di riga.
      const bersaglioNumerabile =
        fs.statSync(bersaglio).isFile() && !bersaglio.toLowerCase().endsWith(".md");

      // Il `:N` dell'etichetta, se c'è.
      const etichettaNuda = etichetta.replace(/`/g, "").trim();
      const conRiga = etichettaNuda.match(/^(\S+):(\d+)$/);
      if (conRiga && bersaglioNumerabile) {
        // Anche l'etichetta entra fra le viste: quando è scritta fra backtick
        // (`` [`Cargo.toml:15`](../Cargo.toml) ``) il conto della prosa qui
        // sotto la incontrerebbe di nuovo e la chiamerebbe non verificata.
        ancoreViste.add(`${percorso}|${riga}|${etichettaNuda}`);
        verificaAncora(etichetta, Number(conRiga[2]));
      }

      // **E il `:N` che viaggia ACCANTO al link invece che dentro l'etichetta.**
      //
      // `docs/versionamento.md` lo scrive così, due volte:
      //
      //     [`ABI_VERSION`](../crates/fub-abi/src/traits.rs) (`traits.rs:3773`)
      //
      // La promessa è la stessa di un'etichetta `file:N` — *quel simbolo è a
      // quella riga* — ma il numero sta in un secondo tratto di codice, e per
      // questo controllo era invisibile: erano gli unici due ancoraggi del
      // documento fuori dalla tabella degli schemi, cioè gli unici che
      // `crates/fub-app/tests/schemi_su_disco.rs` non giudica. Nessuno li
      // guardava, ed erano sbagliati tutt'e due — la stessa specie di
      // invecchiamento che ha fatto scrivere il blocco qui sopra.
      //
      // A quale file si riferiscano non si indovina: si legge dal link accanto.
      // L'ancora vale se il suo nome di file è quello in fondo alla
      // destinazione, e allora è **la stessa espressione** che verifica le
      // etichette. Un tratto `file:N` che nessun link della riga risolve non è
      // un ancoraggio: è prosa che nomina un punto senza portarci (le righe
      // della tabella dei difetti di `docs/todo.md` sono così, e sono misure
      // datate che non devono diventare rosse). Quella è la zona cieca, ed è
      // dichiarata qui invece che taciuta.
      if (bersaglioNumerabile) {
        const nomeFile = path.basename(parteFile);
        for (const m of testoRiga.matchAll(/`([^`]+)`/g)) {
          const tratto = m[1].trim();
          if (tratto === etichettaNuda) continue; // già verificato come etichetta
          const accanto = tratto.match(/^(\S+):(\d+)$/);
          if (accanto === null || path.basename(accanto[1]) !== nomeFile) continue;
          const chiave = `${percorso}|${riga}|${tratto}`;
          if (ancoreViste.has(chiave)) continue; // già verificata su questa riga
          ancoreViste.add(chiave);
          verificaAncora(`\`${tratto}\``, Number(accanto[2]));
        }
      }

      if (!frammento) continue;
      if (!fs.statSync(bersaglio).isFile() || !bersaglio.toLowerCase().endsWith(".md")) continue;

      const ancore = ancoreDiFile(bersaglio);
      if (ancore && !ancore.has(decodeURIComponent(frammento).toLowerCase())) {
        segnala(`il file c'è, ma non ha l'ancora #${frammento}`);
      }
    }

    // **Quanti ancoraggi questo presidio non ha nemmeno aperto.**
    //
    // Il ciclo qui sopra passa dai link: un `file.rs:N` che nessun link della
    // sua riga risolve per nome di file non ci entra mai, e fino a qui non
    // entrava neanche nel totale. Il riassunto diceva «153 con un numero di
    // riga» e taceva sui 112 che non aveva guardato — **la stessa specie di
    // difetto che questo script presidia**, fatta al riassunto di questo
    // script: un conto cieco a ciò che nessuno gli ha detto di guardare, verde
    // mentre la cosa cresce.
    //
    // Contarli non vuol dire verificarli, e la distinzione non è timidezza. Un
    // tratto senza link accanto **non dice a quale file si riferisca**:
    // `traits.rs:2912` sono tre file diversi in questo repo, e sceglierne uno
    // è indovinare. E la maggior parte di questi sta in due posti che devono
    // poter invecchiare — la tabella dei difetti di `docs/todo.md` e le sedute
    // della roadmap — perché sono misure **datate**: renderle rosse quando quel
    // file si accorcia vorrebbe dire chiedere a un verbale di restare vero, che
    // è precisamente ciò che un verbale non promette. Da cui: il numero sì, il
    // giudizio no.
    //
    // Zona cieca dichiarata, misurata: l'ancora è il **tratto di codice**,
    // quindi un `dispatcher.rs:589` scritto senza backtick non entra in questo
    // conto — provato, il numero non si muove. È il verso giusto in cui
    // sbagliare: la convenzione di questi documenti è che un riferimento a un
    // sorgente stia fra backtick, e chi la rompe si toglie dal conto **e**
    // dalla verifica insieme, cioè non guadagna un verde, perde una lettura.
    mascheraBlocchiDiCodice(testo, { inLinea: false })
      .split("\n")
      .forEach((rigaTesto, i) => {
        for (const m of rigaTesto.matchAll(/`([^`]+)`/g)) {
          const tratto = m[1].trim();
          const ancoraggio = tratto.match(/^(\S+):\d+$/);
          if (ancoraggio === null || !ESTENSIONI_DI_FILE.test(ancoraggio[1])) continue;
          if (ancoreViste.has(`${percorso}|${i + 1}|${tratto}`)) continue;
          ancoraggiDiProsa += 1;
        }
      });
  }

  for (const p of problemi) {
    console.log(`${p.file}:${p.riga}  link rotto -> ${p.destinazione}  (${p.motivo})`);
  }
  if (problemi.length > 0) console.log("");
  console.log(
    `${file.length} file controllati, ${totaleLink} link, ${problemi.length} rotti` +
      ` — di cui ${totaleRighe} con un numero di riga` +
      (righeSenzaNome > 0 ? `, ${righeSenzaNome} senza un nome accanto da cercare` : ""),
  );
  // La zona cieca la dice il riassunto, non il solo commento nel codice: chi
  // legge l'uscita deve poter vedere quanto è grande ciò che non è stato
  // guardato senza aprire questo file.
  if (ancoraggiDiProsa > 0) {
    console.log(
      `${ancoraggiDiProsa} ancoraggi di prosa, non verificati: un \`file.rs:N\` che nessun link` +
        ` della sua riga\nrisolve non dice a quale file si riferisca, ed è per lo più una misura` +
        ` datata — la tabella\ndei difetti, le sedute della roadmap — che non deve diventare rossa` +
        ` quando quel file cambia.`,
    );
  }

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
