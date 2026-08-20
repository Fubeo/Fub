#!/usr/bin/env node
// **Il ciclo locale dice la CI, e la CI dice il ciclo locale.**
//
// docs/CONTRIBUTING.md promette: «La CI non fa niente di più di questo elenco:
// se passa in locale, passa lì». La promessa è vera solo se qualcosa la
// controlla: è successo che la CI lanciasse sette script di presidio e tre
// build che il ciclo locale non nominava, e chi seguiva il documento prendeva
// rosso senza averlo potuto vedere in locale — la classe di rottura muta che
// questa cartella esiste per prendere.
//
// Il presidio tiene la promessa in tre versi:
//   1. ogni comando di verifica della CI sta nel ciclo locale, o è dichiarato
//      fra le eccezioni di docs/CONTRIBUTING.md con la ragione accanto;
//   2. ogni comando del ciclo locale è lanciato dalla CI;
//   3. un'eccezione dichiarata che non corrisponde a nessun comando della CI
//      è scaduta — rumore che si accumula —, e un'eccezione che è anche nel
//      ciclo è un doppione: rosse tutte e due.
//
// **Cosa è un «comando di verifica».** Entra nel confronto ogni `run:` il cui
// esito è un verdetto sul repo — test, build, check, lint, script del repo.
// Non è un verdetto, e non entra, ciò la cui funzione è dichiarata dal suo
// stesso testo: installare l'ambiente (vocabolario chiuso: `apt-get`, `npm
// ci`/`npm install`, `cargo install`, `rustup`, `playwright install`), produrre
// un file invece di
// giudicare il repo (la ridirezione `>` nel comando — l'SBOM è un artefatto,
// non un verdetto), o appartenere a un'azione di terzi (`uses:` non è un
// comando scritto in questo repo) — con un'unica eccezione scritta:
// `EmbarkStudios/cargo-deny-action` con `command: C` è l'esecuzione di
// `cargo deny C`, perché è il wrapper del binario che il ciclo locale elenca
// già per nome.
//
// **La copertura.** `l` copre `c` se le parole di `c`, tolte le restrizioni di
// ambito, sono un prefisso delle parole di `l`, tolte le stesse restrizioni.
// Restrizioni di ambito: `-p <pkg>`, `--test <nome>`, `--workspace` (una corsa
// su un sottoinsieme di pacchetti o su un solo test è coperta dalla corsa su
// tutto il workspace); per `node .github/scripts/X.mjs` anche le opzioni che
// cominciano per `-` (un'opzione seleziona un sottoinsieme della verifica,
// come `--autoprova`). Non si tolgono mai `--features`,
// `--no-default-features`, `--target`, `--release`: cambiano ciò che si
// compila, e la copertura non vale più — è il caso §16.3, per costruzione.
// Un'unica conoscenza di cargo, e sta qui apposta: `cargo test <resto>` copre
// `cargo build <resto>` con `<resto>` identico, perché test compila i target
// di build più i suoi; se un giorno la CI lanciasse una build con un `<resto>`
// nuovo, il vincolo la farebbe diventare rossa, e qualcuno deciderebbe se la
// regola regge o se il ciclo deve elencarla.
//
// **Gli alias.** Prima del confronto: `npx <cmd>` è `<cmd>`; `npm run <nome>`
// e `npm <nome>` (test, build, …) sono la voce `scripts` di
// frontend/package.json — se l'espansione contiene `&&`, `|`, `>` o un
// assegnamento non si espande, e si confronta il comando grezzo; `cd <dir> &&
// <cmd>` è `<cmd>` — la directory di lavoro non è parte del comando, e
// `working-directory:` o la nota «(dentro frontend/)» dicono dove, non cosa;
// `VAR=… ` in testa e `sudo` si tolgono.
//
// **Le eccezioni.** La sezione «### Le eccezioni al ciclo» di
// docs/CONTRIBUTING.md, subito dopo il recinto del ciclo: un punto elenco con
// un comando fra backtick e la ragione dopo il `—`. Un'eccezione vale solo
// per il suo comando esatto (alias a parte): non è una restrizione, e non
// copre varianti.
//
// Uso:
//   node .github/scripts/check-ciclo-locale.mjs [radice]
//   node .github/scripts/check-ciclo-locale.mjs --autoprova
// Exit code 1 se la CI lancia un comando senza posto nel ciclo né fra le
// eccezioni, se il ciclo elenca un comando che la CI non lancia, se
// un'eccezione è scaduta o doppia, se un `run:` è in una forma che non si sa
// leggere, o se non c'è niente da controllare.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella.

import fs from "node:fs";
import path from "node:path";

/// Una riga `run:` di step, con o senza il trattino dell'elenco. In un
/// workflow `run:` esiste solo come chiave di step; `runs-on:` non ci casca.
const RE_RUN = /^(\s*)(?:- )?run:(.*)$/;

/// Il valore a blocco: `|` letterale, `>` ripiegato, con chomping.
const RE_BLOCCO = /^[|>][-+]?\d*\s*(#.*)?$/;

/// Un `uses:` con la `command:` nel `with:`.
const RE_USES = /^(\s*)(?:- )?uses:\s*(\S+)/;

/// Le voci dell'elenco delle eccezioni: un punto elenco che comincia con un
/// comando fra backtick.
const RE_ECCEZIONE = /^-\s*`([^`]+)`/;

/// Il recinto di un blocco di codice, come negli altri presidi di questa
/// cartella.
const RE_RECINTO = /^ {0,3}(`{3,}|~{3,})/;

/** I comandi dei `run:` di un workflow: `{ comandi, illeggibili }`. */
export function comandiDiCi(testo) {
  const righe = testo.split("\n");
  const comandi = [];
  const illeggibili = [];
  let passo = null;
  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    const mItem = /^(\s*)- /.exec(riga);
    if (mItem) {
      const mName = /^(\s*)- name:\s*(.*)$/.exec(riga);
      if (mName) {
        passo = mName[2].trim();
        continue;
      }
      if (/^(\s*)- (run|uses):/.test(riga)) passo = null;
    }
    const mUses = RE_USES.exec(riga);
    if (mUses && mUses[2].includes("cargo-deny-action")) {
      let command = null;
      for (let j = i + 1; j < righe.length && j <= i + 3; j++) {
        const mCmd = /^\s*command:\s*(\S+)/.exec(righe[j]);
        if (mCmd) {
          command = mCmd[1];
          break;
        }
        if (/^\S/.test(righe[j]) || /^\s*- /.test(righe[j])) break;
      }
      if (command !== null) {
        comandi.push({ riga: i + 1, passo, comando: `cargo deny ${command}` });
      }
      continue;
    }
    const mRun = RE_RUN.exec(riga);
    if (!mRun) continue;
    const indent = mRun[1].length;
    const resto = mRun[2];
    if (resto.trim() === "") {
      // Un `run:` nudo: la forma non è quella che si sa leggere, e un comando
      // che il confronto perderebbe è un presidio spento. Rosso, non silenzio.
      illeggibili.push({ riga: i + 1, passo });
      continue;
    }
    const valore = resto.trim();
    if (RE_BLOCCO.test(valore)) {
      const stile = valore[0];
      const blocco = [];
      let j = i + 1;
      while (j < righe.length) {
        const linea = righe[j];
        const mInd = /^(\s*)/.exec(linea);
        if (linea.trim() !== "" && mInd[1].length <= indent) break;
        blocco.push(linea);
        j++;
      }
      if (stile === "|") {
        // Una riga per comando, con le continuazioni `\` unite alla riga dopo.
        let k = 0;
        while (k < blocco.length) {
          const numeroRiga = i + 2 + k;
          let linea = blocco[k].replace(/\s+$/, "");
          while (linea.endsWith("\\") && k + 1 < blocco.length) {
            k++;
            linea = linea.slice(0, -1).replace(/\s+$/, "") + " " + blocco[k].trim();
          }
          if (linea.trim() !== "") comandi.push({ riga: numeroRiga, passo, comando: linea.trim() });
          k++;
        }
      } else {
        // `>` ripiegato: tutto il blocco è un comando solo.
        comandi.push({ riga: i + 2, passo, comando: blocco.map((l) => l.trim()).join(" ").trim() });
      }
      continue;
    }
    // Scalare: un comando, tagliato al commento in coda (lo farebbe la shell).
    comandi.push({ riga: i + 1, passo, comando: valore.replace(/\s+#.*$/, "").trim() });
  }
  return { comandi, illeggibili };
}

/**
 * Il ciclo locale e le eccezioni di docs/CONTRIBUTING.md, o `null` se il
 * blocco non c'è. Il ciclo è il primo blocco di codice dopo il titolo
 * «## Il ciclo locale»; le eccezioni sono i punti elenco con un comando fra
 * backtick della sezione «### Le eccezioni al ciclo», subito dopo il recinto.
 */
export function cicloLocale(testo) {
  const righe = testo.split("\n");
  let i = 0;
  while (i < righe.length && !/^## The local loop\s*$/.test(righe[i].trim())) i++;
  if (i >= righe.length) return null;
  i++;
  while (i < righe.length && !RE_RECINTO.test(righe[i])) i++;
  if (i >= righe.length) return null;
  const recinto = righe[i].match(RE_RECINTO)[1][0].repeat(3);
  i++;
  const comandi = [];
  while (i < righe.length) {
    const riga = righe[i];
    if (RE_RECINTO.test(riga) && riga.trimStart().startsWith(recinto)) break;
    if (/^\s*#/.test(riga) || riga.trim() === "") {
      i++;
      continue;
    }
    let linea = riga.trim().replace(/\s+#.*$/, "");
    const numero = i + 1;
    while (linea.endsWith("\\") && i + 1 < righe.length) {
      i++;
      linea = linea.slice(0, -1).replace(/\s+$/, "") + " " + righe[i].trim().replace(/\s+#.*$/, "");
    }
    if (linea !== "") comandi.push({ riga: numero, comando: linea });
    i++;
  }
  if (comandi.length === 0) return null;
  i++;
  while (i < righe.length && righe[i].trim() === "") i++;
  const eccezioni = [];
  if (/^### Exceptions to the loop\s*$/.test((righe[i] ?? "").trim())) {
    i++;
    // La prosa introduttiva (e le righe vuote) si salta finché non arriva la
    // prima voce; dopo la prima voce, l'elenco finisce alla prima riga che
    // non è un punto elenco né una continuazione indentata della ragione.
    let iniziato = false;
    while (i < righe.length) {
      const riga = righe[i];
      const m = RE_ECCEZIONE.exec(riga);
      if (m) {
        iniziato = true;
        eccezioni.push({ riga: i + 1, comando: m[1] });
        i++;
        continue;
      }
      if (/^\s/.test(riga)) {
        i++; // la ragione, che continua sulla riga dopo
        continue;
      }
      if (!iniziato) {
        i++;
        continue;
      }
      break;
    }
  }
  return { comandi, eccezioni };
}

/** I token di un comando, con gli alias sciolti. */
export function normalizza(comando, scripts) {
  let tok = comando.split(/\s+/).filter(Boolean);
  while (tok.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok[0])) tok.shift();
  if (tok[0] === "sudo") tok.shift();
  if (tok[0] === "cd") tok = tok.slice(3);
  if (tok[0] === "npx") tok = tok.slice(1);
  if (tok[0] === "npm" && tok[1] === "run" && typeof scripts[tok[2]] === "string") {
    const voce = scripts[tok[2]];
    if (!/&&|\||>|<|=/.test(voce)) tok = [...voce.split(/\s+/), ...tok.slice(3)];
  } else if (tok[0] === "npm" && typeof scripts[tok[1]] === "string") {
    const voce = scripts[tok[1]];
    if (!/&&|\||>|<|=/.test(voce)) tok = [...voce.split(/\s+/), ...tok.slice(2)];
  }
  return tok;
}

/** La classe di un comando normalizzato: `verdetto`, `provisioning`, `artefatto`. */
export function classe(tok) {
  if (tok[0] === "apt-get" && (tok[1] === "update" || tok[1] === "install")) return "provisioning";
  if (tok[0] === "rustup") return "provisioning";
  if (tok[0] === "npm" && (tok[1] === "ci" || tok[1] === "install" || tok[1] === "i")) return "provisioning";
  if (tok[0] === "cargo" && tok[1] === "install") return "provisioning";
  // `playwright install` scarica il browser del banco visivo (§31.1). Sta qui e
  // non fra le eccezioni perché è un'installazione, non una verifica: la sua
  // funzione la dichiara il suo stesso testo, come per le altre quattro voci.
  if (tok[0] === "playwright" && tok[1] === "install") return "provisioning";
  if (tok.includes(">")) return "artifact";
  return "verdict";
}

/** I token senza le restrizioni di ambito. */
function senzaRestrizioni(tok) {
  const script = tok[0] === "node" && tok[1] !== undefined && tok[1].includes(".github/scripts/");
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i];
    if (t === "-p" || t === "--test") {
      i++;
      continue;
    }
    if (t === "--workspace") continue;
    if (script && i >= 2 && /^-\S/.test(t)) continue;
    out.push(t);
  }
  return out;
}

function uguali(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Se `locale` copre `ci`, con la relazione scritta nell'intestazione. */
export function copre(locale, ci) {
  const l = senzaRestrizioni(locale);
  const c = senzaRestrizioni(ci);
  if (l[0] === "cargo" && l[1] === "test" && c[0] === "cargo" && c[1] === "build") {
    if (uguali(l.slice(2), c.slice(2))) return true;
  }
  if (c.length > l.length) return false;
  for (let i = 0; i < c.length; i++) if (c[i] !== l[i]) return false;
  return true;
}

/**
 * Le differenze fra i due lati e le eccezioni. `ci` ha la forma di
 * `comandiDiCi` (comandi già letti, ancora grezzi), `ciclo` quella di
 * `cicloLocale`.
 */
export function differenze(ci, ciclo, scripts) {
  const locali = ciclo.comandi.map((x) => ({ ...x, tok: normalizza(x.comando, scripts) }));
  const inCi = ci.comandi
    .map((x) => ({ ...x, tok: normalizza(x.comando, scripts) }))
    .filter((x) => classe(x.tok) === "verdict");
  const inCiSenzaPosto = [];
  const inLocaleSenzaPosto = [];
  const eccezioniScadute = [];
  const eccezioniDoppie = [];

  for (const c of inCi) {
    const coperto = locali.some((l) => copre(l.tok, c.tok));
    if (coperto) continue;
    const eccezione = ciclo.eccezioni.some((e) => uguali(normalizza(e.comando, scripts), c.tok));
    if (!eccezione) inCiSenzaPosto.push(c);
  }
  for (const l of locali) {
    if (!inCi.some((c) => copre(c.tok, l.tok))) inLocaleSenzaPosto.push(l);
  }
  for (const e of ciclo.eccezioni) {
    const tok = normalizza(e.comando, scripts);
    const inCi1 = inCi.some((c) => uguali(c.tok, tok));
    const inCiclo = locali.some((l) => uguali(l.tok, tok));
    if (!inCi1) eccezioniScadute.push(e);
    else if (inCiclo) eccezioniDoppie.push(e);
  }
  return { inCiSenzaPosto, inLocaleSenzaPosto, eccezioniScadute, eccezioniDoppie };
}

// ---------------------------------------------------------------------------
// Il test del presidio
// ---------------------------------------------------------------------------
//
// Serve per la ragione degli altri presidi: un conto che non è mai stato rosso
// non ha dimostrato niente. Le parti fragili sono il lettore del `run:` a
// blocco, il recinto del ciclo con i suoi commenti, gli alias, la relazione di
// copertura — e i casi che contano sono quelli che devono essere rossi (un
// comando CI senza posto, un'eccezione scaduta, un'eccezione doppia, un
// `--no-default-features` che la copertura non deve mai coprire) e quelli che
// devono restare verdi (le restrizioni, la subsunzione, le classi escluse,
// gli alias): senza i secondi questo sarebbe un conto che chiama difetto una
// cosa voluta.
//
// Gira con `--autoprova`, e in CI prima del controllo vero.

function autoprova() {
  const casi = [];
  const caso = (nome, verifica, atteso) => casi.push({ nome, verifica, atteso });

  // Il lettore della CI.
  caso("a single-line run: is readable", () => comandiDiCi("      - run: cargo x\n").comandi.length, 1);
  caso(
    "a run: | with three commands is read in full",
    () => comandiDiCi("      - run: |\n        cargo a\n        cargo b\n        cargo c\n").comandi.length,
    3,
  );
  caso(
    "a \\ continuation inside the block is a single command",
    () => comandiDiCi("      - run: |\n        cargo a \\\n          --x\n        cargo b\n").comandi[0].comando,
    "cargo a --x",
  );
  caso(
    "runs-on is not a run",
    () => comandiDiCi("    runs-on: ubuntu-latest\n      - run: cargo x\n").comandi.length,
    1,
  );
  caso(
    "a folded > run: is a single command",
    () => comandiDiCi("      - run: >\n        cargo a\n        --x\n").comandi[0].comando,
    "cargo a --x",
  );
  caso("a bare run: is unreadable and must be reported", () => comandiDiCi("      - run:\n").illeggibili.length, 1);
  caso(
    "cargo-deny-action with command: check is cargo deny check",
    () => comandiDiCi("      - uses: EmbarkStudios/cargo-deny-action@v2\n        with:\n          command: check\n").comandi[0].comando,
    "cargo deny check",
  );

  // Il lettore del documento.
  caso(
    "the loop is taken under its heading, and the block after is not part of it",
    () => {
      const c = cicloLocale("## The local loop\n\n```bash\n# comment\ncargo x\n\ncargo y\n```\n\n```bash\nFUB_FUZZ=1 cargo z\n```\n");
      return c === null ? -1 : c.comandi.length;
    },
    2,
  );
  caso(
    "a trailing comment on the line is trimmed",
    () => cicloLocale("## The local loop\n\n```bash\nnpx tsc --noEmit      # vite transpiles\n```\n").comandi[0].comando,
    "npx tsc --noEmit",
  );
  caso(
    "a \\ continuation in the loop is joined",
    () => cicloLocale("## The local loop\n\n```bash\ncargo a \\\n  --x\n```\n").comandi[0].comando,
    "cargo a --x",
  );
  caso("a document without the loop is off, not green", () => (cicloLocale("# only heading\n") === null ? 1 : 0), 1);
  caso(
    "exceptions are read after the fence, with the line number",
    () => {
      const c = cicloLocale(
        "## The local loop\n\n```bash\ncargo x\n```\n\n### Exceptions to the loop\n\n- `cargo check --target t` — the\n  reason\n",
      );
      return c === null ? -1 : c.eccezioni[0].comando;
    },
    "cargo check --target t",
  );

  // Gli alias.
  caso(
    "npx tsc --noEmit and npm run typecheck are the same command",
    () => (uguali(normalizza("npx tsc --noEmit", { typecheck: "tsc --noEmit" }), normalizza("npm run typecheck", { typecheck: "tsc --noEmit" })) ? 0 : 1),
    0,
  );

  // La copertura.
  caso(
    "a cargo test -p … --test … is covered by the cargo test --workspace of the loop",
    () => (copre(normalizza("cargo test --workspace", {}), normalizza("cargo test -p fub-abi --test wit_conformance", {})) ? 0 : 1),
    0,
  );
  caso(
    "cargo build --workspace is covered by cargo test --workspace: test compiles build targets",
    () => (copre(normalizza("cargo test --workspace", {}), normalizza("cargo build --workspace", {})) ? 0 : 1),
    0,
  );
  caso(
    "a cargo build --no-default-features is NOT covered: that is the §16.3 case",
    () => (copre(normalizza("cargo test --workspace", {}), normalizza("cargo build -p fub-features --no-default-features", {})) ? 1 : 0),
    0,
  );
  caso(
    "a cargo check --target … is NOT covered",
    () => (copre(normalizza("cargo test --workspace", {}), normalizza("cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc", {})) ? 1 : 0),
    0,
  );

  // Le classi e le direzioni.
  caso("apt-get and npm ci do not enter the comparison", () => (classe(normalizza("sudo apt-get update", {})) === "provisioning" && classe(normalizza("npm ci", {})) === "provisioning" ? 0 : 1), 0);
  caso("npx playwright install is an installation, not a verdict", () => (classe(normalizza("npx playwright install --with-deps chromium", {})) === "provisioning" ? 0 : 1), 0);
  caso("a command with > is an artifact, not a verdict", () => (classe(normalizza("cargo sbom --x > fub-sbom.spdx.json", {})) === "artifact" ? 0 : 1), 0);
  caso(
    "a CI command without a place in the loop is red",
    () => {
      const r = differenze(
        { comandi: [{ riga: 5, passo: "a step", comando: "node .github/scripts/check-x.mjs" }], illeggibili: [] },
        { comandi: [], eccezioni: [] },
        {},
      );
      return r.inCiSenzaPosto.length;
    },
    1,
  );
  caso(
    "a loop command the CI does not run is red (the other direction)",
    () => {
      const r = differenze(
        { comandi: [{ riga: 5, passo: null, comando: "cargo x" }], illeggibili: [] },
        { comandi: [{ riga: 60, comando: "cargo y" }], eccezioni: [] },
        {},
      );
      return r.inLocaleSenzaPosto.length;
    },
    1,
  );
  caso(
    "an exception that matches a CI command is green",
    () => {
      const r = differenze(
        { comandi: [{ riga: 5, passo: null, comando: "cargo check -p k --target t" }], illeggibili: [] },
        { comandi: [{ riga: 60, comando: "cargo x" }], eccezioni: [{ riga: 70, comando: "cargo check -p k --target t" }] },
        {},
      );
      return r.inCiSenzaPosto.length + r.eccezioniScadute.length;
    },
    0,
  );
  caso(
    "a stale exception — not matching any CI command — is red",
    () => {
      const r = differenze(
        { comandi: [{ riga: 5, passo: null, comando: "cargo x" }], illeggibili: [] },
        { comandi: [{ riga: 60, comando: "cargo x" }], eccezioni: [{ riga: 70, comando: "cargo check -p k --target t" }] },
        {},
      );
      return r.eccezioniScadute.length;
    },
    1,
  );
  caso(
    "an exception that is also in the loop is a duplicate and must be removed",
    () => {
      const r = differenze(
        { comandi: [{ riga: 5, passo: null, comando: "cargo x" }], illeggibili: [] },
        { comandi: [{ riga: 60, comando: "cargo x" }], eccezioni: [{ riga: 70, comando: "cargo x" }] },
        {},
      );
      return r.eccezioniDoppie.length;
    },
    1,
  );

  let rossi = 0;
  for (const { nome, verifica, atteso } of casi) {
    let letto;
    try {
      letto = verifica();
    } catch (errore) {
      letto = `error: ${errore.message}`;
    }
    if (letto !== atteso) {
      console.log(`self-test: ${nome} → ${JSON.stringify(letto)}, expected ${JSON.stringify(atteso)}`);
      rossi += 1;
    }
  }
  console.log(`self-test: ${casi.length} cases, ${rossi} red`);
  process.exit(rossi > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes("--self-test")) autoprova();

  const radice = path.resolve(process.argv[2] ?? process.cwd());
  const problemi = [];

  // La CI: tutti i workflow, con la riga e il passo di ogni comando.
  let filesCi = [];
  try {
    filesCi = fs.readdirSync(path.join(radice, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f));
  } catch {}
  const ci = { comandi: [], illeggibili: [] };
  for (const f of filesCi) {
    let testo;
    try {
      testo = fs.readFileSync(path.join(radice, ".github", "workflows", f), "utf8");
    } catch {
      continue;
    }
    const letti = comandiDiCi(testo);
    const relativo = path.join(".github", "workflows", f);
    for (const c of letti.comandi) ci.comandi.push({ ...c, file: relativo });
    for (const x of letti.illeggibili) {
      problemi.push(`${relativo}:${x.riga}  a run: in a form the reader cannot parse — update the reader, do not ignore it`);
    }
  }
  if (ci.comandi.length === 0) {
    console.log("no run: found in .github/workflows/: the guard is not checking anything here.");
    process.exit(1);
  }

  // Il documento: il ciclo e le sue eccezioni.
  let ciclo = null;
  try {
    ciclo = cicloLocale(fs.readFileSync(path.join(radice, "docs", "CONTRIBUTING.md"), "utf8"));
  } catch {}
  if (ciclo === null) {
    console.log("cannot find the \"## The local loop\" block in docs/CONTRIBUTING.md: the guard is not checking anything here.");
    process.exit(1);
  }

  // Gli script npm, per sciogliere gli alias.
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(radice, "frontend", "package.json"), "utf8")).scripts ?? {};
  } catch {
    console.log("cannot read frontend/package.json: without npm scripts aliases cannot be resolved.");
    process.exit(1);
  }

  const r = differenze(ci, ciclo, scripts);
  for (const c of r.inCiSenzaPosto) {
    const passo = c.passo ? `step "${c.passo}" runs ` : "the CI runs ";
    problemi.push(
      `${c.file}:${c.riga}  ${passo}${c.comando}, which docs/CONTRIBUTING.md does not list or declare as an exception`,
    );
  }
  for (const l of r.inLocaleSenzaPosto) {
    problemi.push(`docs/CONTRIBUTING.md:${l.riga}  the loop lists "${l.comando}" but no CI run executes it`);
  }
  for (const e of r.eccezioniScadute) {
    problemi.push(`docs/CONTRIBUTING.md:${e.riga}  the exception "${e.comando}" does not match any CI command: it is stale, remove it`);
  }
  for (const e of r.eccezioniDoppie) {
    problemi.push(`docs/CONTRIBUTING.md:${e.riga}  the exception "${e.comando}" is already in the loop: remove it from the list`);
  }

  for (const p of problemi) console.log(p);
  if (problemi.length > 0) console.log("");
  const verifica = ci.comandi.filter((c) => classe(normalizza(c.comando, scripts)) === "verdict").length;
  const riepilogoEccezioni =
    ciclo.eccezioni.length === 1 ? "1 declared exception" : `${ciclo.eccezioni.length} declared exceptions`;
  console.log(
    `${verifica} verification commands in CI (out of ${ci.comandi.length} run:), ${ciclo.comandi.length} in the locale loop, ` +
      `${riepilogoEccezioni}, ${problemi.length} problems total`,
  );

  // Come per gli altri presidi: un presidio che non ha guardato niente non è
  // verde, è spento.
  if (ciclo.comandi.length === 0) {
    console.log("\nno commands in the locale loop: the guard is not checking anything here.");
    process.exit(1);
  }

  process.exit(problemi.length > 0 ? 1 : 0);
}

main();
