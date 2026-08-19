// **Il fotografo**: scatta ogni scena in tutte e due le luci, le confronta con
// le baseline in repo, e compone il foglio di contatto (§31.1).
//
//     node banco/foto.mjs              # verifica: rosso se qualcosa è cambiato
//     node banco/foto.mjs --aggiorna   # riscrive le baseline
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
// # La soglia, dichiarata
//
// Due numeri, e nessuno dei due è zero per caso.
//
// - `SOGLIA_COLORE` è quanto due pixel possono differire prima di contare come
//   diversi. È la soglia di `pixelmatch`, e 0,1 è la sua: sotto, l'antialiasing
//   di una lettera conta come una differenza.
// - `SOGLIA_DIVERSI` è **quanti** pixel diversi si accettano: un millesimo, cioè
//   circa mille pixel su 1280×800. Un bordo spostato di un pixel ne muove
//   qualche migliaio; un colore cambiato ne muove decine di migliaia; un residuo
//   di rasterizzazione ne muove qualche decina. La soglia sta in mezzo, e sta
//   scritta qui invece che dedotta guardando i rossi.
//
// # Perché solo Linux
//
// Un browser pinnato garantisce lo stesso motore, non gli stessi **caratteri**:
// la scala che questa shell chiede (`--font-ui`) si risolve nel carattere di
// sistema, e quello è diverso su tre sistemi operativi. Fotografare su macOS
// vorrebbe dire un secondo insieme di baseline che nessuno confronta col primo.
// Quando la §31.3 porterà i caratteri dentro l'applicazione, questa riga si
// potrà togliere — e allora il confronto potrà anche girare in CI, che oggi non
// gira per questa ragione e non per pigrizia.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { SCENE, LUCI, indirizzo, nomeFoto } from "./scene.mjs";
import { apriIlPalco, apriUnaPagina, preparaScena, scattoFermo, BASELINE, USCITA } from "./palco.mjs";

const SOGLIA_COLORE = 0.1;
const SOGLIA_DIVERSI = 0.001;

const aggiorna = process.argv.includes("--aggiorna");

const ATTUALE = join(USCITA, "attuale");
const DIFFERENZE = join(USCITA, "differenze");

/// Cosa è successo a una foto. Sono cinque e sono tutte diverse fra loro: un
/// «manca la baseline» che si confondesse con un «è cambiata» renderebbe
/// `--aggiorna` la risposta a tutti e due, e la prima volta che qualcuno la
/// desse per la seconda ragione le baseline smetterebbero di essere un presidio.
const ESITI = {
  uguale: "uguale",
  cambiata: "cambiata",
  senzaBaseline: "senza baseline",
  scritta: "scritta",
  instabile: "instabile",
};

async function main() {
  // Si cancella ciò che è del fotografo, non tutta `.uscita`: là dentro scrive
  // anche `a11y.mjs`, e chi pulisce la stanza degli altri decide senza saperlo
  // in quale ordine vanno lanciati due comandi.
  await rm(ATTUALE, { recursive: true, force: true });
  await rm(DIFFERENZE, { recursive: true, force: true });
  await mkdir(ATTUALE, { recursive: true });
  await mkdir(DIFFERENZE, { recursive: true });
  if (aggiorna) await mkdir(BASELINE, { recursive: true });

  const palco = await apriIlPalco();
  const referto = [];

  try {
    for (const luce of LUCI) {
      const page = await apriUnaPagina(palco.browser, luce);
      for (const scena of SCENE) {
        referto.push(await unaFoto(page, scena, luce, palco.base));
      }
      await page.context().close();
    }
  } finally {
    await palco.chiudi();
  }

  await fiancoAFianco(referto);
  return riassunto(referto);
}

async function unaFoto(page, scena, luce, base) {
  const nome = nomeFoto(scena, luce);
  const riga = { scena, luce, nome, diversi: 0, totale: 0 };

  let scatto;
  try {
    await preparaScena(page, scena, luce, base, indirizzo);
    scatto = await scattoFermo(page);
  } catch (e) {
    riga.esito = ESITI.instabile;
    riga.motivo = e.message.split("\n")[0];
    console.error(`✗ ${nome}: ${riga.motivo}`);
    return riga;
  }

  await writeFile(join(ATTUALE, nome), scatto);
  const dovePrima = join(BASELINE, nome);

  if (aggiorna) {
    await writeFile(dovePrima, scatto);
    riga.esito = ESITI.scritta;
    console.log(`· ${nome}`);
    return riga;
  }

  if (!existsSync(dovePrima)) {
    riga.esito = ESITI.senzaBaseline;
    console.error(`✗ ${nome}: nessuna baseline (è una scena nuova? «npm run banco:aggiorna»)`);
    return riga;
  }

  const prima = PNG.sync.read(await readFile(dovePrima));
  const adesso = PNG.sync.read(scatto);
  if (prima.width !== adesso.width || prima.height !== adesso.height) {
    riga.esito = ESITI.cambiata;
    riga.motivo = `misura diversa: ${prima.width}×${prima.height} → ${adesso.width}×${adesso.height}`;
    console.error(`✗ ${nome}: ${riga.motivo}`);
    return riga;
  }

  const differenza = new PNG({ width: prima.width, height: prima.height });
  const diversi = pixelmatch(prima.data, adesso.data, differenza.data, prima.width, prima.height, {
    threshold: SOGLIA_COLORE,
  });
  riga.diversi = diversi;
  riga.totale = prima.width * prima.height;

  if (diversi / riga.totale <= SOGLIA_DIVERSI) {
    riga.esito = ESITI.uguale;
    return riga;
  }

  await writeFile(join(DIFFERENZE, nome), PNG.sync.write(differenza));
  riga.esito = ESITI.cambiata;
  riga.motivo = `${diversi} pixel diversi su ${riga.totale} (${(
    (diversi / riga.totale) * 100
  ).toFixed(2)}%)`;
  console.error(`✗ ${nome}: ${riga.motivo}`);
  return riga;
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
async function fiancoAFianco(referto) {
  const perScena = new Map();
  for (const r of referto) {
    if (!perScena.has(r.scena.id)) perScena.set(r.scena.id, { scena: r.scena, righe: [] });
    perScena.get(r.scena.id).righe.push(r);
  }

  const sezioni = [...perScena.values()]
    .map(({ scena, righe }) => {
      const colonne = righe
        .map((r) => {
          const differenza = r.esito === ESITI.cambiata && existsSync(join(DIFFERENZE, r.nome));
          const immagine =
            r.esito === ESITI.instabile
              ? `<p class="guasto">${esc(r.motivo ?? "non fotografata")}</p>`
              : `<img loading="lazy" src="attuale/${r.nome}" alt="${esc(scena.titolo)} — ${r.luce}">`;
          return `<figure class="luce-${r.luce}">
        <figcaption>${r.luce === "dark" ? "scuro" : "chiaro"} · <span class="esito esito-${slug(r.esito)}">${esc(r.esito)}</span>${
          r.motivo && r.esito !== ESITI.instabile ? ` · ${esc(r.motivo)}` : ""
        }</figcaption>
        ${immagine}
        ${differenza ? `<img loading="lazy" class="differenza" src="differenze/${r.nome}" alt="differenza">` : ""}
      </figure>`;
        })
        .join("\n");
      return `<section>
      <h2>${esc(scena.titolo)} <code>${esc(scena.id)}</code></h2>
      <div class="coppia">${colonne}</div>
    </section>`;
    })
    .join("\n");

  const cambiate = referto.filter((r) => r.esito !== ESITI.uguale && r.esito !== ESITI.scritta);
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
  .esito-uguale { color: #66b98a; }
  .esito-cambiata, .esito-senza-baseline, .esito-instabile { color: #e0776f; }
  .guasto { color: #e0776f; font-family: ui-monospace, monospace; font-size: 13px;
            border: 1px dashed #b4453f; border-radius: 6px; padding: 24px; margin: 0; }
</style>
</head>
<body>
<header>
  <h1>Foglio di contatto</h1>
  <p class="sommario"><b>${SCENE.length}</b> scene · <b>${referto.length}</b> foto ·
     ${cambiate.length === 0 ? "tutte uguali alle baseline" : `<b>${cambiate.length}</b> da guardare`}
     · finestra 1280×800 · soglia ${SOGLIA_DIVERSI * 100}% dei pixel</p>
</header>
${sezioni}
</body>
</html>`;

  await writeFile(join(USCITA, "foglio-di-contatto.html"), html);
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s).replace(/\s+/g, "-");

// ---------------------------------------------------------------------------

async function riassunto(referto) {
  const conta = (esito) => referto.filter((r) => r.esito === esito).length;
  const foglio = join(USCITA, "foglio-di-contatto.html");

  if (aggiorna) {
    // Le baseline orfane si dicono, non si cancellano: una scena tolta e una
    // scena rinominata lasciano lo stesso file di troppo, e solo chi ha fatto
    // il lavoro sa quale delle due è stata. Il presidio (`scene.test.ts`) le
    // rende rosse comunque.
    const attese = new Set(referto.map((r) => r.nome));
    const orfane = (await readdir(BASELINE))
      .filter((f) => f.endsWith(".png"))
      .filter((f) => !attese.has(basename(f)));
    console.log(`\n${conta(ESITI.scritta)} baseline scritte in banco/baseline/`);
    if (orfane.length) {
      console.log(`${orfane.length} baseline non corrispondono a nessuna scena: ${orfane.join(", ")}`);
    }
    console.log(`Il foglio di contatto: ${foglio}`);
    return conta(ESITI.instabile) > 0 ? 1 : 0;
  }

  const problemi =
    conta(ESITI.cambiata) + conta(ESITI.senzaBaseline) + conta(ESITI.instabile);
  console.log(
    `\n${conta(ESITI.uguale)}/${referto.length} foto uguali alle baseline` +
      (problemi ? ` · ${problemi} da guardare` : ""),
  );
  console.log(`Il foglio di contatto: ${foglio}`);
  if (problemi) {
    console.log(
      "Se il cambiamento è quello che volevi, il gesto è «npm run banco:aggiorna» — dopo aver guardato il foglio.",
    );
  }
  return problemi ? 1 : 0;
}

process.exitCode = await main();
