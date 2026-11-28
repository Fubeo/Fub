// **Le sonde dei gesti dell'editor**: ogni voce fa un gesto nell'app sul banco
// e legge lo stato d'arrivo, per confrontarlo col prototipo.
//
//     node bench/gesti/sonda.mjs --pagina=blocchi            # tutte le voci di una pagina
//     node bench/gesti/sonda.mjs --pagina=blocchi --only=5,7 # alcune voci
//     node bench/gesti/sonda.mjs --pagina=blocchi --port=1456 --insieme=3
//
// Le pagine sono quelle di `docs/misure/gesti-editor/`; le voci di ognuna
// stanno in `voci-<pagina>.mjs`. Una voce è dichiarativa quanto basta per
// diventare un passo del banco dei gesti:
//
// - `n`: la riga della tabella nella pagina;
// - `partenza`: la nota (`testo`, col segnaposto `§` del cursore; due `§`
//   fanno una selezione), le opzioni del banco (`query`) e la finestra
//   (`finestra`); oppure una scena intera (`scena`, una funzione che prepara
//   la pagina, per ciò che non è una nota della Live);
// - `gesto`: i tasti, i clic, il puntatore (una funzione che riceve la pagina
//   e gli aiuti di `aiuti.mjs`);
// - `leggi` (facoltativo): ciò che lo stato generico non vede (uno stile, un
//   attributo), aggiunto alla foto come `letto`.
//
// Lo stato prima e dopo è quello di `stato.mjs`. Il referto va in
// `bench/.output/gesti/<pagina>.json`, e a schermo una riga per voce con
// accanto ciò che la pagina diceva dell'app il 2026-11-21: il giudizio
// (uguale, diverso, manca) lo dà chi legge, contro il codice del prototipo.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUT, openPage, openStage } from "../stage.mjs";
import { aiuti, apriNota } from "./aiuti.mjs";
import { foto, riassunto, segna } from "./stato.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const opzione = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(`--${nome}=`.length);

const pagina = opzione("pagina");
if (!pagina) {
  console.error("--pagina=<blocchi|scrittura|…> è obbligatoria");
  process.exit(2);
}
const solo = opzione("only")?.split(",").map((s) => s.trim());
const port = Number(opzione("port") ?? process.env.FUB_BENCH_PORT ?? 1456);
const insieme = Number(opzione("insieme") ?? 3);
const luce = opzione("light") ?? "light";

const { VOCI, DOC } = await import(new URL(`./voci-${pagina}.mjs`, import.meta.url).href);
const voci = VOCI.filter((v) => !solo || solo.includes(String(v.n)));

/// Ciò che la pagina diceva dell'app il 21/11: la colonna «app» della riga.
async function righeDellaPagina() {
  if (!DOC) return new Map();
  const testo = await readFile(here(`../../../../docs/misure/gesti-editor/${DOC}`), "utf8");
  const righe = testo.split("\n").filter((r) => r.startsWith("|"));
  const testata = righe[0].split("|").map((c) => c.trim());
  const colonna = testata.findIndex((c) => /^app\b/i.test(c));
  const mappa = new Map();
  for (const r of righe.slice(2)) {
    const celle = r.split("|").map((c) => c.trim());
    if (/^\w+$/.test(celle[1])) mappa.set(celle[1], colonna > 0 ? celle[colonna] : r);
  }
  return mappa;
}

const prima21 = await righeDellaPagina();
const stage = await openStage({ port, watch: false });
const referto = [];
try {
  const coda = [...voci];
  const lavoratore = async () => {
    const page = await openPage(stage.browser, luce, { clock: false });
    // Gli appunti si leggono dopo Ctrl C e Ctrl X.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: stage.base });
    try {
      for (let voce = coda.shift(); voce; voce = coda.shift()) {
        const riga = { n: voce.n, titolo: voce.titolo, app21: prima21.get(String(voce.n)) ?? null };
        try {
          await apriNota(page, stage.base, luce, voce.partenza ?? {});
          await segna(page);
          riga.prima = await foto(page);
          await voce.gesto(page, aiuti(page));
          await page.waitForTimeout(voce.attesa ?? 250);
          riga.dopo = await foto(page);
          if (voce.leggi) riga.dopo.extra = await voce.leggi(page, aiuti(page));
          riga.riassunto = riassunto(riga.dopo, riga.prima);
        } catch (errore) {
          riga.errore = String(errore?.message ?? errore).split("\n")[0];
        }
        referto.push(riga);
        console.log(`#${voce.n} ${voce.titolo}\n   oggi: ${riga.errore ? `ERRORE ${riga.errore}` : riga.riassunto}\n   21/11: ${riga.app21 ?? "-"}`);
      }
    } finally {
      await page.context().close();
    }
  };
  await Promise.all(Array.from({ length: Math.min(insieme, voci.length) }, lavoratore));
} finally {
  await stage.close();
}
referto.sort((a, b) => String(a.n).localeCompare(String(b.n), "it", { numeric: true }));
const cartella = join(OUTPUT, "gesti");
await mkdir(cartella, { recursive: true });
await writeFile(join(cartella, `${pagina}.json`), `${JSON.stringify(referto, null, 2)}\n`);
console.log(`\n${referto.length} voci, ${referto.filter((r) => r.errore).length} con errore → ${join(cartella, `${pagina}.json`)}`);
