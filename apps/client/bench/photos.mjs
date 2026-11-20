// **Il fotografo**: scatta ogni scena in tutte e due le luci, le confronta con
// le baseline in repo, e compone il foglio di contatto (§31.1).
//
//     node bench/photos.mjs              # verifica: rosso se qualcosa è cambiato
//     node bench/photos.mjs --update   # riscrive le baseline
//     node bench/photos.mjs --only=kit,mini-barra-colore   # solo quelle scene
//
// Una foto diversa dalla baseline, o una scena che non arriva allo scatto, si
// rifà una volta in una pagina nuova: se il secondo scatto è uguale, è
// «instabile ma ripresa» e il banco non cade (`photos-outcomes.mjs` spiega
// perché, e perché una volta sola).
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
// - `COLOR_THRESHOLD` è 0,01. Sta trenta volte sopra il rumore misurato e
//   quattromila volte sotto il segnale di un cambio di tavolozza. Non serve che
//   sia zero: due corse identiche non danno immagini identiche al bit, e
//   pretenderlo renderebbe rosso il banco per il motivo per cui i banchi visivi
//   si spengono.
// - `DIFF_THRESHOLD` resta un millesimo dei pixel — circa mille su 1280×800.
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
// caratteri resi. Le baseline canoniche sono quindi un solo insieme Linux:
// il commit `7463f725` le ha rigenerate su `ubuntu-latest` con la revisione
// Playwright del lockfile, dopo aver incorporato i font e neutralizzato il
// puntatore fra le scene. Quel commit ha ripetuto il banco 42/42 senza
// allargare `COLOR_THRESHOLD` o `DIFF_THRESHOLD`; la CI continua a verificare
// le stesse immagini e poi l'accessibilità nello stesso job, fissato su
// `ubuntu-24.04` perché `ubuntu-latest` cambia immagine senza avvisare.
// Un esito locale diverso su una distribuzione o build di ripiego è drift
// ambientale da diagnosticare, non un motivo per riscrivere i PNG.
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { SCENE, LIGHTS, sceneUrl, photoFilename } from "./scene.mjs";
import {
  openStage,
  openPage,
  prepareScene,
  stillShot,
  BASELINE,
  OUTPUT,
  WINDOW,
} from "./stage.mjs";
import {
  OUTCOMES,
  combineShots,
  needsSecondShot,
  stepSummary,
  unstableRecord,
  verifySummary,
} from "./photos-outcomes.mjs";

const COLOR_THRESHOLD = 0.01;
const DIFF_THRESHOLD = 0.001;

const update = process.argv.includes("--update");

/// Le scene chieste con `--only=a,b`: per riprovare una scena sola senza
/// fotografarle tutte. Un id sconosciuto ferma tutto, invece di dare un verde
/// su zero foto.
const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const chosen = only ? SCENE.filter((scene) => only.includes(scene.id)) : SCENE;
if (only && chosen.length !== only.length) {
  const known = new Set(SCENE.map((scene) => scene.id));
  console.error(`scena sconosciuta: ${only.filter((id) => !known.has(id)).join(", ")}`);
  process.exit(2);
}

/// Che cosa si fotografa, dove sta il termine di paragone, dove va il referto.
const SET = {
  name: "banco di Fub",
  scenes: chosen,
  baseline: BASELINE,
  baselineLabel: "bench/baseline/",
  output: OUTPUT,
  updateHint: "npm run bench:update",
};

const CURRENT = join(SET.output, "attuale");
const DIFFERENCES = join(SET.output, "differenze");
/// Il primo scatto di una foto rifatta, e la sua differenza. Fuori da
/// `attuale/` e `differenze/`: `baseline-dal-runner.mjs` committa soltanto da
/// lì, e il primo scatto di una scena instabile non deve diventare baseline.
const UNSTABLE = join(SET.output, "instabili");
const UNSTABLE_RECORD = join(SET.output, "instabili.json");
const SHEET = join(SET.output, "foglio-di-contatto.html");

async function main() {
  // Si cancella ciò che è del fotografo, non tutta `.output`: là dentro scrive
  // anche `a11y.mjs`, e chi pulisce la stanza degli altri decide senza saperlo
  // in quale ordine vanno lanciati due comandi.
  await rm(CURRENT, { recursive: true, force: true });
  await rm(DIFFERENCES, { recursive: true, force: true });
  await rm(UNSTABLE, { recursive: true, force: true });
  await rm(UNSTABLE_RECORD, { force: true });
  await mkdir(CURRENT, { recursive: true });
  await mkdir(DIFFERENCES, { recursive: true });
  if (update) await mkdir(SET.baseline, { recursive: true });

  const stage = await openStage();
  const report = [];

  try {
    for (const light of LIGHTS) {
      const page = await openPage(stage.browser, light);
      for (const scene of SET.scenes) {
        // La finestra è della scena: chi ne chiede una stretta non la lascia
        // in eredità a quella dopo.
        await page.setViewportSize(scene.viewport ?? WINDOW);
        const first = await aPhoto(page, scene, light, stage.base);
        report.push(
          needsSecondShot(first, { update }) ? await secondShot(stage, scene, light, first) : first,
        );
      }
      await page.context().close();
    }
  } finally {
    await stage.close();
  }

  await sideBySide(report);
  return summary(report);
}

/// Rifà una foto una volta, in una pagina nuova (`photos-outcomes.mjs` dice
/// quando e perché). Il primo scatto e la sua differenza passano in
/// `instabili/`; se a valere è il primo (il secondo non è arrivato allo
/// scatto), tornano dov'erano.
async function secondShot(stage, scene, light, first) {
  const name = first.name;
  const moved = [];
  await mkdir(UNSTABLE, { recursive: true });
  for (const [from, to] of [
    [join(CURRENT, name), join(UNSTABLE, name)],
    [join(DIFFERENCES, name), join(UNSTABLE, `differenza-${name}`)],
  ]) {
    if (!existsSync(from)) continue;
    await rename(from, to);
    moved.push([from, to]);
  }
  console.error(`↻ ${name}: secondo scatto in una pagina nuova`);
  const page = await openPage(stage.browser, light);
  let second;
  try {
    await page.setViewportSize(scene.viewport ?? WINDOW);
    second = await aPhoto(page, scene, light, stage.base);
  } finally {
    await page.context().close();
  }
  const row = combineShots(first, second);
  if (row === first) {
    for (const [from, to] of moved) await rename(to, from);
  } else if (row.outcome !== OUTCOMES.recovered) {
    // Vale il secondo, ed è diverso anche lui: il primo non serve a nessuno.
    for (const [, to] of moved) await rm(to, { force: true });
  } else {
    console.error(`⚠ ${name}: instabile ma ripresa (al primo scatto ${first.reason ?? first.outcome})`);
  }
  return row;
}

async function aPhoto(page, scene, light, base) {
  const name = photoFilename(scene, light);
  const row = { scene, light, name, different: 0, totale: 0 };

  let shot;
  try {
    await prepareScene(page, scene, light, base, sceneUrl);
    shot = await stillShot(page);
  } catch (e) {
    row.outcome = OUTCOMES.unstable;
    row.reason = e.message.split("\n")[0];
    console.error(`✗ ${name}: ${row.reason}`);
    return row;
  }

  await writeFile(join(CURRENT, name), shot);
  const whereBefore = join(SET.baseline, name);

  if (update) {
    await writeFile(whereBefore, shot);
    row.outcome = OUTCOMES.written;
    console.log(`· ${name}`);
    return row;
  }

  if (!existsSync(whereBefore)) {
    row.outcome = OUTCOMES.withoutBaseline;
    console.error(`✗ ${name}: nessuna baseline (è una scena nuova? «${SET.updateHint}»)`);
    return row;
  }

  const before = PNG.sync.read(await readFile(whereBefore));
  const now = PNG.sync.read(shot);
  if (before.width !== now.width || before.height !== now.height) {
    row.outcome = OUTCOMES.changed;
    row.reason = `misura diversa: ${before.width}×${before.height} → ${now.width}×${now.height}`;
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

  await writeFile(join(DIFFERENCES, name), PNG.sync.write(difference));
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
          const difference = r.outcome === OUTCOMES.changed && existsSync(join(DIFFERENCES, r.name));
          const image =
            r.outcome === OUTCOMES.unstable
              ? `<p class="guasto">${esc(r.reason ?? "non fotografata")}</p>`
              : `<img loading="lazy" src="attuale/${r.name}" alt="${esc(scene.title)} — ${r.light}">`;
          const reason =
            r.outcome === OUTCOMES.recovered
              ? ` · al primo scatto ${esc(r.first.reason ?? r.first.outcome)}`
              : r.reason && r.outcome !== OUTCOMES.unstable
                ? ` · ${esc(r.reason)}`
                : "";
          // Di una foto ripresa si vede anche il primo scatto, con la sua
          // differenza: è ciò che va spiegato nella issue.
          const firstShot =
            r.outcome === OUTCOMES.recovered
              ? [
                  [r.name, "primo scatto"],
                  [`differenza-${r.name}`, "differenza del primo scatto"],
                ]
                  .filter(([file]) => existsSync(join(UNSTABLE, file)))
                  .map(([file, alt]) => `<img loading="lazy" class="primo" src="instabili/${file}" alt="${alt}">`)
                  .join("\n")
              : "";
          return `<figure class="luce-${r.light}">
        <figcaption>${r.light === "dark" ? "scuro" : "chiaro"} · <span class="esito esito-${slug(r.outcome)}">${esc(r.outcome)}</span>${reason}</figcaption>
        ${image}
        ${difference ? `<img loading="lazy" class="differenza" src="differenze/${r.name}" alt="differenza">` : ""}
        ${firstShot}
      </figure>`;
        })
        .join("\n");
      return `<section>
      <h2>${esc(scene.title)} <code>${esc(scene.id)}</code>${
        scene.viewport ? ` · ${scene.viewport.width}×${scene.viewport.height}` : ""
      }</h2>
      <div class="coppia">${columns}</div>
    </section>`;
    })
    .join("\n");

  const recovered = report.filter((r) => r.outcome === OUTCOMES.recovered);
  const changedItems = report.filter(
    (r) => r.outcome !== OUTCOMES.equal && r.outcome !== OUTCOMES.written && r.outcome !== OUTCOMES.recovered,
  );
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Foglio di contatto — ${esc(SET.name)}</title>
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
  img.primo { margin-top: 8px; border-color: #c9a227; }
  .esito-uguale, .esito-scritta { color: #66b98a; }
  .esito-cambiata, .esito-senza-baseline, .esito-instabile { color: #e0776f; }
  .esito-instabile-ma-ripresa { color: #e0b84f; }
  .guasto { color: #e0776f; font-family: ui-monospace, monospace; font-size: 13px;
            border: 1px dashed #b4453f; border-radius: 6px; padding: 24px; margin: 0; }
</style>
</head>
<body>
<header>
  <h1>Foglio di contatto</h1>
  <p class="sommario"><b>${SET.scenes.length}</b> scene · <b>${report.length}</b> foto ·
     ${changedItems.length === 0 ? "tutte uguali alle baseline" : `<b>${changedItems.length}</b> da guardare`}
     ${recovered.length ? ` · <b>${recovered.length}</b> instabili ma riprese al secondo scatto (instabili.json)` : ""}
     · finestra ${WINDOW.width}×${WINDOW.height} se la scena non ne chiede un'altra · soglia ${DIFF_THRESHOLD * 100}% dei pixel</p>
</header>
${sections}
</body>
</html>`;

  await writeFile(SHEET, html);
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s).replace(/\s+/g, "-");

// ---------------------------------------------------------------------------

async function summary(report) {
  const count = (outcome) => report.filter((r) => r.outcome === outcome).length;
  const sheet = SHEET;

  if (update) {
    // Le baseline orfane si dicono, non si cancellano: una scena tolta e una
    // scena rinominata lasciano lo stesso file di troppo, e solo chi ha fatto
    // il lavoro sa quale delle due è stata. Il presidio (`scene.test.ts`) le
    // rende rosse comunque.
    const expected = new Set(report.map((r) => r.name));
    const orphans = only ? [] : (await readdir(SET.baseline))
      .filter((f) => f.endsWith(".png"))
      .filter((f) => !expected.has(basename(f)));
    console.log(`\n${count(OUTCOMES.written)} baseline scritte in ${SET.baselineLabel}`);
    if (orphans.length) {
      console.log(`${orphans.length} baseline non corrispondono a nessuna scena: ${orphans.join(", ")}`);
    }
    console.log(`Il foglio di contatto: ${sheet}`);
    return count(OUTCOMES.unstable) > 0 ? 1 : 0;
  }

  const record = unstableRecord(report);
  if (record.length) await writeFile(UNSTABLE_RECORD, `${JSON.stringify(record, null, 2)}\n`);
  // Sulla pagina della corsa di GitHub, dove si guarda prima del log.
  const step = stepSummary(report);
  if (step && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, step);
  if (process.env.GITHUB_ACTIONS) {
    for (const r of record) console.log(`::warning title=Banco visivo instabile::${r.foto} è uguale solo al secondo scatto`);
  }

  const { lines, exitCode } = verifySummary(report, { updateHint: SET.updateHint });
  console.log(`\n${lines[0]}`);
  console.log(`Il foglio di contatto: ${sheet}`);
  for (const line of lines.slice(1)) console.log(line);
  return exitCode;
}

process.exitCode = await main();
