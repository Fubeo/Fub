// **La generazione dei derivati del tema**: le sorgenti entrano, i file escono.
//
//     node tema/genera.mjs             riscrive i derivati
//     node tema/genera.mjs --verifica  dice se sono quelli che le sorgenti producono
//
// Sono due, e hanno la stessa forma. I **due fogli** (§31.2) vengono dalla
// ricetta in OKLCH: si dichiara luminosità, croma e tinta, ed esce
// l'esadecimale. La **pelle** (§31.4) viene dai suoi pezzi, uno per componente:
// si scrive un componente per volta ed esce il file solo che il caricatore
// monta e che i presidi leggono.
//
// Stanno nello stesso script perché sono la stessa promessa — «rigenerare dà
// gli stessi byte» — e perché chi ha toccato l'una vuole verificare l'altra
// senza ricordarsi due comandi.
//
// # Perché passa da Vite e non da Node
//
// Perché la ricetta è codice della shell, e il codice della shell importa come
// importa la shell: `../contrasto`, senza estensione, come tutti gli altri
// duecento import di `src/`. Node quel nome non lo risolve — vuole il file — e
// farglielo risolvere vorrebbe dire scrivere `../contrasto.ts` in un file di
// produzione per far contento uno script. Sarebbe la coda che muove il cane, ed
// è esattamente la mossa che il banco visivo ha già rifiutato una volta: **si
// carica la cosa vera attraverso lo strumento che la sa caricare**, invece di
// piegare la cosa vera allo strumento.
//
// Vite è già una dipendenza e `ssrLoadModule` è tre righe. Il prezzo è un
// secondo di avvio; il ricavo è che la ricetta resta un modulo che la §31.6
// potrà importare nella webview senza toccarne un carattere.
//
// # Perché due modi e non uno
//
// `--verifica` non riscrive niente e ritorna 1 se i fogli su disco non sono
// quelli che la ricetta produce. È il verso che serve in CI e nel ciclo locale:
// senza, «rigenerare dà gli stessi byte» sarebbe una cosa che si dice, e la si
// scoprirebbe falsa il giorno in cui qualcuno ritocca un esadecimale a mano —
// cioè il giorno in cui la ricetta smette di essere la sorgente.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const QUI = dirname(fileURLToPath(import.meta.url));
const SERIE = join(QUI, "..", "src", "theme", "serie");

const verifica = process.argv.includes("--verifica");

const vite = await createServer({
  root: join(QUI, ".."),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

/** @type {{ LUCI: readonly ("scuro"|"chiaro")[], FOGLI: Record<string,string>, foglio: (l: string) => string }} */
const ricetta = await vite.ssrLoadModule("/src/theme/serie/ricetta.ts");
/** @type {{ ORDINE: readonly string[], PELLE: string, assembla: (c: Record<string,string>) => string }} */
const pelle = await vite.ssrLoadModule("/src/theme/serie/pelle/ordine.ts");

let diversi = 0;

/// Scrive, o dice che è diverso. Il nome è quello che compare a video; `atteso`
/// è ciò che la sorgente produce.
async function derivato(nome, atteso, sorgente) {
  const file = join(SERIE, nome);
  const suDisco = await readFile(file, "utf8").catch(() => null);

  if (suDisco === atteso) {
    console.log(`· ${nome}: uguale ${sorgente}`);
    return;
  }

  diversi += 1;
  if (verifica) {
    console.error(`✗ ${nome}: ${suDisco === null ? "non c'è" : `non è quello che si genera ${sorgente}`}`);
    return;
  }
  await writeFile(file, atteso);
  console.log(`✎ ${nome}: riscritto (${atteso.length} byte)`);
}

try {
  for (const luce of ricetta.LUCI) {
    await derivato(ricetta.FOGLI[luce], ricetta.foglio(luce), "alla ricetta");
  }

  // I pezzi si leggono **tutti**, non solo quelli elencati: `assembla` rifiuta
  // ciò che nessuno ha messo nell'ordine, e quel rifiuto è il punto — un pezzo
  // scritto e mai montato è la specie di silenzio che questo script esiste per
  // rompere.
  const cartella = join(SERIE, "pelle");
  const contenuto = {};
  for (const f of (await readdir(cartella)).sort()) {
    if (!f.endsWith(".css")) continue;
    contenuto[f.slice(0, -".css".length)] = await readFile(join(cartella, f), "utf8");
  }
  await derivato(pelle.PELLE, pelle.assembla(contenuto), "ai suoi pezzi");
} finally {
  await vite.close();
}

if (verifica && diversi > 0) {
  console.error(
    "\nI derivati si generano: «npm run tema:genera». Un esadecimale ritoccato a mano," +
      " o una regola scritta dentro la pelle montata, sparisce alla prima rigenerazione —" +
      " e fino ad allora dice il falso sulla sorgente.",
  );
}
process.exitCode = verifica && diversi > 0 ? 1 : 0;
