// Da dove gli script del simulatore prendono Playwright, pngjs, pixelmatch e
// happy-dom: la cartella `apps/client` di un checkout di Fub con `npm ci` fatto
// (le sue dipendenze di sviluppo). Senza FUB_CLIENT vale `apps/client` del
// repository che contiene questa cartella (PLAN-ui/fub-pre-alpha/script).
// Altrimenti:
//   FUB_CLIENT=/percorso/di/Fub/apps/client node foto-sim.mjs …
// Di solito FUB_CLIENT è il client delle catture (finto/LEGGIMI.md): ha anche
// i caratteri che servono a costruisci-sim.mjs senza DATI.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLIENT = process.env.FUB_CLIENT ?? join(dirname(fileURLToPath(import.meta.url)), "../../../apps/client");
if (!existsSync(join(CLIENT, "node_modules/playwright"))) {
  throw new Error(`manca Playwright in ${CLIENT}: FUB_CLIENT=<Fub>/apps/client, con npm ci fatto`);
}
export const richiedi = createRequire(join(CLIENT, "package.json"));
export const { chromium } = await import(pathToFileURL(join(CLIENT, "node_modules/playwright/index.mjs")).href);
