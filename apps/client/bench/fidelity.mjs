// **Il banco di fedeltà**: ciò che si vede è ciò che esce. Ogni scena del
// corpus (`fidelity-corpus.ts`) si disegna dalle tre strade che la mostrano,
// il foglio vivo, la Lettura e il PNG dell'export, e la Lettura e l'export si
// confrontano col foglio, pixel per pixel.
//
//     node bench/fidelity.mjs
//
// Il banco non ha baseline: il termine di paragone è il foglio stesso, nella
// stessa pagina e nello stesso browser, e una differenza fra le strade è
// sempre un errore, qualunque sia il sistema. Prima del corpus il banco
// prova sé stesso: una differenza messa apposta in una strada sola, un
// colore, un carattere, un corsivo, un tratteggio, le risorse che mancano,
// deve farlo diventare rosso.
//
// # La soglia
//
// Due strade dello stesso browser non disegnano gli stessi pixel ai bordi:
// il foglio vivo è nel DOM, la Lettura in un'immagine, l'export in un canvas.
// `pixelmatch` riconosce l'antialiasing da sé; quello che resta si conta, e
// una scena passa se i pixel diversi sono al più `LIMIT` del totale. In
// Chromium le tre strade danno oggi gli stessi pixel su ogni scena, e la più
// piccola delle differenze messe apposta, il tratteggio tolto, ne cambia il
// 3%: lo 0,2% sta largo fra le due, e lascia posto a un altro browser.
//
// # Gli a capo
//
// Dopo il corpus, la prova degli a capo (`wrap-check.ts`): gli a capo che
// FubDraw scrive in un testo in area, in italiano e in inglese, sono quelli
// che il browser farebbe con le larghezze che disegna. Anche lei prova prima
// sé stessa: con gli a capo della stima, che non conosce i caratteri, deve
// diventare rossa. Poi prova le due strade della spaziatura delle lettere:
// quella del canvas e quella dello ZWNJ, che vale dove il canvas non la sa
// mettere.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { openStage, OUTPUT } from "./stage.mjs";

/// La soglia di colore di `pixelmatch`, e la parte dei pixel che può
/// cambiare (vedi sopra).
const THRESHOLD = 0.1;
const LIMIT = 0.002;
/// Le differenze messe apposta, ciascuna su una scena che la mostra.
const PLANTED = [
  ["forme", "colore"],
  ["testi", "carattere"],
  ["tipografia", "corsivo"],
  ["tratteggi", "tratteggio"],
  ["risorse", "ripiego"],
];
const ROADS = ["read", "export"];
const out = join(OUTPUT, "fidelity");

const { base, browser, close } = await openStage();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 200 }, deviceScaleFactor: 2 });
  const shoot = async (scene, variant) => {
    await page.goto(`${base}/bench/fidelity.html?scene=${scene}${variant ? `&variant=${variant}` : ""}`);
    await page.waitForFunction(() => document.documentElement.dataset.fidelity !== undefined, null, { timeout: 30_000 });
    const state = await page.evaluate(() => [document.documentElement.dataset.fidelity, document.documentElement.dataset.error]);
    if (state[0] !== "ready") throw new Error(`${scene}: ${state[1]}`);
    const shots = {};
    for (const road of ["surface", ...ROADS]) shots[road] = PNG.sync.read(await page.locator(`#${road}`).screenshot());
    const result = {};
    for (const road of ROADS) {
      const { width, height } = shots.surface;
      const diff = new PNG({ width, height });
      const count = pixelmatch(shots.surface.data, shots[road].data, diff.data, width, height, { threshold: THRESHOLD });
      result[road] = { share: count / (width * height), diff, shots };
    }
    return result;
  };
  const keep = async (name, road, result) => {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, `${name}-surface.png`), PNG.sync.write(result.shots.surface));
    await writeFile(join(out, `${name}-${road}.png`), PNG.sync.write(result.shots[road]));
    await writeFile(join(out, `${name}-${road}-diff.png`), PNG.sync.write(result.diff));
  };
  const share = (value) => `${(value * 100).toFixed(3)}%`;

  for (const [scene, variant] of PLANTED) {
    const result = await shoot(scene, variant);
    const worst = Math.max(...ROADS.map((road) => result[road].share));
    const seen = worst > LIMIT;
    console.log(`${seen ? "ok  " : "NO  "} ${scene} con ${variant}: ${share(worst)} diversi`);
    if (!seen) failed = true;
  }

  await page.goto(`${base}/bench/fidelity.html`);
  await page.waitForFunction(() => document.documentElement.dataset.scenes !== undefined);
  const scenes = (await page.evaluate(() => document.documentElement.dataset.scenes)).split(" ");
  for (const scene of scenes) {
    const result = await shoot(scene, null);
    for (const road of ROADS) {
      const same = result[road].share <= LIMIT;
      console.log(`${same ? "ok  " : "NO  "} ${scene}, ${road === "read" ? "Lettura" : "export"}: ${share(result[road].share)} diversi`);
      if (!same) {
        failed = true;
        await keep(scene, road, result[road]);
      }
    }
  }

  const wrapCases = async (road, variant) => {
    await page.goto(`${base}/bench/fidelity.html?wrap=${road}${variant ? `&variant=${variant}` : ""}`);
    await page.waitForFunction(() => document.documentElement.dataset.fidelity !== undefined, null, { timeout: 60_000 });
    const [state, error, wrap] = await page.evaluate(() => [document.documentElement.dataset.fidelity, document.documentElement.dataset.error, document.documentElement.dataset.wrap]);
    if (state !== "ready") throw new Error(`a capo: ${error}`);
    return JSON.parse(wrap);
  };
  const planted = (await wrapCases("check", "stima")).filter((item) => !item.ok).length;
  console.log(`${planted > 0 ? "ok  " : "NO  "} a capo con la stima: ${planted} paragrafi diversi`);
  if (planted === 0) failed = true;
  const units = (value) => value.toFixed(2);
  for (const [road, label] of [["check", ""], ["zwnj", ", spaziatura con lo ZWNJ"]]) {
    const cases = await wrapCases(road, null);
    for (const item of cases) {
      if (item.ok) continue;
      failed = true;
      console.log(`NO   a capo${label}, ${item.name}: fuori di ${units(item.over)}, dentro di ${units(item.under)}, scarto ${units(item.drift)} in «${item.worst}»`);
    }
    const lines = cases.reduce((sum, item) => sum + item.lines, 0);
    const worst = (key) => units(Math.max(...cases.map((item) => item[key])));
    const good = cases.every((item) => item.ok);
    console.log(`${good ? "ok  " : "NO  "} a capo IT/EN${label}: ${cases.length} paragrafi, ${lines} righe; fuori al più di ${worst("over")}, scarto al più ${worst("drift")}`);
  }
} finally {
  await close();
}
if (failed) {
  console.error(`Il banco di fedeltà è rosso: le immagini sono in ${out}.`);
  process.exit(1);
}
