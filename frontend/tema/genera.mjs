// **La generazione dei fogli** (§31.2): la ricetta entra, due file escono.
//
//     node tema/genera.mjs             riscrive i due fogli
//     node tema/genera.mjs --verifica  dice se sono quelli che la ricetta produce
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
import { readFile, writeFile } from "node:fs/promises";
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

let diversi = 0;
try {
  for (const luce of ricetta.LUCI) {
    const file = join(SERIE, ricetta.FOGLI[luce]);
    const atteso = ricetta.foglio(luce);
    const suDisco = await readFile(file, "utf8").catch(() => null);

    if (suDisco === atteso) {
      console.log(`· ${ricetta.FOGLI[luce]}: uguale alla ricetta`);
      continue;
    }

    diversi += 1;
    if (verifica) {
      console.error(
        `✗ ${ricetta.FOGLI[luce]}: ${suDisco === null ? "non c'è" : "non è quello che la ricetta produce"}`,
      );
      continue;
    }
    await writeFile(file, atteso);
    console.log(`✎ ${ricetta.FOGLI[luce]}: riscritto (${atteso.length} byte)`);
  }
} finally {
  await vite.close();
}

if (verifica && diversi > 0) {
  console.error(
    "\nI fogli si generano: «npm run tema:genera». Un esadecimale ritoccato a mano" +
      " sparisce alla prima rigenerazione, e fino ad allora dice il falso sulla ricetta.",
  );
}
process.exitCode = verifica && diversi > 0 ? 1 : 0;
