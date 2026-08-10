#!/usr/bin/env node
// Cosa un testo riscritto non ha il diritto di perdere.
//
// Il motivo per cui esiste: il repo sta per far riscrivere la propria prosa —
// più corta, più schematica, in italiano normale — e **nessuno degli altri
// presidi sa dire se una riscrittura ha perso un significato**. Contano cose e
// verificano che i link puntino a file esistenti: una pagina riscritta male
// resta verde, perché è fluente, i link ci sono, e i numeri che dice sono
// numeri.
//
// Il senso non lo sa giudicare nessuno script, e questo non ci prova. C'è però
// una famiglia di errori che si prende meccanicamente ed è quella che costa di
// più: mentre si accorcia una frase spariscono **numeri, percorsi,
// identificatori, link e marcatori di conteggio**. È il difetto del commit
// `441d376` — la prosa diceva «ventiquattro» e la colonna sommava
// venticinque, in diciannove posti, per giorni, senza che nessun presidio
// potesse vederlo, perché una casella non ha criterio meccanico e il numero
// era scritto in lettere dentro una frase.
//
// Questo conto guarda un file **prima** e **dopo** e dice cosa c'era e non c'è
// più. Non guarda cosa è stato aggiunto: aggiungere è sempre lecito.
//
// Uso:
//   node .github/scripts/check-riscrittura.mjs [<ref-git>] [file...]
//
// Senza argomenti: confronta con `HEAD` tutti i `.md` modificati nell'albero.
// Con un ref: lo stesso, contro quel ref (`node ... HEAD~3`).
// Con dei file: solo quelli.
//
//   --conferma <elenco>   sparizioni volute, separate da virgola. Restano
//                         stampate ma non fanno rosso, e passando per la riga
//                         di comando lasciano una traccia di chi le ha decise.
//
// Exit code 1 se qualcosa è sparito senza conferma, 0 altrimenti. Un file che
// prima non esisteva non è un confronto: si salta, e lo si dice.
//
// **Non va nel giro degli altri presidi.** Quelli girano senza argomenti su
// tutto il repo; questo prende un ref e dei file, e senza niente da confrontare
// è rosso apposta — un conto che non ha guardato niente è spento, non verde. Si
// lancia a mano su ogni ondata di riscrittura, prima di committarla.
//
// Niente dipendenze npm, come gli altri: `node:child_process` e `git`.
//
// **Ciò che non prende, ed è dichiarato**: un fatto raccontato a parole che
// sparisce senza portarsi via un numero o un identificatore. Una frase che
// cambia di senso mantenendo i suoi token. Un numero *aggiunto* sbagliato.
// Quelli li prende solo chi legge — e questo conto serve a lasciargli meno
// roba da controllare, non a sostituirlo.
//
// E una zona cieca precisa, trovata provando il conto e non dedotta: si guarda
// la **presenza**, non quante volte. Un token che compare due volte nello
// stesso file e cambia in un posto solo resta presente, quindi resta verde.
// È il prezzo di non diventare rosso ogni volta che si toglie una ripetizione,
// che è il gesto stesso della semplificazione — ma va saputo, perché il difetto
// del `441d376` sarebbe stato preso solo perché lì **tutte** le diciannove
// copie dicevano lo stesso numero sbagliato.

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// I numeri scritti in lettere
// ---------------------------------------------------------------------------

/**
 * Ogni numero da zero a novecentonovantanove come lo scrive l'italiano.
 *
 * Serve perché la metà dei numeri di questo repo non è fatta di cifre:
 * «**Ottantasette** difetti», «**centoquarantadue** verbali», «le famiglie sono
 * **sette**». Un elenco generato invece che scritto a mano, perché scritto a
 * mano avrebbe le stesse tre righe di ritardo che ha già avuto il glossario.
 *
 * Si genera qualche forma in più di quelle che l'italiano usa davvero
 * (`centoottantotto` accanto a `centottantotto`): sono aghi in un pagliaio, e
 * un ago che non esiste non trova niente.
 */
function numeriInLettere() {
  const unita = [
    "zero", "uno", "due", "tre", "quattro",
    "cinque", "sei", "sette", "otto", "nove",
  ];
  const dieci = [
    "dieci", "undici", "dodici", "tredici", "quattordici",
    "quindici", "sedici", "diciassette", "diciotto", "diciannove",
  ];
  const decine = [
    null, null, "venti", "trenta", "quaranta",
    "cinquanta", "sessanta", "settanta", "ottanta", "novanta",
  ];

  const fino99 = [];
  for (let n = 0; n < 100; n++) {
    if (n < 10) {
      fino99.push(unita[n]);
    } else if (n < 20) {
      fino99.push(dieci[n - 10]);
    } else {
      const d = decine[Math.floor(n / 10)];
      const u = n % 10;
      if (u === 0) fino99.push(d);
      // Elisione davanti a vocale: ventuno, ventotto, trentuno.
      else if (u === 1 || u === 8) fino99.push(d.slice(0, -1) + unita[u]);
      // Il tre finale prende l'accento: ventitré, novantatré.
      else if (u === 3) fino99.push(d + "tré");
      else fino99.push(d + unita[u]);
    }
  }

  const tutti = new Set(fino99);
  tutti.add("cento");
  tutti.add("mille");
  for (let c = 1; c < 10; c++) {
    const testa = c === 1 ? "cento" : unita[c] + "cento";
    tutti.add(testa);
    for (let r = 1; r < 100; r++) {
      tutti.add(testa + fino99[r]);
      // La forma elisa che l'italiano preferisce: centottantotto.
      if (fino99[r].startsWith("o") || fino99[r].startsWith("u")) {
        tutti.add(testa.slice(0, -1) + fino99[r]);
      }
    }
  }
  return tutti;
}

const NUMERI_IN_LETTERE = numeriInLettere();

// ---------------------------------------------------------------------------
// Cosa si estrae da un testo
// ---------------------------------------------------------------------------

/**
 * Le cinque specie di token che una riscrittura non ha il diritto di perdere,
 * ciascuna con il nome che comparirà nel messaggio d'errore.
 *
 * Si confronta la **presenza**, non quante volte: accorciare toglie le
 * ripetizioni, ed è esattamente ciò che deve fare. Rosso è quando un token
 * sparisce del tutto.
 */
const SPECIE = [
  {
    nome: "numero",
    estrai(testo) {
      const out = new Set();
      // Cifre: 87, 4.590, 1.048.576 — e i decimali con la virgola.
      for (const m of testo.matchAll(/\b\d[\d.,]*\d\b|\b\d\b/g)) {
        out.add(m[0]);
      }
      // Numeri a parole, riconosciuti solo se la parola intera è nell'elenco:
      // così «settembre» non è «sette» e «unico» non è «uno».
      for (const m of testo.matchAll(/[A-Za-zÀ-ÿ]+/g)) {
        const p = m[0].toLowerCase();
        if (NUMERI_IN_LETTERE.has(p)) out.add(p);
      }
      return out;
    },
  },
  {
    nome: "percorso",
    estrai(testo) {
      const out = new Set();
      const re = /[\w./-]*\w\.(?:md|rs|ts|tsx|mjs|js|json|toml|wit|yml|yaml)\b/g;
      for (const m of testo.matchAll(re)) out.add(m[0]);
      return out;
    },
  },
  {
    nome: "identificatore",
    estrai(testo) {
      const out = new Set();
      for (const m of testo.matchAll(/`([^`\n]+)`/g)) out.add(m[1].trim());
      return out;
    },
  },
  {
    nome: "link",
    estrai(testo) {
      const out = new Set();
      for (const m of testo.matchAll(/\]\(([^)\s]+)/g)) out.add(m[1]);
      return out;
    },
  },
  {
    nome: "marcatore di conteggio",
    estrai(testo) {
      const out = new Set();
      for (const m of testo.matchAll(/\[conta:\s*[a-z0-9-]+\]/g)) out.add(m[0]);
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

/** Il contenuto di un file com'era a un certo ref, o `null` se non c'era. */
function comEra(ref, file) {
  const r = git(["show", `${ref}:${file}`]);
  return r.ok ? r.out : null;
}

function comE(file) {
  const r = spawnSync("cat", [file], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const confermati = new Set();
  const i = argv.indexOf("--conferma");
  if (i !== -1) {
    for (const t of (argv[i + 1] ?? "").split(",")) {
      if (t.trim()) confermati.add(t.trim());
    }
    argv.splice(i, 2);
  }

  let ref = "HEAD";
  if (argv.length > 0 && !argv[0].includes("/") && !argv[0].endsWith(".md")) {
    ref = argv.shift();
  }

  let file = argv;
  if (file.length === 0) {
    const r = git(["diff", "--name-only", ref, "--", "*.md"]);
    file = r.out.split("\n").filter((f) => f.trim());
  }

  let confrontati = 0;
  const sparizioni = [];

  for (const f of file) {
    const prima = comEra(ref, f);
    if (prima === null) {
      console.log(`nuovo, niente da confrontare: ${f}`);
      continue;
    }
    const dopo = comE(f);
    if (dopo === null) {
      console.log(`sparito dal disco: ${f}`);
      continue;
    }
    confrontati++;

    for (const specie of SPECIE) {
      const eranoCi = specie.estrai(prima);
      const ciSono = specie.estrai(dopo);
      for (const t of eranoCi) {
        if (!ciSono.has(t) && !confermati.has(t)) {
          sparizioni.push({ file: f, specie: specie.nome, token: t });
        }
      }
    }
  }

  // Un conto che non ha confrontato niente non è verde: è spento. È il modo in
  // cui `check-doc-links` si era già spento una volta, dicendo «0 rotti».
  if (confrontati === 0) {
    console.log(
      `nessun file confrontato contro \`${ref}\`: qui il conto non sta guardando niente.\n` +
        "Se è la lista sbagliata è un errore di invocazione; se l'albero è pulito,\n" +
        "non c'è ancora niente da verificare.",
    );
    process.exit(1);
  }

  if (sparizioni.length === 0) {
    console.log(
      `${confrontati} file confrontati contro \`${ref}\`: niente è sparito.`,
    );
    process.exit(0);
  }

  const perFile = new Map();
  for (const s of sparizioni) {
    if (!perFile.has(s.file)) perFile.set(s.file, []);
    perFile.get(s.file).push(s);
  }
  for (const [f, elenco] of perFile) {
    console.log(`\n${f}`);
    for (const s of elenco) console.log(`  ${s.specie} sparito: ${s.token}`);
  }
  console.log(
    `\n${sparizioni.length} sparizioni in ${perFile.size} file, su ${confrontati} confrontati.\n\n` +
      "Rosso non vuol dire per forza sbagliato: vuol dire **vai a guardare quella riga**.\n" +
      "Se la sparizione è voluta — un numero che non serve più, un link che si è\n" +
      "spostato — si rilancia con `--conferma <token,token>`, così la decisione resta\n" +
      "scritta nel comando invece che nella testa di chi l'ha presa.",
  );
  process.exit(1);
}

main();
