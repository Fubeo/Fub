// **Il fotografo**: scatta ogni scena in tutte e due le luci, le confronta con
// le baseline in repo, e compone il foglio di contatto (§31.1).
//
//     node bench/photos.mjs              # verifica: rosso se qualcosa è cambiato
//     node bench/photos.mjs --update   # riscrive le baseline
//
// # Perché le baseline stanno in repo
//
// Perché un diff che non ha un termine di paragone non è un diff: è una foto.
// Sono l'unica forma in cui un «prima» sopravviva a un commit, e quindi l'unico
// modo in cui questa seduta possa dimostrare di aver migliorato qualcosa invece
// di averlo cambiato. Il prezzo è che ogni tappa che cambia il tema arriva con
// dei PNG nel diff — ed è un prezzo che si paga volentieri, perché quei PNG
// sono la parte del commit che si guarda.
//
// # La soglia, misurata
//
// Due numeri, e adesso nessuno dei due è **stimato**. Erano 0,1 e 0,001, presi
// il primo dal default di `pixelmatch` e il secondo da un ragionamento
// plausibile scritto qui sotto: «un colore cambiato muove decine di migliaia di
// pixel». La §31.2 ha cambiato *tutti* i colori del tema, e questo banco ha
// detto **verde su venti scene su quaranta** — fra cui `catalogo-tavolozza`, che
// è la scena che i colori li mostra uno per uno.
//
// La ragione è nella forma della soglia di `pixelmatch`, che non è quella che il
// nome suggerisce: internamente il confronto è `delta > 35215 · soglia²`, con
// `delta` la distanza YIQ **al quadrato**. A 0,1 la tolleranza è 352 su 35215,
// cioè una differenza di luminanza di circa 26 livelli su 255 — un decimo della
// scala. Sotto quel muro ci sta un intero cambio di tavolozza.
//
// I due numeri di adesso sono misurati, e le misure sono queste (venti scene in
// due luci, 1280×800, questa macchina):
//
// - **Rumore** — due corse di fila della stessa tavolozza, scena peggiore:
//   0,008% dei pixel a soglia colore 0, e 0,003% a 0,01. Il rumore di
//   rasterizzazione che la vecchia prosa temeva è otto pixel su un milione, non
//   qualche migliaio: `pixelmatch` l'antialiasing lo riconosce da sé
//   (`includeAA: false`, che è il suo default) e non ha bisogno che glielo si
//   copra alzando la soglia del colore.
// - **Segnale** — la tavolozza vecchia contro quella della ricetta, scena
//   peggiore: 99,3% dei pixel a soglia 0,01 e **0,4% a 0,1**. È lo stesso
//   cambiamento visto da due righelli, e uno dei due non lo vede.
//
// Quindi:
//
// - `SOGLIA_COLORE` è 0,01. Sta trenta volte sopra il rumore misurato e
//   quattromila volte sotto il segnale di un cambio di tavolozza. Non serve che
//   sia zero: due corse identiche non danno immagini identiche al bit, e
//   pretenderlo renderebbe rosso il banco per il motivo per cui i banchi visivi
//   si spengono.
// - `SOGLIA_DIVERSI` resta un millesimo dei pixel — circa mille su 1280×800.
//   Adesso ha sotto di sé un rumore di trenta pixel invece di uno ignoto, ed è
//   la prima volta che quel millesimo vuol dire qualcosa.
//
// Vale la pena dire cosa ha trovato il difetto, perché non è stato questo banco:
// è stato il debito dichiarato di `a11y.mjs`, che alla stessa tavolozza nuova è
// diventato rosso su cinque voci riparate. Un presidio che elenca i difetti che
// si aspetta si accorge di essere migliorato; uno che confronta immagini con una
// soglia troppo larga, no.
//
// # Perché solo Linux
//
// Un browser pinnato garantisce lo stesso motore, non da solo gli stessi
// **caratteri resi**. Fino alla §31.3 la scala che questa shell chiede
// (`--font-ui`) si risolveva nel carattere di sistema, diverso su tre sistemi
// operativi: fotografare su macOS avrebbe voluto dire un secondo insieme di
// baseline che nessuno confronta col primo. La 0168 ha portato i tre
// caratteri in bundle — la variabile che questo commento nominava non c'è
// più — ma la riga resta locale lo stesso: le baseline che l'app porta oggi
// sono state scattate su una macchina che Playwright stesso segnala come non
// supportata (build di ripiego), non sul runner `ubuntu-latest` che userebbe
// la CI. È probabile che un font incorporato renda identico sulle due
// macchine — Chromium usa la propria pipeline di font shaping per un webfont,
// non quella di sistema — ma questo file misura invece di argomentare
// ([0167](../../docs/decisions/0167-un-colore-ha-una-ricetta.md)), e nessuno
// l'ha ancora misurato da dentro `ubuntu-latest`. Il confronto entra in CI
// quando qualcuno rigenera le baseline lì, o accetta che un primo tentativo
// possa uscire rosso per drift ambientale e non per un difetto vero.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { SCENE, LIGHTS, sceneUrl, photoFilename } from "./scene.mjs";
import { openStage, openPage, prepareScene, stillShot, BASELINE, OUTPUT } from "./stage.mjs";

const COLOR_THRESHOLD = 0.01;
const DIFF_THRESHOLD = 0.001;

const update = process.argv.includes("--update");

const CURRENT = join(OUTPUT, "attuale");
const DIFFERENZE = join(OUTPUT, "differenze");

/// Cosa è successo a una foto. Sono cinque e sono tutte diverse fra loro: un
/// «manca la baseline» che si confondesse con un «è cambiata» renderebbe
/// `--aggiorna` la risposta a tutti e due, e la prima volta che qualcuno la
/// desse per la seconda ragione le baseline smetterebbero di essere un presidio.
const OUTCOMES = {
  equal: "uguale",
  changed: "cambiata",
  withoutBaseline: "senza baseline",
  written: "scritta",
  unstable: "instabile",
};

async function main() {
  // Si cancella ciò che è del fotografo, non tutta `.output`: là dentro scrive
  // anche `a11y.mjs`, e chi pulisce la stanza degli altri decide senza saperlo
  // in quale ordine vanno lanciati due comandi.
  await rm(CURRENT, { recursive: true, force: true });
  await rm(DIFFERENZE, { recursive: true, force: true });
  await mkdir(CURRENT, { recursive: true });
  await mkdir(DIFFERENZE, { recursive: true });
  if (update) await mkdir(BASELINE, { recursive: true });

  const stage = await openStage();
  const report = [];

  try {
    for (const light of LIGHTS) {
      const page = await openPage(stage.browser, light);
      for (const scene of SCENE) {
        report.push(await aPhoto(page, scene, light, stage.base));
      }
      await page.context().close();
    }
  } finally {
    await stage.close();
  }

  await sideBySide(report);
  return summary(report);
}

async function aPhoto(page, scene, light, base) {
  const name = photoFilename(scene, light);
  const row = { scene, light, name, different: 0, totale: 0 };

  let shot;
  try {
    await prepareScene(page, scene, light, base, sceneUrl);
    shot = await stillShot(page);
  } catch (e) {
    row.result = OUTCOMES.unstable;
    row.reason = e.message.split("\n")[0];
    console.error(`✗ ${name}: ${row.reason}`);
    return row;
  }

  await writeFile(join(CURRENT, name), shot);
  const whereBefore = join(BASELINE, name);

  if (update) {
    await writeFile(whereBefore, shot);
    row.outcome = OUTCOMES.written;
    console.log(`· ${name}`);
    return row;
  }

  if (!existsSync(whereBefore)) {
    row.outcome = OUTCOMES.withoutBaseline;
    console.error(`✗ ${name}: nessuna baseline (è una scena newItem? «npm run bench:update»)`);
    return row;
  }

  const before = PNG.sync.read(await readFile(whereBefore));
  const now = PNG.sync.read(shot);
  if (before.width !== now.width || before.height !== now.height) {
    row.outcome = OUTCOMES.changed;
    row.reason = `misura diversa: ${first.width}×${first.height} → ${now.width}×${now.height}`;
    console.error(`✗ ${name}: ${row.reason}`);
    return row;
  }

  const difference = new PNG({ width: before.width, height: before.height });
  const different = pixelmatch(before.data, now.data, difference.data, before.width, before.height, {
    threshold: COLOR_THRESHOLD,
  });
  row.different = different;
  row.totale = before.width * before.height;

  if (different / row.totale <= DIFF_THRESHOLD) {
    row.outcome = OUTCOMES.equal;
    return row;
  }

  await writeFile(join(DIFFERENZE, name), PNG.sync.write(difference));
  row.outcome = OUTCOMES.changed;
  row.reason = `${different} pixel diversi su ${row.totale} (${(
    (different / row.totale) * 100
  ).toFixed(2)}%)`;
  console.error(`✗ ${name}: ${row.reason}`);
  return row;
}

// ---------------------------------------------------------------------------
// Il foglio di contatto: **il cancello umano** (§31.1).
// ---------------------------------------------------------------------------

/// Le due luci affiancate, generate a ogni corsa.
///
/// È scritto nella voce, e non nell'abitudine di una persona, perché è l'unico
/// pezzo del banco che una macchina non può sostituire: i presidi dicono che
/// niente è cambiato, e nessuno di loro sa dire se ciò che c'è è **bello**.
/// Ogni tappa di questa seduta si chiude guardandolo.
///
/// Affiancate e non una per pagina: il difetto che questa seduta cerca — un
/// colore che regge sul nero e non sul bianco, un'ombra che in luce sparisce —
/// non si vede guardando una luce alla volta. Si vede nel salto fra le due.
async function sideBySide(report) {
  const forScene = new Map();
  for (const r of report) {
    if (!forScene.has(r.scene.id)) forScene.set(r.scene.id, { scene: r.scene, rows: [] });
    forScene.get(r.scene.id).rows.push(r);
  }

  const sections = [...forScene.values()]
    .map(({ scene, rows }) => {
      const columns = rows
        .map((r) => {
          const difference = r.outcome === OUTCOMES.changed && existsSync(join(DIFFERENZE, r.name));
          const image =
            r.outcome === OUTCOMES.unstable
              ? `<p class="guasto">${esc(r.reason ?? "non fotografata")}</p>`
              : `<img loading="lazy" src="attuale/${r.name}" alt="${esc(scene.title)} — ${r.light}">`;
          return `<figure class="luce-${r.light}">
        <figcaption>${r.light === "dark" ? "scuro" : "chiaro"} · <span class="esito esito-${slug(r.outcome)}">${esc(r.result)}</span>${
          r.reason && r.result !== OUTCOMES.unstable ? ` · ${esc(r.reason)}` : ""
        }</figcaption>
        ${image}
        ${difference ? `<img loading="lazy" class="differenza" src="differenze/${r.name}" alt="differenza">` : ""}
      </figure>`;
        })
        .join("\n");
      return `<section>
      <h2>${esc(scene.title)} <code>${esc(scene.id)}</code></h2>
      <div class="coppia">${columns}</div>
    </section>`;
    })
    .join("\n");

  const changedItems = report.filter((r) => r.outcome !== OUTCOMES.equal && r.outcome !== OUTCOMES.written);
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Foglio di contatto — banco di Fub</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14171c; color: #e6e8eb;
         font: 15px/1.5 system-ui, sans-serif; }
  header { padding: 24px 32px; border-bottom: 1px solid #2a2f37; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .sommario { color: #9aa3ad; font-size: 13px; }
  .sommario b { color: #e6e8eb; }
  section { padding: 24px 32px; border-bottom: 1px solid #2a2f37; }
  h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
  h2 code { color: #9aa3ad; font-weight: 400; font-size: 13px; }
  .coppia { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; min-width: 0; }
  figcaption { color: #9aa3ad; font-size: 12px; margin-bottom: 6px;
               font-family: ui-monospace, monospace; }
  img { width: 100%; height: auto; display: block; border: 1px solid #2a2f37; border-radius: 6px; }
  img.differenza { margin-top: 8px; border-color: #b4453f; }
  .result-uguale { color: #66b98a; }
  .result-cambiata, .result-senza-baseline, .result-instabile { color: #e0776f; }
  .failure { color: #e0776f; font-family: ui-monospace, monospace; font-size: 13px;
            border: 1px dashed #b4453f; border-radius: 6px; padding: 24px; margin: 0; }
</style>
</head>
<body>
<header>
  <h1>Foglio di contatto</h1>
  <p class="sommario"><b>${SCENE.length}</b> scene · <b>${report.length}</b> foto ·
     ${changedItems.length === 0 ? "tutte uguali alle baseline" : `<b>${changedItems.length}</b> da guardare`}
     · finestra 1280×800 · soglia ${DIFF_THRESHOLD * 100}% dei pixel</p>
</header>
${sections}
</body>
</html>`;

  await writeFile(join(OUTPUT, "foglio-di-contatto.html"), html);
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s).replace(/\s+/g, "-");

// ---------------------------------------------------------------------------

async function summary(report) {
  const count = (outcome) => report.filter((r) => r.outcome === outcome).length;
  const sheet = join(OUTPUT, "foglio-di-contatto.html");

  if (update) {
    // Le baseline orfane si dicono, non si cancellano: una scena tolta e una
    // scena rinominata lasciano lo stesso file di troppo, e solo chi ha fatto
    // il lavoro sa quale delle due è stata. Il presidio (`scene.test.ts`) le
    // rende rosse comunque.
    const expected = new Set(report.map((r) => r.name));
    const orphans = (await readdir(BASELINE))
      .filter((f) => f.endsWith(".png"))
      .filter((f) => !expected.has(basename(f)));
    console.log(`\n${count(OUTCOMES.written)} baseline scritte in bench/baseline/`);
    if (orphans.length) {
      console.log(`${orphans.length} baseline non corrispondono a nessuna scena: ${orphans.join(", ")}`);
    }
    console.log(`Il sheet di contatto: ${sheet}`);
    return count(OUTCOMES.unstable) > 0 ? 1 : 0;
  }

  const errors =
    count(OUTCOMES.changed) + count(OUTCOMES.withoutBaseline) + count(OUTCOMES.unstable);
  console.log(
    `\n${count(OUTCOMES.equal)}/${report.length} foto uguali alle baseline` +
      (errors ? ` · ${errors} da guardare` : ""),
  );
  console.log(`Il sheet di contatto: ${sheet}`);
  if (errors) {
    console.log(
      "Se il cambiamento è quello che volevi, il gesto è «npm run bench:update» — dopo aver guardato il foglio.",
    );
  }
  return errors ? 1 : 0;
}

process.exitCode = await main();
