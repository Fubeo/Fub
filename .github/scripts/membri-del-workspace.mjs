// **Chi sono i crate di questo workspace**, per i presidi che li attraversano.
//
// Due presidi di questa cartella — `check-cargo-versioni.mjs` e
// `check-cargo-feature-default.mjs` — devono aprire il `Cargo.toml` di ogni
// crate del workspace. Tutt'e due, fino a questo file, se lo ricavavano allo
// stesso modo: **leggendo la cartella `crates/`**. Ed era una copia della
// stessa funzione in due file, il che è già la metà del difetto — ma la metà
// che morde è l'altra.
//
// La cartella non è l'elenco. L'elenco è `[workspace] members` nel `Cargo.toml`
// della radice, e i due possono divergere in tutt'e due i versi:
//
//   1. **un membro fuori da `crates/`** — la radice può dichiarare
//      `"tools/qualcosa"`, e cargo lo compila. I due presidi non lo aprivano
//      nemmeno: una versione scritta a mano lì dentro, o una feature fuori dal
//      `default`, erano invisibili a entrambi. E nessuno dei due lo dichiarava:
//      dicevano «8 crate controllati» senza dire *quali otto*, cioè senza dire
//      che li stavano scegliendo loro.
//   2. **una cartella in `crates/` che nessun membro dichiara** — cargo non la
//      compila, quindi i suoi test non esistono, il suo codice non esiste, e la
//      CI resta verde. È la forma su disco della stessa classe di difetto che
//      `check-cargo-feature-default.mjs` presidia dentro un crate: *una suite
//      che si svuota in silenzio è indistinguibile da una suite verde*. Il caso
//      non è più ipotetico: `crates/fub-wasm-host` è la cartella che allora era
//      solo una riga commentata nella radice, e adesso è un membro dichiarato.
//      Il presidio resta per la prossima, che nascerà allo stesso modo.
//
// Da cui la forma: **una sola funzione, e risponde in tutt'e due i versi.** Non
// rende solo l'elenco dei file: rende anche le violazioni, così il secondo
// chiamante eredita gratis anche la parte che dice di no. Un elenco «questi
// sono tutti» che non sa dire chi manca non è un elenco, è un campione.
//
// Niente dipendenze npm, come gli altri presidi di questa cartella: un
// controllo che per girare vuole un `npm install` è un controllo che prima o
// poi si spegne "temporaneamente". Il parsing è a righe per la stessa ragione
// per cui lo è quello dei due chiamanti, e ciò che non si sa leggere non si
// indovina: si dichiara.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Il nome della tabella di una riga `[…]`, o `null` se la riga non lo è. */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/**
 * I membri dichiarati da `[workspace] members` nel manifest della radice.
 *
 * Rende `null` se la sezione o la chiave non ci sono: è un caso diverso da
 * «zero membri», e chi chiama deve poterli distinguere — il primo vuol dire che
 * questo lettore è vecchio, il secondo che il workspace è vuoto, e chiamarli
 * uguale renderebbe verde un presidio che ha smesso di leggere.
 *
 * Le righe commentate si saltano: una riga `# "crates/qualcosa"` dentro l'elenco
 * **non** è un membro, ed è precisamente la riga su cui un lettore ingenuo
 * sbaglierebbe. Nella radice ce n'era una — `fub-wasm-host`, prima che il crate
 * nascesse —, e la prossima sarà scritta uguale.
 */
function membriDichiarati(manifestRadice) {
  const righe = fs.readFileSync(manifestRadice, "utf8").split("\n");
  let dentro = false;

  for (let i = 0; i < righe.length; i++) {
    const sezione = nomeSezione(righe[i].trim());
    if (sezione !== null) {
      dentro = sezione === "workspace";
      continue;
    }
    if (!dentro) continue;

    const testo = righe[i].trim();
    if (!/^members\s*=/.test(testo)) continue;

    // L'elenco sta quasi sempre su più righe: le quadre si richiudono qui.
    let raccolto = testo;
    let aperte = (testo.match(/\[/g) ?? []).length - (testo.match(/\]/g) ?? []).length;
    while (aperte > 0 && i + 1 < righe.length) {
      i++;
      const seguito = righe[i].replace(/^\s*#.*$/, "");
      raccolto += ` ${seguito}`;
      aperte += (seguito.match(/\[/g) ?? []).length - (seguito.match(/\]/g) ?? []).length;
    }
    if (aperte > 0) return null;

    // Un commento in coda a una riga di elenco (`"crates/x", # perché`) porta
    // via con sé tutto ciò che lo segue su quella riga, e lo ha già fatto il
    // `replace` di sopra per le righe intere.
    const senzaCommenti = raccolto.replace(/#[^\n"]*$/, "");
    return [...senzaCommenti.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  }

  return null;
}

/**
 * I `Cargo.toml` dei crate membri, in ordine, e ciò che non torna.
 *
 * Ritorna `{ file, violazioni }`. `file` sono i manifest da aprire — quelli dei
 * membri **dichiarati**, non quelli che capita ci siano su disco. `violazioni`
 * sono le divergenze fra l'elenco e il disco, nei due versi, già scritte per
 * essere stampate: chi chiama le mette in fila con le sue.
 */
export function crateDelWorkspace(radice) {
  const manifestRadice = path.join(radice, "Cargo.toml");
  const violazioni = [];

  if (!fs.existsSync(manifestRadice)) {
    return { file: [], violazioni: [`non c'è un \`Cargo.toml\` in ${radice}.`] };
  }

  const membri = membriDichiarati(manifestRadice);
  if (membri === null) {
    return {
      file: [],
      violazioni: [
        "in `Cargo.toml` non si legge `[workspace] members`: o la radice non è un" +
          " workspace, o la forma di quell'elenco è cambiata e questo lettore è vecchio." +
          "\n  Tacere qui vorrebbe dire controllare zero crate dicendo zero violazioni.",
      ],
    };
  }

  const file = [];
  const dichiarati = new Set();
  for (const membro of membri) {
    const manifest = path.join(radice, membro, "Cargo.toml");
    dichiarati.add(path.resolve(radice, membro));
    if (!fs.existsSync(manifest)) {
      violazioni.push(
        `\`[workspace] members\` dichiara \`${membro}\`, ma lì non c'è nessun` +
          ` \`Cargo.toml\`: cargo non compila quel membro, e i presidi che leggono` +
          ` questo elenco credono di averlo guardato.`,
      );
      continue;
    }
    file.push(manifest);
  }

  // Il verso opposto: una cartella con un manifest che nessun membro dichiara.
  // È qui che l'elenco diventa rosso quando ci si toglie una riga — senza,
  // togliere un membro farebbe solo controllare *meno* crate, in silenzio.
  const dir = path.join(radice, "crates");
  if (fs.existsSync(dir)) {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
      if (!voce.isDirectory()) continue;
      const manifest = path.join(dir, voce.name, "Cargo.toml");
      if (!fs.existsSync(manifest)) continue;
      if (dichiarati.has(path.resolve(dir, voce.name))) continue;
      violazioni.push(
        `\`crates/${voce.name}\` ha un \`Cargo.toml\` e non è in` +
          ` \`[workspace] members\`: cargo non lo compila, quindi il suo codice non` +
          ` esiste e i suoi \`#[test]\` non sono rossi — sono spariti dal conto.` +
          `\n  O entra fra i membri, o la cartella non ci va.`,
      );
    }
  }

  return { file: file.sort(), violazioni };
}

// **Da riga di comando**: i manifest dei membri, uno per riga, su stdout.
//
// Il terzo chiamante non è un presidio ma un **conto**: `crate-del-workspace` in
// `conteggi.mjs`, che è una stringa di shell e quindi non può importare una
// funzione. Senza questa porta si sarebbe riscritta lì la lettura di
// `[workspace] members` — cioè la terza copia della cosa che questo file esiste
// per non avere in due.
//
// Le violazioni vanno su **stderr** e non spengono l'uscita: chi le fa diventare
// rosse sono i due presidi che chiamano `crateDelWorkspace`, e un terzo attore
// che dice la stessa cosa non aggiungerebbe un verso — toglierebbe solo il
// numero dal registro proprio nel giro in cui serve leggerlo. Se l'elenco non si
// legge affatto, `file` è vuoto e il conto stampa **zero**: è il verso giusto in
// cui sbagliare, perché zero crate che ereditano la versione non passa
// inosservato in nessuna prosa che citi quel numero.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { file, violazioni } = crateDelWorkspace(process.cwd());
  for (const violazione of violazioni) console.error(violazione);
  for (const manifest of file) console.log(manifest);
}
